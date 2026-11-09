-- MIRRORED VERBATIM from already-applied Premier production migration history.
-- Version: 20261109073733; name: premier_orders_recipes_branch_foreign_keys_stage2_20261109
-- DO NOT manually rerun on production. A fresh database replays sequentially.
BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='18s';
DO $guard$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('premier_orders_warehouse_branch_fk','premier_recipes_product_branch_fk')) THEN RAISE EXCEPTION 'STAGE2_CONSTRAINT_PRESENT'; END IF;
 IF EXISTS (SELECT 1 FROM public.orders o JOIN public.warehouses w ON w.id=o.inventory_warehouse_id WHERE o.branch_id IS DISTINCT FROM w.branch_id) THEN RAISE EXCEPTION 'ORDERS_WAREHOUSE_BRANCH_MISMATCH'; END IF;
 IF EXISTS (SELECT 1 FROM public.recipes r JOIN public.products p ON p.id=r.product_id WHERE r.branch_id IS DISTINCT FROM p.branch_id) THEN RAISE EXCEPTION 'RECIPES_PRODUCT_BRANCH_MISMATCH'; END IF;
END $guard$;
ALTER TABLE public.orders ADD CONSTRAINT premier_orders_warehouse_branch_fk
 FOREIGN KEY (inventory_warehouse_id,branch_id)
 REFERENCES public.warehouses(id,branch_id) ON DELETE SET NULL (inventory_warehouse_id) NOT VALID;
ALTER TABLE public.recipes ADD CONSTRAINT premier_recipes_product_branch_fk
 FOREIGN KEY (product_id,branch_id) REFERENCES public.products(id,branch_id) ON DELETE CASCADE NOT VALID;
COMMIT;
