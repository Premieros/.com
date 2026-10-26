-- Canonical current display cost, not a historical journal repricing.
CREATE OR REPLACE VIEW public.v_stock_current_costs WITH (security_invoker=true) AS
SELECT 'raw'::text item_type,r.id item_id,r.branch_id,r.name::text item_name,
COALESCE(e.unit_cost,0)::numeric unit_cost,e.priced_at cost_effective_at,
CASE WHEN e.id IS NULL THEN 'no_published_price_zero' ELSE 'published_raw_price' END::text cost_source
FROM public.raw_materials r
LEFT JOIN LATERAL (
 SELECT pe.id,pe.unit_cost,pe.priced_at FROM public.raw_material_price_events pe
 WHERE pe.raw_material_id=r.id AND pe.branch_id=r.branch_id AND pe.priced_at<=now()
 ORDER BY pe.priced_at DESC,pe.id DESC LIMIT 1
) e ON true
UNION ALL
SELECT 'product'::text,p.id,p.branch_id,p.name::text,COALESCE(p.cost_price,0)::numeric,NULL::timestamptz,'product_catalog_cost'::text FROM public.products p
UNION ALL
SELECT 'manufactured'::text,u.id,u.branch_id,u.name::text,COALESCE(u.cost_price,0)::numeric,NULL::timestamptz,'inventory_unit_catalog_cost'::text FROM public.inventory_units u;
GRANT SELECT ON public.v_stock_current_costs TO authenticated,service_role;
COMMENT ON VIEW public.v_stock_current_costs IS 'Canonical current display cost. Historical journal and stock movement costs remain immutable; raw missing published price is zero.';
