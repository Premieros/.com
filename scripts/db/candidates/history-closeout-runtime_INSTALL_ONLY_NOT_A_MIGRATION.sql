SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $preflight$
BEGIN
IF current_user<>'postgres' THEN RAISE EXCEPTION 'CLOSEOUT_ROLE_MISMATCH'; END IF;
IF to_regprocedure('app_private.record_login_failure(text)') IS NULL OR encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('app_private.record_login_failure(text)')),'UTF8')),'hex') <> 'ef44ae545f7a34991dd1cadb2a85091340501454c847f47ff70fc4dafa9d8140' THEN RAISE EXCEPTION 'CLOSEOUT_FUNCTION_DRIFT'; END IF;
IF (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure('app_private.record_login_failure(text)')) IS DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN RAISE EXCEPTION 'CLOSEOUT_ACL_DRIFT'; END IF;
IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure('app_private.record_login_failure(text)'))<>'postgres' THEN RAISE EXCEPTION 'CLOSEOUT_OWNER_DRIFT'; END IF;
IF to_regprocedure('public.complete_stale_kitchen_orders(uuid)') IS NULL OR encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.complete_stale_kitchen_orders(uuid)')),'UTF8')),'hex') <> 'a4c9a46a7d06e707461b4e9d30d78a8a56c9c9d705c93a93bc5d803619ac7197' THEN RAISE EXCEPTION 'CLOSEOUT_FUNCTION_DRIFT'; END IF;
IF (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure('public.complete_stale_kitchen_orders(uuid)')) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}' THEN RAISE EXCEPTION 'CLOSEOUT_ACL_DRIFT'; END IF;
IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure('public.complete_stale_kitchen_orders(uuid)'))<>'postgres' THEN RAISE EXCEPTION 'CLOSEOUT_OWNER_DRIFT'; END IF;
IF to_regprocedure('public.record_login_failure(text)') IS NULL OR encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.record_login_failure(text)')),'UTF8')),'hex') <> '0b217643c62cdcbe8815134f5a3f4bc44263d7e4c05c75e3e902a841f19ac107' THEN RAISE EXCEPTION 'CLOSEOUT_FUNCTION_DRIFT'; END IF;
IF (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure('public.record_login_failure(text)')) IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres,anon=X/postgres}' THEN RAISE EXCEPTION 'CLOSEOUT_ACL_DRIFT'; END IF;
IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure('public.record_login_failure(text)'))<>'postgres' THEN RAISE EXCEPTION 'CLOSEOUT_OWNER_DRIFT'; END IF;
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

DO $report_preflight$ BEGIN
IF encode(sha256(convert_to(pg_get_functiondef('public._build_day_closing_report(uuid,date)'::regprocedure),'UTF8')),'hex')<>'f6f55aff626b32769ae601f71b0567e4ee6fe70390a1d1026606a9a928655f3f' THEN RAISE EXCEPTION 'CLOSEOUT_REPORT_DRIFT';END IF;
IF (SELECT proacl::text FROM pg_proc WHERE oid='public._build_day_closing_report(uuid,date)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN RAISE EXCEPTION 'CLOSEOUT_REPORT_ACL_DRIFT';END IF;
END;$report_preflight$;
CREATE OR REPLACE FUNCTION public._build_day_closing_report(p_branch_id uuid, p_business_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_window jsonb:=public._resolve_business_day_window(p_branch_id,p_business_date);
  v_start timestamptz:=(v_window->>'start_at')::timestamptz;
  v_end timestamptz:=(v_window->>'end_at')::timestamptz;
  v_mode text:=COALESCE(v_window->>'mode','fixed_time');
  v_branch_name text;
  v_sales jsonb:='[]'::jsonb;
  v_expenses jsonb:='[]'::jsonb;
  v_purchases jsonb:='[]'::jsonb;
  v_shifts jsonb:='[]'::jsonb;
  v_users jsonb:='[]'::jsonb;
  v_payments jsonb:='[]'::jsonb;
  v_gross numeric:=0; v_discounts numeric:=0; v_taxes numeric:=0; v_returns numeric:=0;
  v_net_sales numeric:=0; v_expense_total numeric:=0; v_cash_purchases numeric:=0;
  v_cash_sales numeric:=0; v_cash_expenses numeric:=0;
  v_active_shift public.shifts%ROWTYPE;
  v_start_time time:='00:00';
  v_active_business_date date;
BEGIN
  SELECT COALESCE(b.name,b.name_en,'-') INTO v_branch_name
  FROM public.branches b WHERE b.id=p_branch_id;

  -- Live workday = currently open shift, for both fixed_time and shift_span.
  -- Historical/final day close remains on the canonical configured window
  -- because this override disappears as soon as no shift is open.
  SELECT * INTO v_active_shift
  FROM public.shifts s
  WHERE s.branch_id=p_branch_id AND s.status='open'
  ORDER BY s.opened_at DESC,s.id DESC
  LIMIT 1;

  IF v_active_shift.id IS NOT NULL THEN
    SELECT COALESCE(bs.business_day_start,'00:00'::time)
    INTO v_start_time
    FROM public.branch_settings bs
    WHERE bs.branch_id=p_branch_id;

    v_active_business_date := (v_active_shift.opened_at AT TIME ZONE 'Africa/Cairo')::date;
    IF (v_active_shift.opened_at AT TIME ZONE 'Africa/Cairo')::time < v_start_time THEN
      v_active_business_date := v_active_business_date - 1;
    END IF;

    IF v_active_business_date=p_business_date AND COALESCE((v_window->>'active_state')::boolean,false) THEN
      v_start := v_active_shift.opened_at;
      v_end := now();
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sale_id',s.id,'invoice_number',s.invoice_number,'user_id',s.cashier_id,
    'user_name',COALESCE(u.full_name,u.email,'-'),
    'subtotal',s.subtotal,'discount_amount',s.discount_amount,'tax_amount',s.tax_amount,'total',s.total,
    'paid_amount',s.paid_amount,'refunded_amount',COALESCE(s.refunded_amount,0),
    'payment_method',s.payment_method,
    'payments',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'method',st.method,
        'amount',round(st.amount,2)
      ) ORDER BY st.method)
      FROM private.report_sale_settlement_lines(s.id) st
      WHERE st.amount>0
    ),'[]'::jsonb),
    'order_type',s.order_type,'status',s.status,'created_at',s.created_at
  ) ORDER BY s.created_at,s.invoice_number),'[]'::jsonb)
  INTO v_sales
  FROM public.sales s
  LEFT JOIN public.users u ON u.id=s.cashier_id
  WHERE s.branch_id=p_branch_id
    AND COALESCE(s.is_archived,false)=false
    AND s.created_at>=v_start
    AND s.created_at<=v_end;

  SELECT
    COALESCE(sum((x->>'subtotal')::numeric),0),
    COALESCE(sum((x->>'discount_amount')::numeric),0),
    COALESCE(sum((x->>'tax_amount')::numeric),0),
    COALESCE(sum((x->>'refunded_amount')::numeric),0),
    COALESCE(sum((x->>'total')::numeric-(x->>'refunded_amount')::numeric),0)
  INTO v_gross,v_discounts,v_taxes,v_returns,v_net_sales
  FROM jsonb_array_elements(v_sales) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'expense_id',e.id,'category',e.category,'description',e.description,'amount',e.amount,
    'payment_method',COALESCE(e.payment_method,'cash'),'expense_date',e.expense_date,'notes',e.notes,
    'created_at',e.created_at,'created_by',e.created_by,'created_by_name',COALESCE(u.full_name,u.email,'-'),
    'shift_id',e.shift_id
  ) ORDER BY e.created_at,e.id),'[]'::jsonb)
  INTO v_expenses
  FROM public.expenses e
  LEFT JOIN public.users u ON u.id=e.created_by
  WHERE e.branch_id=p_branch_id
    AND e.status='posted'
    AND e.created_at>=v_start
    AND e.created_at<=v_end;

  SELECT
    COALESCE(sum((x->>'amount')::numeric),0),
    COALESCE(sum(CASE WHEN COALESCE(x->>'payment_method','cash')='cash' THEN (x->>'amount')::numeric ELSE 0 END),0)
  INTO v_expense_total,v_cash_expenses
  FROM jsonb_array_elements(v_expenses) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'purchase_id',p.id,'invoice_number',p.invoice_number,'supplier_id',p.supplier_id,
    'supplier_name',COALESCE(sup.name,'-'),'buyer_id',p.buyer_id,'buyer_name',COALESCE(u.full_name,u.email,'-'),
    'subtotal',p.subtotal,'discount_amount',p.discount_amount,'tax_amount',p.tax_amount,'total',p.total,
    'paid_amount',p.paid_amount,'returned_amount',COALESCE(p.returned_amount,0),
    'cash_outflow',GREATEST(COALESCE(p.paid_amount,0)-COALESCE(p.returned_amount,0),0),
    'payment_method',p.payment_method,'status',p.status,'created_at',p.created_at
  ) ORDER BY p.created_at,p.invoice_number),'[]'::jsonb)
  INTO v_purchases
  FROM public.purchases p
  LEFT JOIN public.suppliers sup ON sup.id=p.supplier_id
  LEFT JOIN public.users u ON u.id=p.buyer_id
  WHERE p.branch_id=p_branch_id
    AND COALESCE(p.payment_method,'cash')='cash'
    AND p.created_at>=v_start
    AND p.created_at<=v_end
    AND COALESCE(p.status,'completed') IN ('completed','returned');

  SELECT COALESCE(sum((x->>'cash_outflow')::numeric),0)
  INTO v_cash_purchases
  FROM jsonb_array_elements(v_purchases) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'shift_id',s.id,'cashier_id',s.cashier_id,'cashier_name',COALESCE(u.full_name,u.email,'-'),
    'opened_at',s.opened_at,'closed_at',s.closed_at,'opening_amount',s.opening_amount,
    'expected_amount',s.expected_amount,'actual_amount',s.actual_amount,'difference',s.difference,'status',s.status
  ) ORDER BY s.opened_at,s.id),'[]'::jsonb)
  INTO v_shifts
  FROM public.shifts s
  LEFT JOIN public.users u ON u.id=s.cashier_id
  WHERE s.branch_id=p_branch_id
    AND s.opened_at<=v_end
    AND COALESCE(s.closed_at,now())>=v_start;

  WITH sale_rows AS (
    SELECT s.id
    FROM public.sales s
    WHERE s.branch_id=p_branch_id
      AND COALESCE(s.is_archived,false)=false
      AND s.created_at>=v_start AND s.created_at<=v_end
  ),
  tenders AS (
    SELECT sr.id sale_id,st.method,st.amount,st.source
    FROM sale_rows sr
    CROSS JOIN LATERAL private.report_sale_settlement_lines(sr.id) st
    WHERE st.amount>0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'method',q.method,
    'invoice_count',q.invoice_count,
    'sales_total',q.sales_total,
    'source_quality',q.source_quality
  ) ORDER BY q.method),'[]'::jsonb),
  COALESCE(sum(CASE WHEN q.method='cash' THEN q.sales_total ELSE 0 END),0)
  INTO v_payments,v_cash_sales
  FROM (
    SELECT
      method,
      count(DISTINCT sale_id)::int invoice_count,
      round(sum(amount),2) sales_total,
      CASE
        WHEN bool_or(source='journal_legacy_split') THEN 'legacy_journal_fallback'
        WHEN bool_or(source='receivable') THEN 'receivable'
        ELSE 'canonical'
      END source_quality
    FROM tenders
    GROUP BY method
  ) q;

  WITH ids AS (
    SELECT DISTINCT id FROM (
      SELECT NULLIF(x->>'user_id','')::uuid id FROM jsonb_array_elements(v_sales) x
      UNION ALL SELECT NULLIF(x->>'created_by','')::uuid FROM jsonb_array_elements(v_expenses) x
      UNION ALL SELECT NULLIF(x->>'buyer_id','')::uuid FROM jsonb_array_elements(v_purchases) x
      UNION ALL SELECT NULLIF(x->>'cashier_id','')::uuid FROM jsonb_array_elements(v_shifts) x
    ) z WHERE id IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id',u.id,'display_name',COALESCE(u.full_name,u.email,'-'),
    'invoice_count',(SELECT count(*) FROM jsonb_array_elements(v_sales) x WHERE x->>'user_id'=u.id::text),
    'sales_total',COALESCE((SELECT sum((x->>'total')::numeric) FROM jsonb_array_elements(v_sales) x WHERE x->>'user_id'=u.id::text),0),
    'discounts',COALESCE((SELECT sum((x->>'discount_amount')::numeric) FROM jsonb_array_elements(v_sales) x WHERE x->>'user_id'=u.id::text),0),
    'returns',COALESCE((SELECT sum((x->>'refunded_amount')::numeric) FROM jsonb_array_elements(v_sales) x WHERE x->>'user_id'=u.id::text),0),
    'expenses',COALESCE((SELECT sum((x->>'amount')::numeric) FROM jsonb_array_elements(v_expenses) x WHERE x->>'created_by'=u.id::text),0),
    'cash_purchases',COALESCE((SELECT sum((x->>'cash_outflow')::numeric) FROM jsonb_array_elements(v_purchases) x WHERE x->>'buyer_id'=u.id::text),0),
    'sales',(SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements(v_sales) x WHERE x->>'user_id'=u.id::text),
    'expenses_detail',(SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements(v_expenses) x WHERE x->>'created_by'=u.id::text),
    'cash_purchases_detail',(SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements(v_purchases) x WHERE x->>'buyer_id'=u.id::text)
  ) ORDER BY COALESCE(u.full_name,u.email)),'[]'::jsonb)
  INTO v_users
  FROM ids JOIN public.users u ON u.id=ids.id;

  RETURN jsonb_build_object(
    'success',true,
    'branch_id',p_branch_id,'branch_name',v_branch_name,'business_date',p_business_date,
    'business_day_mode',v_mode,'window_start',v_start,'window_end',v_end,
    'gross_sales',round(v_gross,2),'discounts',round(v_discounts,2),'taxes',round(v_taxes,2),'returns',round(v_returns,2),
    'net_sales',round(v_net_sales,2),'expenses',round(v_expense_total,2),'cash_purchases',round(v_cash_purchases,2),
    'net_after_expenses',round(v_net_sales-v_expense_total,2),
    'net_after_expenses_and_cash_purchases',round(v_net_sales-v_expense_total-v_cash_purchases,2),
    'cash_sales',round(v_cash_sales,2),'cash_expenses',round(v_cash_expenses,2),
    'cash_after_outflows',round(v_cash_sales-v_cash_expenses-v_cash_purchases,2),
    'invoice_count',jsonb_array_length(v_sales),'shift_count',jsonb_array_length(v_shifts),
    'payment_methods',v_payments,'shifts',v_shifts,'sales_details',v_sales,'expense_details',v_expenses,
    'cash_purchase_details',v_purchases,'users',v_users
  );
END;
$function$
;
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
