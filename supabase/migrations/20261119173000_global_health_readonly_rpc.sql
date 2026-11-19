-- Global POS operational counters are cross-tenant aggregates.
-- They must only be visible to authenticated active GLOBAL super_admins.
CREATE OR REPLACE FUNCTION public.get_pos_operational_health_recent(
 p_buckets integer DEFAULT 24
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog,public,private,pg_temp
AS $function$
DECLARE
 v_limit integer := greatest(1,least(coalesce(p_buckets,24),96));
 v_metrics jsonb;
 v_last timestamptz;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
   SELECT 1 FROM public.users u
   WHERE u.id=auth.uid() AND u.role='super_admin'
     AND u.branch_id IS NULL AND u.is_active AND NOT coalesce(u.is_locked,false)
 ) THEN
   RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
 END IF;

 SELECT max(s.measured_at) INTO v_last
 FROM private.pos_operational_health_samples s;

 WITH slots AS (
   SELECT DISTINCT s.bucket_start
   FROM private.pos_operational_health_samples s
   ORDER BY s.bucket_start DESC
   LIMIT v_limit
 ),
 selected AS (
   SELECT s.bucket_start,s.measured_at,s.metric_code,s.category,
     s.affected_count,s.status
   FROM private.pos_operational_health_samples s
   JOIN slots b ON b.bucket_start=s.bucket_start
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'bucket_start',bucket_start,
   'measured_at',measured_at,
   'metric',metric_code,
   'category',category,
   'affected_count',affected_count,
   'status',status
 ) ORDER BY bucket_start DESC,metric_code),'[]'::jsonb)
 INTO v_metrics FROM selected;

 RETURN jsonb_build_object(
   'success',true,
   'source','server_aggregate',
   'global_scope',true,
   'sample_interval_minutes',15,
   'last_sampled_at',v_last,
   'rows',v_metrics,
   'disclaimer','review indicators do not imply a confirmed program defect'
 );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_operational_health_recent(integer)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_pos_operational_health_recent(integer)
 TO authenticated;
