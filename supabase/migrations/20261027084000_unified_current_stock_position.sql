CREATE OR REPLACE VIEW public.v_current_stock_position WITH (security_invoker=true) AS
SELECT b.item_type,b.item_id,b.branch_id,b.warehouse_id,b.item_name,b.quantity,
COALESCE(c.unit_cost,0)::numeric unit_cost,
(b.quantity * COALESCE(c.unit_cost,0))::numeric current_stock_value,
COALESCE(s.sale_price,0)::numeric sale_price,
COALESCE(c.cost_source,'unknown')::text cost_source
FROM public.v_stock_balances_unified b
LEFT JOIN public.v_stock_current_costs c ON c.item_type=b.item_type AND c.item_id=b.item_id AND c.branch_id=b.branch_id
LEFT JOIN public.v_current_sale_prices s ON s.item_type=b.item_type AND s.item_id=b.item_id AND s.branch_id=b.branch_id;
GRANT SELECT ON public.v_current_stock_position TO authenticated,service_role;
COMMENT ON VIEW public.v_current_stock_position IS 'Single signed stock quantity, current cost and catalog offer-price read contract. Historical transactions retain recorded amounts.';