-- Daily close performance: closed days are immutable report snapshots.
-- Do not change source sale/journal/stock records, and do not install new schedulers.
-- The existing close workers already materialize public.daily_closes.report_snapshot.
--
-- Important: cash normalization happens when an automatic/manual day is sealed.
-- Re-running it when *reading* a sealed day scans operational expenses and can
-- make a previous period appear to change after later corrections.
CREATE OR REPLACE FUNCTION public.get_day_closing_report(
  p_branch_id uuid, p_day date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_snapshot jsonb;
  v_exists boolean := false;
  v_state jsonb;
  v_state_date date;
  v_has_open_shift boolean := false;
  v_report jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF NOT public.is_pos_admin()
     AND NOT public.can_permission('shifts.day_close')
     AND NOT public.can_permission('shifts.report.shift') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
  END IF;
  IF p_branch_id IS NULL OR p_day IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_DAY_CLOSE_SCOPE');
  END IF;

  -- Critical fast path: no shift read, no state initialization, and no scans of
  -- sales, purchases, expenses, settlements or inventory for a sealed day.
  SELECT dc.report_snapshot, true
  INTO v_snapshot, v_exists
  FROM public.daily_closes dc
  WHERE dc.branch_id = p_branch_id AND dc.business_date = p_day
    AND dc.status = 'closed';

  IF COALESCE(v_exists,false) THEN
    -- A damaged/empty sealed snapshot is not an instruction to recompute
    -- historic financial figures from mutable source records.
    IF v_snapshot IS NULL OR v_snapshot = '{}'::jsonb THEN
      RETURN jsonb_build_object(
        'success',false,'error','DAY_CLOSE_SNAPSHOT_MISSING',
        'daily_close_status','closed','snapshot',false,'active_business_day',false
      );
    END IF;
    RETURN v_snapshot || jsonb_build_object(
      'daily_close_status','closed','snapshot',true,'active_business_day',false
    );
  END IF;

  -- Only an unclosed day is live. The existing branch-specific time window
  -- and open-shift rules remain authoritative.
  v_state := public._ensure_business_day_state(p_branch_id);
  v_state_date := NULLIF(v_state->>'business_date','')::date;
  SELECT EXISTS (
    SELECT 1 FROM public.shifts s
    WHERE s.branch_id=p_branch_id AND s.status='open'
  ) INTO v_has_open_shift;

  v_report := private.normalize_day_close_cash(
    public._build_day_closing_report(p_branch_id,p_day),p_branch_id
  );
  RETURN v_report || jsonb_build_object(
    'daily_close_status','open',
    'snapshot',false,
    'active_business_day', v_state_date=p_day AND v_has_open_shift
  );
END;
$function$;

-- Make close-idempotency an actual read-only operation on previously sealed
-- days, including after the next shift has opened.
CREATE OR REPLACE FUNCTION public._finalize_day_close(
  p_branch_id uuid,p_business_date date,p_closed_by uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_report jsonb;
  v_existing jsonb;
  v_window jsonb;
  v_mode text;
BEGIN
  IF p_branch_id IS NULL OR p_business_date IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_DAY_CLOSE_SCOPE');
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('day_close:'||p_branch_id::text||':'||p_business_date::text,0)
  );
  SELECT id,report_snapshot INTO v_id,v_existing
  FROM public.daily_closes
  WHERE branch_id=p_branch_id AND business_date=p_business_date;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success',true,'already_closed',true,'daily_close_id',v_id,
      'report',v_existing
    );
  END IF;

  IF EXISTS(
    SELECT 1 FROM public.shifts
    WHERE branch_id=p_branch_id AND status='open'
  ) THEN
    RETURN jsonb_build_object('success',false,'error','OPEN_SHIFTS_REMAIN');
  END IF;

  v_window := public._resolve_business_day_window(p_branch_id,p_business_date);
  v_mode := COALESCE(v_window->>'mode','fixed_time');
  IF v_mode='shift_span'
     AND COALESCE((v_window->>'has_shifts')::boolean,false) IS NOT TRUE THEN
    RETURN jsonb_build_object('success',false,'error','NO_SHIFTS_FOR_DAY');
  END IF;

  v_report := private.normalize_day_close_cash(
    public._build_day_closing_report(p_branch_id,p_business_date),p_branch_id
  );
  INSERT INTO public.daily_closes(branch_id,business_date,closed_by,report_snapshot)
  VALUES(p_branch_id,p_business_date,p_closed_by,v_report)
  ON CONFLICT(branch_id,business_date) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id,report_snapshot INTO v_id,v_existing
    FROM public.daily_closes
    WHERE branch_id=p_branch_id AND business_date=p_business_date;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'DAY_CLOSE_CONCURRENT_INSERT_NOT_VISIBLE';
    END IF;
    RETURN jsonb_build_object(
      'success',true,'already_closed',true,'daily_close_id',v_id,
      'report',v_existing
    );
  END IF;

  RETURN jsonb_build_object(
    'success',true,'already_closed',false,'daily_close_id',v_id,'report',v_report
  );
END;
$function$;
