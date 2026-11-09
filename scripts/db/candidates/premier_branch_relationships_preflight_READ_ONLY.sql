-- READ-ONLY database relationship and RLS preflight (2026-11-09).
-- Run on production only as SELECT; do not write any data or DDL.
-- These counts must ALL be zero before enabling candidate composite FKs.
SELECT 'orders_wrong_warehouse' AS check_name, COUNT(*) AS violations
FROM public.orders o JOIN public.warehouses w ON w.id=o.inventory_warehouse_id
WHERE o.branch_id IS DISTINCT FROM w.branch_id
UNION ALL
SELECT 'sales_wrong_warehouse', COUNT(*)
FROM public.sales s JOIN public.warehouses w ON w.id=s.warehouse_id
WHERE s.branch_id IS DISTINCT FROM w.branch_id
UNION ALL
SELECT 'inventory_wrong_warehouse', COUNT(*)
FROM public.inventory i JOIN public.warehouses w ON w.id=i.warehouse_id
WHERE i.branch_id IS DISTINCT FROM w.branch_id
UNION ALL
SELECT 'inventory_wrong_product', COUNT(*)
FROM public.inventory i JOIN public.products p ON p.id=i.product_id
WHERE i.branch_id IS DISTINCT FROM p.branch_id
UNION ALL
SELECT 'purchases_wrong_warehouse', COUNT(*)
FROM public.purchases p JOIN public.warehouses w ON w.id=p.warehouse_id
WHERE p.branch_id IS DISTINCT FROM w.branch_id
UNION ALL
SELECT 'stock_counts_wrong_warehouse', COUNT(*)
FROM public.stock_counts sc JOIN public.warehouses w ON w.id=sc.warehouse_id
WHERE sc.branch_id IS DISTINCT FROM w.branch_id
UNION ALL
SELECT 'recipes_wrong_product', COUNT(*)
FROM public.recipes r JOIN public.products p ON p.id=r.product_id
WHERE r.branch_id IS DISTINCT FROM p.branch_id
UNION ALL
SELECT 'payments_wrong_sale', COUNT(*)
FROM public.sale_payments sp JOIN public.sales s ON s.id=sp.sale_id
WHERE sp.branch_id IS DISTINCT FROM s.branch_id
UNION ALL
SELECT 'kitchen_wrong_order_branch', COUNT(*)
FROM public.order_kitchen_sends k JOIN public.orders o ON o.id=k.order_id
WHERE k.branch_id IS DISTINCT FROM o.branch_id
UNION ALL
SELECT 'kitchen_wrong_item_order', COUNT(*)
FROM public.order_kitchen_sends k JOIN public.order_items i ON i.id=k.order_item_id
WHERE k.order_id IS DISTINCT FROM i.order_id
ORDER BY check_name;

-- RLS coverage and potentially bypassing overlapping permissive policies.
SELECT tablename, policyname, permissive, cmd, roles::text,
       qual, with_check
FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('expenses','sale_items','sales','product_unit_links')
ORDER BY tablename,policyname;
