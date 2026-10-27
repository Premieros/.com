CREATE OR REPLACE FUNCTION public._raw_cost_context_for_costing(p_raw_material_id uuid,p_branch_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
 SELECT jsonb_build_object(
  'unit_cost',coalesce(c.unit_cost,0),
  'source',CASE WHEN c.price_event_id IS NULL THEN 'no_published_price' ELSE 'published_price' END,
  'priced_at',c.priced_at,'reference_number',e.reference_number,'detail',e.detail)
 FROM public.raw_materials r
 LEFT JOIN public.raw_material_current_costs c ON c.raw_material_id=r.id AND c.branch_id=r.branch_id
 LEFT JOIN public.raw_material_price_events e ON e.id=c.price_event_id
 WHERE r.id=p_raw_material_id AND r.branch_id=p_branch_id AND p_branch_id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public._raw_cost_context_for_costing(uuid,uuid) FROM PUBLIC,anon;
