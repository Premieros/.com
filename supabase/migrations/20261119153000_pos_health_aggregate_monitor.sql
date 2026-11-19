-- Operations observability, separate from customer-entered data validation.
-- No writes to sales, tenders, accounting, inventory or daily close.
-- Only aggregate counters (no employee, customer, invoice or UUID data).
-- Keep the one-hour posted-journal scan indexed as the ledger grows.
CREATE INDEX IF NOT EXISTS idx_journal_entries_posted_recent_health
  ON public.journal_entries(created_at)
  WHERE posting_status='POSTED';

CREATE TABLE IF NOT EXISTS private.pos_operational_health_samples (
  bucket_start timestamptz NOT NULL,
  metric_code text NOT NULL CHECK (metric_code IN (
    'split_tender_mismatch',
    'posted_journal_imbalance',
    'overdue_fixed_day_close',
    'empty_closed_day_snapshot'
  )),
  category text NOT NULL CHECK (category IN ('transaction_integrity','operational_followup')),
  affected_count integer NOT NULL CHECK (affected_count >= 0),
  status text NOT NULL CHECK (status IN ('ok','review')),
  measured_at timestamptz NOT NULL DEFAULT now(),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  PRIMARY KEY (bucket_start, metric_code)
);
ALTER TABLE private.pos_operational_health_samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.pos_operational_health_samples FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS pos_operational_health_recent_idx
ON private.pos_operational_health_samples (measured_at DESC);

CREATE OR REPLACE FUNCTION private.capture_pos_operational_health()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public, private, pg_temp
AS $function$
DECLARE
  v_now timestamptz := now();
  v_bucket timestamptz := date_trunc('hour',now())
    + floor(extract(minute from now())/15)::integer * interval '15 minutes';
  v_window timestamptz := now()-interval '1 hour';
  v_json jsonb;
BEGIN
  -- This function is only callable by postgres/cron; not from the Data API.
  WITH recent_split AS (
    SELECT s.id,s.paid_amount,
      count(sp.id)::integer tender_count,
      count(DISTINCT sp.payment_method)::integer method_count,
      coalesce(sum(sp.amount),0) tender_sum,
      coalesce(bool_or(sp.amount <= 0 OR sp.refunded_amount < 0
                      OR sp.refunded_amount > sp.amount),false) invalid_refund
    FROM public.sales s
    LEFT JOIN public.sale_payments sp ON sp.sale_id=s.id
    WHERE s.created_at >= v_window AND s.created_at <= v_now
      AND s.payment_method='split'
    GROUP BY s.id,s.paid_amount
  ),
  recent_posted AS (
    SELECT j.id, count(l.id) AS line_count,
      coalesce(sum(coalesce(l.debit,0)-coalesce(l.credit,0)),0) delta
    FROM public.journal_entries j
    LEFT JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id
    WHERE j.created_at >= v_window AND j.created_at <= v_now
      AND j.posting_status='POSTED'
    GROUP BY j.id
  ),
  overdue AS (
    SELECT b.id
    FROM public.branches b
    JOIN public.organizations o ON o.id=b.organization_id
    JOIN public.branch_settings bs ON bs.branch_id=b.id
    JOIN public.business_day_state st ON st.branch_id=b.id
    CROSS JOIN LATERAL (
      SELECT coalesce(
        (SELECT max(dc.business_date)+1 FROM public.daily_closes dc
         WHERE dc.branch_id=b.id),
        st.business_date
      ) AS candidate_date
    ) d
    WHERE b.is_active AND o.is_active
      AND bs.business_day_mode='fixed_time'
      AND d.candidate_date IS NOT NULL
      AND d.candidate_date<=st.business_date
      AND private.business_day_fixed_cutoff(b.id,d.candidate_date)
            < v_now-interval '10 minutes'
      AND NOT EXISTS(
        SELECT 1 FROM public.daily_closes dc
        WHERE dc.branch_id=b.id AND dc.business_date=d.candidate_date
      )
  ),
  metrics AS (
    SELECT 'split_tender_mismatch'::text code,'transaction_integrity'::text category,
      count(*)::integer n FROM recent_split
      WHERE tender_count<2 OR method_count<2 OR abs(tender_sum-paid_amount)>0.01
        OR invalid_refund
    UNION ALL
    SELECT 'posted_journal_imbalance','transaction_integrity',count(*)::integer
    FROM recent_posted WHERE line_count=0 OR abs(delta)>0.01
    UNION ALL
    SELECT 'overdue_fixed_day_close','operational_followup',count(*)::integer
    FROM overdue
    UNION ALL
    SELECT 'empty_closed_day_snapshot','operational_followup',count(*)::integer
    FROM public.daily_closes dc
    WHERE dc.closed_at >= v_now-interval '24 hours'
      AND dc.status='closed'
      AND (dc.report_snapshot IS NULL OR dc.report_snapshot='{}'::jsonb)
  ),
  upserted AS (
    INSERT INTO private.pos_operational_health_samples(
      bucket_start,metric_code,category,affected_count,status,
      measured_at,window_start,window_end
    )
    SELECT v_bucket,code,category,n,CASE WHEN n>0 THEN 'review' ELSE 'ok' END,
      v_now,v_window,v_now
    FROM metrics
    ON CONFLICT (bucket_start,metric_code) DO UPDATE SET
      affected_count=EXCLUDED.affected_count,
      status=EXCLUDED.status,
      measured_at=EXCLUDED.measured_at,
      window_start=EXCLUDED.window_start,
      window_end=EXCLUDED.window_end
    RETURNING metric_code,category,affected_count,status
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'metric',metric_code,'category',category,'affected_count',affected_count,
    'status',status) ORDER BY metric_code),'[]'::jsonb)
  INTO v_json FROM upserted;

  RETURN jsonb_build_object('sampled_at',v_now,'bucket_start',v_bucket,
    'lookback_minutes',60,'metrics',v_json,
    'note','Review counters are diagnostic signals, not automatic evidence of a software defect');
END;
$function$;
REVOKE ALL ON FUNCTION private.capture_pos_operational_health() FROM PUBLIC,anon,authenticated;

-- Install the small scheduled aggregate check only when pg_cron exists.
-- Local CI migration replay has no cron extension, so its test invokes the
-- private capture function directly.
DO $cronsetup$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.schedule('premier-pos-operational-health','*/15 * * * *',
      'SELECT private.capture_pos_operational_health();');
  END IF;
END
$cronsetup$;
