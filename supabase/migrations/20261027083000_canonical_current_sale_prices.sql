-- Current offer prices. Historic sale_items.unit_price remains the transactional snapshot.
CREATE OR REPLACE VIEW public.v_current_sale_prices WITH (security_invoker=true) AS
SELECT 'product'::text item_type,id item_id,branch_id,name::text item_name,COALESCE(sale_price,0)::numeric sale_price FROM public.products
UNION ALL
SELECT 'manufactured'::text,id,branch_id,name::text,COALESCE(sale_price,0)::numeric FROM public.inventory_units;
GRANT SELECT ON public.v_current_sale_prices TO authenticated,service_role;
COMMENT ON VIEW public.v_current_sale_prices IS 'Current catalog offer price only; recorded sale_items.unit_price is the immutable sale-time price.';