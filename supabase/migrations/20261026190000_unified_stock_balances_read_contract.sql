-- Same warehouse balances used by sale stock writers; signed quantities never clamped to zero.
CREATE OR REPLACE VIEW public.v_stock_balances_unified WITH (security_invoker = true) AS
SELECT 'product'::text item_type,i.product_id item_id,i.branch_id,i.warehouse_id,p.name::text item_name,i.quantity::numeric quantity
FROM public.inventory i JOIN public.products p ON p.id=i.product_id AND p.branch_id=i.branch_id
UNION ALL
SELECT 'raw'::text,b.raw_material_id,b.branch_id,b.warehouse_id,r.name::text,sum(b.quantity)::numeric
FROM public.raw_material_batches b JOIN public.raw_materials r ON r.id=b.raw_material_id AND r.branch_id=b.branch_id
WHERE b.warehouse_id IS NOT NULL GROUP BY b.raw_material_id,b.branch_id,b.warehouse_id,r.name
UNION ALL
SELECT 'manufactured'::text,b.unit_id,b.branch_id,b.warehouse_id,u.name::text,sum(b.quantity)::numeric
FROM public.inventory_unit_batches b JOIN public.inventory_units u ON u.id=b.unit_id AND u.branch_id=b.branch_id
WHERE b.warehouse_id IS NOT NULL GROUP BY b.unit_id,b.branch_id,b.warehouse_id,u.name;
GRANT SELECT ON public.v_stock_balances_unified TO authenticated,service_role;
COMMENT ON VIEW public.v_stock_balances_unified IS 'Single read contract for signed warehouse stock; sales write same underlying tables transactionally.';
