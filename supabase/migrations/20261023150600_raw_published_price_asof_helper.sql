-- Dependency of sale snapshot price lookup; service role only.
CREATE OR REPLACE FUNCTION private.raw_published_unit_cost_at_v2(p_raw_material_id uuid, p_branch_id uuid, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE
 WHEN rm.id IS NULL THEN jsonb_build_object('success',false,'error','MATERIAL_BRANCH_MISMATCH')
 ELSE jsonb_build_object(
 'success',true,
 'unit_cost',coalesce(pe.unit_cost,0),
 'source',CASE WHEN pe.id IS NULL THEN 'no_published_price' ELSE 'published_price' END,
 'price_event_id',pe.id,
 'priced_at',pe.priced_at)
 END
 FROM (SELECT 1) seed
 LEFT JOIN public.raw_materials rm ON rm.id=p_raw_material_id AND rm.branch_id=p_branch_id
 LEFT JOIN LATERAL (
  SELECT e.id,e.unit_cost,e.priced_at
  FROM public.raw_material_price_events e
  WHERE e.raw_material_id=rm.id AND e.branch_id=rm.branch_id
   AND e.priced_at<=p_at AND e.unit_cost>0
  ORDER BY e.priced_at DESC,e.id DESC LIMIT 1
 ) pe ON true;
$function$

REVOKE ALL ON FUNCTION private.raw_published_unit_cost_at_v2(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.raw_published_unit_cost_at_v2(uuid,uuid,timestamptz) TO service_role;
