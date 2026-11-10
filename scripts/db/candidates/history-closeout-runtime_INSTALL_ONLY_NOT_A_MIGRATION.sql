SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $preflight$
BEGIN
IF current_user<>'postgres' THEN RAISE EXCEPTION 'CLOSEOUT_ROLE_MISMATCH'; END IF;
IF to_regprocedure('app_private.record_login_failure(text)') IS NULL OR encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('app_private.record_login_failure(text)')),'UTF8')),'hex') <> 'ef44ae545f7a34991dd1cadb2a85091340501454c847f47ff70fc4dafa9d8140' THEN RAISE EXCEPTION 'CLOSEOUT_FUNCTION_DRIFT'; END IF;
IF (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure('app_private.record_login_failure(text)')) IS DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN RAISE EXCEPTION 'CLOSEOUT_ACL_DRIFT'; END IF;
IF to_regprocedure('public.complete_stale_kitchen_orders(uuid)') IS NULL OR encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.complete_stale_kitchen_orders(uuid)')),'UTF8')),'hex') <> 'a4c9a46a7d06e707461b4e9d30d78a8a56c9c9d705c93a93bc5d803619ac7197' THEN RAISE EXCEPTION 'CLOSEOUT_FUNCTION_DRIFT'; END IF;
IF (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure('public.complete_stale_kitchen_orders(uuid)')) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}' THEN RAISE EXCEPTION 'CLOSEOUT_ACL_DRIFT'; END IF;
IF to_regprocedure('public.record_login_failure(text)') IS NULL OR encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.record_login_failure(text)')),'UTF8')),'hex') <> '0b217643c62cdcbe8815134f5a3f4bc44263d7e4c05c75e3e902a841f19ac107' THEN RAISE EXCEPTION 'CLOSEOUT_FUNCTION_DRIFT'; END IF;
IF (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure('public.record_login_failure(text)')) IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres,anon=X/postgres}' THEN RAISE EXCEPTION 'CLOSEOUT_ACL_DRIFT'; END IF;
IF to_regprocedure('private.run_due_business_day_closes()') IS NOT NULL OR to_regprocedure('private.business_day_fixed_cutoff(uuid,date)') IS NOT NULL THEN RAISE EXCEPTION 'CLOSEOUT_HELPER_ALREADY_PRESENT'; END IF;
END;
$preflight$;
-- Automatic fixed-time business-day close.
-- Runs independently of browser/user sessions and preserves open shifts/orders.
-- Only fixed_time branches participate.
--
-- Safety:
-- - system closes use closed_by = NULL; no employee impersonation
-- - one immutable daily_closes row per branch/business_date
-- - current business-day state advances at the configured cutoff before snapshot build
--   so post-cutoff activity cannot leak into the prior day
-- - missed due dates after the latest close are caught up idempotently
-- - pg_cron installation/scheduling is guarded for environments where the extension
--   is unavailable (for example some CI images)

CREATE OR REPLACE FUNCTION private.business_day_fixed_cutoff(
  p_branch_id uuid,
  p_business_date date
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
  v_start time := '00:00';
  v_end time := '00:00';
BEGIN
  SELECT
    COALESCE(bs.business_day_start,'00:00'::time),
    COALESCE(bs.business_day_end,'00:00'::time)
  INTO v_start,v_end
  FROM public.branch_settings bs
  WHERE bs.branch_id=p_branch_id;

  RETURN (
    (
      p_business_date
      + CASE WHEN v_end<=v_start THEN 1 ELSE 0 END
    )::timestamp
    + v_end
  ) AT TIME ZONE 'Africa/Cairo';
END;
$function$;

REVOKE ALL ON FUNCTION private.business_day_fixed_cutoff(uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.business_day_fixed_cutoff(uuid,date) TO service_role;

CREATE OR REPLACE FUNCTION private.run_due_business_day_closes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
  v_branch record;
  v_state jsonb;
  v_state_date date;
  v_last_close date;
  v_candidate date;
  v_cutoff timestamptz;
  v_report jsonb;
  v_next_date date;
  v_close_id uuid;
  v_closed_count integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_closed jsonb := '[]'::jsonb;
BEGIN
  FOR v_branch IN
    SELECT b.id AS branch_id
    FROM public.branches b
    JOIN public.organizations o ON o.id=b.organization_id
    JOIN public.branch_settings bs ON bs.branch_id=b.id
    WHERE b.is_active=true
      AND o.is_active=true
      AND COALESCE(bs.business_day_mode,'fixed_time')='fixed_time'
    ORDER BY b.id
  LOOP
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('auto_business_day_close:'||v_branch.branch_id::text,0));

      v_state:=public._ensure_business_day_state(v_branch.branch_id);
      v_state_date:=NULLIF(v_state->>'business_date','')::date;

      SELECT max(dc.business_date)
      INTO v_last_close
      FROM public.daily_closes dc
      WHERE dc.branch_id=v_branch.branch_id
        AND dc.status='closed';

      v_candidate:=COALESCE(v_last_close+1,v_state_date);

      WHILE v_candidate IS NOT NULL
        AND v_state_date IS NOT NULL
        AND v_candidate<=v_state_date
      LOOP
        v_cutoff:=private.business_day_fixed_cutoff(v_branch.branch_id,v_candidate);
        EXIT WHEN v_cutoff IS NULL OR now()<v_cutoff;

        IF EXISTS (
          SELECT 1
          FROM public.daily_closes dc
          WHERE dc.branch_id=v_branch.branch_id
            AND dc.business_date=v_candidate
        ) THEN
          v_candidate:=v_candidate+1;
          CONTINUE;
        END IF;

        -- When closing the currently active state, advance it first at the exact
        -- configured cutoff. The function call is transactional; any later error
        -- rolls the state change back with the snapshot insert.
        IF v_state_date=v_candidate THEN
          v_next_date:=public._next_unclosed_business_date(
            v_branch.branch_id,
            v_candidate+1
          );

          UPDATE public.business_day_state
          SET business_date=v_next_date,
              started_at=v_cutoff,
              updated_at=now()
          WHERE branch_id=v_branch.branch_id;

          v_state_date:=v_next_date;
        END IF;

        v_report:=private.normalize_day_close_cash(
          public._build_day_closing_report(v_branch.branch_id,v_candidate),
          v_branch.branch_id
        );

        INSERT INTO public.daily_closes(
          branch_id,
          business_date,
          status,
          closed_at,
          closed_by,
          report_snapshot
        )
        VALUES(
          v_branch.branch_id,
          v_candidate,
          'closed',
          v_cutoff,
          NULL,
          v_report
        )
        ON CONFLICT DO NOTHING
        RETURNING id INTO v_close_id;

        IF v_close_id IS NOT NULL THEN
          v_closed_count:=v_closed_count+1;
          v_closed:=v_closed || jsonb_build_array(jsonb_build_object(
            'branch_id',v_branch.branch_id,
            'business_date',v_candidate,
            'closed_at',v_cutoff,
            'daily_close_id',v_close_id
          ));
        END IF;

        v_close_id:=NULL;
        v_candidate:=v_candidate+1;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      v_errors:=v_errors || jsonb_build_array(jsonb_build_object(
        'branch_id',v_branch.branch_id,
        'error',SQLERRM,
        'sqlstate',SQLSTATE
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success',jsonb_array_length(v_errors)=0,
    'closed_count',v_closed_count,
    'closed',v_closed,
    'errors',v_errors,
    'checked_at',now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.run_due_business_day_closes() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.run_due_business_day_closes() TO service_role;

-- ============================================================================
-- Migration: 20261105010000_harden_login_failure_and_user_security.sql
-- Description: Strengthen login brute-force protection and account lockout
--              for both username and email-based sign-ins.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_private.record_login_failure(p_username text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user public.users%ROWTYPE;
  v_new_attempts integer;
  v_norm text;
BEGIN
  IF p_username IS NULL OR btrim(p_username) = '' THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  v_norm := lower(btrim(p_username));

  -- Match either by explicit username or by registered email address
  SELECT *
  INTO v_user
  FROM public.users
  WHERE username = v_norm OR lower(email) = v_norm
  LIMIT 1;

  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  -- Do not extend an already active lock window
  IF v_user.is_locked AND v_user.lock_until IS NOT NULL AND v_user.lock_until > now() THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  -- If lock expired, reset counter and lock status
  IF v_user.is_locked AND v_user.lock_until IS NOT NULL AND v_user.lock_until <= now() THEN
    UPDATE public.users
    SET is_locked = false,
        failed_attempts = 1,
        lock_until = NULL
    WHERE id = v_user.id;
    RETURN jsonb_build_object('success', true);
  END IF;

  v_new_attempts := COALESCE(v_user.failed_attempts, 0) + 1;
  IF v_new_attempts >= 5 THEN
    UPDATE public.users
    SET failed_attempts = v_new_attempts,
        is_locked = true,
        lock_until = now() + interval '5 minutes'
    WHERE id = v_user.id;
  ELSE
    UPDATE public.users
    SET failed_attempts = v_new_attempts
    WHERE id = v_user.id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION app_private.record_login_failure(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.record_login_failure(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_login_failure(p_username text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = app_private, public, pg_temp
AS $function$
  SELECT app_private.record_login_failure(p_username);
$function$;

REVOKE ALL ON FUNCTION public.record_login_failure(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_login_failure(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- Premier KDS display refresh is read-only. Viewing kitchen cards must not
-- authorize changing order status through the legacy 40-minute sweeper.
-- Retain service-role access for any independently authorized maintenance flow.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
DO $guard$
DECLARE v_definition text;
BEGIN
  IF to_regprocedure('public.complete_stale_kitchen_orders(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREMIER_KDS_SWEEPER_MISSING';
  END IF;
  SELECT pg_get_functiondef('public.complete_stale_kitchen_orders(uuid)'::regprocedure)
    INTO v_definition;
  IF v_definition NOT LIKE '%kitchen_auto_completed_40m%'
     OR v_definition NOT LIKE '%pos.kds_view%'
  THEN
    RAISE EXCEPTION 'PREMIER_KDS_SWEEPER_DRIFT';
  END IF;
END;
$guard$;

REVOKE EXECUTE ON FUNCTION public.complete_stale_kitchen_orders(uuid) FROM authenticated;
-- The original migration already revoked PUBLIC/anon; reaffirm that contract.
REVOKE ALL ON FUNCTION public.complete_stale_kitchen_orders(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_stale_kitchen_orders(uuid) TO service_role;
