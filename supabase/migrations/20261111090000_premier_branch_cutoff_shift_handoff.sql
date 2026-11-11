-- Premier OS: branch-configured day cutoff closes the shift before its day snapshot.
-- DRAFT / review only. Do not deploy to production or schedule automatic day-close.
-- Do not replay archived daily-close migrations. A separate controlled rollout is required.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';

DO $guard$
BEGIN
  IF to_regprocedure('private.run_due_business_day_closes()') IS NULL
     OR to_regprocedure('public.try_auto_close_branch_shift(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREMIER_DAY_CLOSE_PREDECESSOR_MISSING';
  END IF;
END;
$guard$;

-- Approved draft only: no production deployment or historical day-close activation.
-- A business-day cutoff is derived from branch_settings in Africa/Cairo.
-- An open order stays untouched. The next authenticated cashier must open a NEW
-- shift before sale settlement; _process_sale_core rejects cashier sales without it.
-- Never invent an actual cash drawer count: preserve NULL actual/difference.
CREATE OR REPLACE FUNCTION private.close_shift_at_business_day_cutoff(
  p_branch_id uuid, p_cutoff timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_expected numeric(14,2);
  v_start timestamptz;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_branch_id IS NULL OR p_cutoff IS NULL THEN
    RAISE EXCEPTION 'SHIFT_CUTOFF_SCOPE_REQUIRED';
  END IF;

  -- Prevent accidental backdating against stale historical daily-close queues.
  -- An overdue day requires explicit reconciliation before scheduling the runner.
  IF p_cutoff < v_now - interval '24 hours' THEN
    RAISE EXCEPTION 'HISTORICAL_SHIFT_CUTOFF_REQUIRES_REVIEW';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_branch_id::text)::bigint);
  SELECT * INTO v_shift FROM public.shifts s
  WHERE s.branch_id=p_branch_id AND s.status='open'
  ORDER BY s.opened_at,s.id LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('closed',false,'reason','NO_OPEN_SHIFT');
  END IF;

  IF v_shift.opened_at>=p_cutoff THEN
    RETURN jsonb_build_object('closed',false,'reason','SHIFT_STARTED_AFTER_CUTOFF');
  END IF;

  SELECT (p_cutoff AT TIME ZONE 'Africa/Cairo')::date INTO v_start;
  IF EXISTS(
    SELECT 1 FROM public.shift_operations op
    WHERE op.shift_id=v_shift.id AND op.created_at>=p_cutoff
  ) THEN
    RAISE EXCEPTION 'SHIFT_POST_CUTOFF_OPERATIONS_REVIEW_REQUIRED';
  END IF;

  v_expected:=public._compute_shift_expected_cash(v_shift.id);
  UPDATE public.shifts
  SET status='closed',closed_at=p_cutoff,expected_amount=v_expected,
      actual_amount=NULL,difference=NULL,
      notes=concat_ws(E'\n',NULLIF(notes,''),'AUTO_CLOSED_AT_CONFIGURED_CUTOFF')
  WHERE id=v_shift.id AND branch_id=p_branch_id AND status='open';

  IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_CONCURRENT_CLOSE'; END IF;

  RETURN jsonb_build_object(
    'closed',true,'shift_id',v_shift.id,'expected',v_expected,
    'actual',NULL,'difference',NULL,'closed_at',p_cutoff
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.close_shift_at_business_day_cutoff(uuid,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.close_shift_at_business_day_cutoff(uuid,timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.try_auto_close_branch_shift(p_branch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_shift public.shifts%ROWTYPE;
  v_mode text:='fixed_time';
  v_auto boolean:=false;
  v_start_time time:='00:00';
  v_end_time time:='00:00';
  v_local_open timestamp;
  v_business_date date;
  v_state jsonb;
  v_state_date date;
  v_window_end timestamptz;
  v_expected numeric(14,2);
  v_open_order_count integer:=0;
  v_open_table_count integer:=0;
  v_close_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','UNAUTHENTICATED');
  END IF;

  IF NOT public.is_pos_admin() AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;

  SELECT
    COALESCE(bs.business_day_mode,'fixed_time'),
    COALESCE(bs.auto_close_shift_at_day_end,false),
    COALESCE(bs.business_day_start,'00:00'::time),
    COALESCE(bs.business_day_end,'00:00'::time)
  INTO v_mode,v_auto,v_start_time,v_end_time
  FROM public.branch_settings bs
  WHERE bs.branch_id=p_branch_id;

  IF NOT v_auto THEN
    RETURN jsonb_build_object('success',true,'closed',false,'reason','AUTO_CLOSE_DISABLED');
  END IF;

  IF v_mode<>'fixed_time' THEN
    RETURN jsonb_build_object('success',true,'closed',false,'reason','AUTO_CLOSE_FIXED_TIME_ONLY');
  END IF;

  SELECT * INTO v_shift
  FROM public.shifts
  WHERE branch_id=p_branch_id AND status='open'
  ORDER BY opened_at,id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',true,'closed',false,'reason','NO_OPEN_SHIFT');
  END IF;

  -- Business-day reporting may intentionally expose end_at=now() while a day is live.
  -- Auto-close must instead use the persisted live business date plus the configured
  -- branch end time so an 08:00 -> 03:00 day closes at 03:00 the following morning.
  v_state:=public._ensure_business_day_state(p_branch_id);
  v_state_date:=NULLIF(v_state->>'business_date','')::date;

  IF v_state_date IS NOT NULL THEN
    v_business_date:=v_state_date;
  ELSE
    v_local_open:=v_shift.opened_at AT TIME ZONE 'Africa/Cairo';
    v_business_date:=v_local_open::date;
    IF v_end_time<=v_start_time AND v_local_open::time<v_end_time THEN
      v_business_date:=v_business_date-1;
    END IF;
  END IF;

  v_window_end:=(
    (
      (v_business_date + CASE WHEN v_end_time<=v_start_time THEN 1 ELSE 0 END)::timestamp
      + v_end_time
    ) AT TIME ZONE 'Africa/Cairo'
  );

  -- Never let a stale or gap-period business date produce a cutoff at/before
  -- the shift opening instant. Advance to the first configured cutoff after open.
  WHILE v_window_end<=v_shift.opened_at LOOP
    v_business_date:=v_business_date+1;
    v_window_end:=(
      (
        (v_business_date + CASE WHEN v_end_time<=v_start_time THEN 1 ELSE 0 END)::timestamp
        + v_end_time
      ) AT TIME ZONE 'Africa/Cairo'
    );
  END LOOP;

  IF now()<v_window_end THEN
    RETURN jsonb_build_object(
      'success',true,'closed',false,'reason','BUSINESS_DAY_NOT_FINISHED',
      'business_date',v_business_date,
      'window_end',v_window_end
    );
  END IF;

  SELECT
    count(*)::int,
    count(DISTINCT o.table_id) FILTER (WHERE o.table_id IS NOT NULL)::int
  INTO v_open_order_count,v_open_table_count
  FROM public.orders o
  WHERE o.branch_id=p_branch_id
    AND o.status IN ('open','held')
    AND COALESCE(o.payment_status,'unpaid')<>'paid'
    AND EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id=o.id AND oi.quantity>0
    );

  -- Preserve operational orders, but close the financial shift at the configured cutoff.
  v_close_result := private.close_shift_at_business_day_cutoff(p_branch_id,v_window_end);
  RETURN jsonb_build_object(
    'success',true,
    'closed',COALESCE((v_close_result->>'closed')::boolean,false),
    'shift_id',v_close_result->>'shift_id',
    'expected',(v_close_result->>'expected')::numeric,
    'actual',NULL,
    'difference',NULL,
    'business_date',v_business_date,
    'window_end',v_window_end,
    'open_order_count',v_open_order_count,
    'open_table_count',v_open_table_count,
    'open_orders_preserved',true,
    'reason',v_close_result->>'reason'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.run_due_business_day_closes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
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

        -- The shift and day-close snapshot are committed together, or both roll back.
        -- Manual-close configuration blocks day-close when an eligible shift is still open.
        IF EXISTS(
          SELECT 1 FROM public.shifts s
          WHERE s.branch_id=v_branch.branch_id AND s.status='open'
            AND s.opened_at<v_cutoff
        ) THEN
          IF NOT COALESCE((
            SELECT bs.auto_close_shift_at_day_end
            FROM public.branch_settings bs WHERE bs.branch_id=v_branch.branch_id
          ),false) THEN
            RAISE EXCEPTION 'SHIFT_CLOSE_REQUIRED_BY_BRANCH_SETTINGS';
          END IF;
          PERFORM private.close_shift_at_business_day_cutoff(v_branch.branch_id,v_cutoff);
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

-- Keep cron activation in a separately approved change. No cron.schedule call.
