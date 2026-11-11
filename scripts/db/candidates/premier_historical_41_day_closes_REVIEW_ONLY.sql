-- Premier historical close: 41 vetted dates only. NO cron, NO shift mutation.
-- User-approved historical day closes, 2026-11-11. Requires fresh preflight.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='90s';
SET LOCAL search_path=pg_catalog,public,private;
DO $historic$
DECLARE
  r record;
  v_report jsonb;
  v_id uuid;
  v_inserted integer:=0;
  v_before integer;
  v_cutoff timestamptz;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'HISTORICAL_CLOSE_ROLE_MISMATCH'; END IF;
  SELECT count(*) INTO v_before FROM public.daily_closes;
  IF v_before<>20 THEN RAISE EXCEPTION 'HISTORICAL_CLOSE_BASELINE_DRIFT: %',v_before; END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname='auto-business-day-close' AND active)<>0
    THEN RAISE EXCEPTION 'HISTORICAL_CLOSE_SCHEDULER_ACTIVE'; END IF;
  IF (SELECT count(*) FROM public.orders WHERE status IN ('open','held'))<>21
    THEN RAISE EXCEPTION 'HISTORICAL_CLOSE_ORDER_BASELINE_DRIFT'; END IF;
  IF (SELECT count(*) FROM public.shifts WHERE status='open')<>3
    THEN RAISE EXCEPTION 'HISTORICAL_CLOSE_SHIFT_BASELINE_DRIFT'; END IF;

  FOR r IN
    SELECT '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid AS branch_id,
           d::date AS business_date
      FROM generate_series('2026-09-30'::date,'2026-11-08'::date,interval '1 day') d
    UNION ALL
    SELECT '9ede3630-cfc4-401c-9e93-36437a8a907a'::uuid,'2026-09-28'::date
    ORDER BY 1,2
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('auto_business_day_close:'||r.branch_id::text,0));
    IF NOT EXISTS (
      SELECT 1 FROM public.branch_settings bs
      WHERE bs.branch_id=r.branch_id AND bs.business_day_mode='fixed_time'
        AND ((r.branch_id='19c3fd23-d784-455b-8840-f4f2ac619651'::uuid
              AND bs.business_day_start='08:00' AND bs.business_day_end='03:00'
              AND bs.auto_close_shift_at_day_end)
          OR (r.branch_id='9ede3630-cfc4-401c-9e93-36437a8a907a'::uuid
              AND bs.business_day_start='00:00' AND bs.business_day_end='00:00'
              AND NOT bs.auto_close_shift_at_day_end))
    ) THEN RAISE EXCEPTION 'HISTORICAL_CLOSE_SETTINGS_DRIFT: %',r.branch_id; END IF;
    IF (r.branch_id='19c3fd23-d784-455b-8840-f4f2ac619651'::uuid AND
        (SELECT business_date FROM public.business_day_state WHERE branch_id=r.branch_id) IS DISTINCT FROM '2026-11-09'::date)
       OR (r.branch_id='9ede3630-cfc4-401c-9e93-36437a8a907a'::uuid AND
        (SELECT business_date FROM public.business_day_state WHERE branch_id=r.branch_id) IS DISTINCT FROM '2026-09-28'::date)
    THEN RAISE EXCEPTION 'HISTORICAL_CLOSE_STATE_DRIFT: %',r.branch_id; END IF;
    IF EXISTS(SELECT FROM public.daily_closes dc WHERE dc.branch_id=r.branch_id AND dc.business_date=r.business_date)
      THEN RAISE EXCEPTION 'HISTORICAL_CLOSE_DUPLICATE: % %',r.branch_id,r.business_date; END IF;

    v_cutoff:=private.business_day_fixed_cutoff(r.branch_id,r.business_date);
    IF v_cutoff>now() THEN RAISE EXCEPTION 'HISTORICAL_CLOSE_FUTURE'; END IF;
    IF EXISTS(SELECT FROM public.shifts s
      WHERE s.branch_id=r.branch_id AND s.status='open' AND s.opened_at<v_cutoff)
      THEN RAISE EXCEPTION 'HISTORICAL_CLOSE_OPEN_SHIFT_OVERLAP: %',r.business_date; END IF;

    v_report:=private.normalize_day_close_cash(public._build_day_closing_report(r.branch_id,r.business_date),r.branch_id);
    IF v_report->>'success' IS DISTINCT FROM 'true'
       OR COALESCE((v_report->>'invoice_count')::int,0)<>0
       OR COALESCE((v_report->>'gross_sales')::numeric,0)<>0
       OR COALESCE((v_report->>'expenses')::numeric,0)<>0
       OR COALESCE((v_report->>'cash_purchases')::numeric,0)<>0
       OR (v_report->>'window_end')::timestamptz>now()
       OR (v_report->>'window_end')::timestamptz IS DISTINCT FROM v_cutoff
    THEN RAISE EXCEPTION 'HISTORICAL_CLOSE_NONZERO_OR_WINDOW_DRIFT: % %',r.branch_id,r.business_date; END IF;

    INSERT INTO public.daily_closes(branch_id,business_date,status,closed_at,closed_by,report_snapshot)
    VALUES(r.branch_id,r.business_date,'closed',v_cutoff,NULL,v_report)
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'HISTORICAL_CLOSE_NO_INSERT'; END IF;
    v_inserted:=v_inserted+1;
  END LOOP;

  IF v_inserted<>41 OR (SELECT count(*) FROM public.daily_closes)<>v_before+41
    THEN RAISE EXCEPTION 'HISTORICAL_CLOSE_COUNT_MISMATCH: %',v_inserted; END IF;
END;
$historic$;
COMMIT;
