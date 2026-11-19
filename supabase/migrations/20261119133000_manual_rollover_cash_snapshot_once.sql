-- Keep the existing manual rollover/shift-preservation behavior unchanged.
-- One-time cash normalization must be committed with the day-close snapshot.
CREATE OR REPLACE FUNCTION public.rollover_business_day(p_branch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_state public.business_day_state%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_report jsonb;
  v_close_id uuid;
  v_next_date date;
  v_now timestamptz:=now();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('shifts.day_close') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','shifts.day_close');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('business_day_state:'||p_branch_id::text,0));
  PERFORM public._ensure_business_day_state(p_branch_id);

  SELECT * INTO v_state
  FROM public.business_day_state
  WHERE branch_id=p_branch_id
  FOR UPDATE;

  SELECT * INTO v_shift
  FROM public.shifts s
  WHERE s.branch_id=p_branch_id AND s.status='open'
  ORDER BY s.opened_at DESC,s.id DESC
  LIMIT 1;

  IF v_shift.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','NO_OPEN_SHIFT_FOR_ROLLOVER');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.daily_closes dc
    WHERE dc.branch_id=p_branch_id AND dc.business_date=v_state.business_date
  ) THEN
    RETURN jsonb_build_object('success',false,'error','CURRENT_BUSINESS_DAY_ALREADY_CLOSED');
  END IF;

  -- Normalize exactly once at sealing, not on each read of a closed date.
  v_report:=private.normalize_day_close_cash(
    public._build_day_closing_report(p_branch_id,v_state.business_date),
    p_branch_id
  );

  INSERT INTO public.daily_closes(branch_id,business_date,closed_by,report_snapshot)
  VALUES(p_branch_id,v_state.business_date,v_uid,v_report)
  RETURNING id INTO v_close_id;

  v_next_date:=public._next_unclosed_business_date(p_branch_id,v_state.business_date+1);

  UPDATE public.business_day_state
  SET business_date=v_next_date,
      started_at=v_now,
      updated_at=v_now
  WHERE branch_id=p_branch_id;

  PERFORM public.log_audit_action(
    p_branch_id,
    'business_day_rollover',
    'daily_close',
    v_close_id,
    jsonb_build_object(
      'closed_business_date',v_state.business_date,
      'next_business_date',v_next_date,
      'shift_id',v_shift.id,
      'shift_preserved',true,
      'boundary_at',v_now
    )
  );

  RETURN jsonb_build_object(
    'success',true,
    'rolled_over',true,
    'daily_close_id',v_close_id,
    'closed_business_date',v_state.business_date,
    'next_business_date',v_next_date,
    'shift_id',v_shift.id,
    'shift_preserved',true,
    'boundary_at',v_now,
    'report',v_report
  );
END;
$function$
;
