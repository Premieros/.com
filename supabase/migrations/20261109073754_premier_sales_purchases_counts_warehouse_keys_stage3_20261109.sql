-- MIRRORED VERBATIM from already-applied Premier production migration history.
-- Version: 20261109073754; name: premier_sales_purchases_counts_warehouse_keys_stage3_20261109
-- DO NOT manually rerun on production. A fresh database replays sequentially.
BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='18s';
DO $guard$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('premier_purchases_warehouse_branch_fk','premier_sales_warehouse_branch_fk','premier_stock_counts_warehouse_branch_fk')) THEN RAISE EXCEPTION 'STAGE3_CONSTRAINT_PRESENT'; END IF;
 IF EXISTS (SELECT 1 FROM public.purchases p JOIN public.warehouses w ON w.id=p.warehouse_id WHERE p.branch_id IS DISTINCT FROM w.branch_id) THEN RAISE EXCEPTION 'PURCHASE_WAREHOUSE_BRANCH_MISMATCH'; END IF;
 IF EXISTS (SELECT 1 FROM public.sales s JOIN public.warehouses w ON w.id=s.warehouse_id WHERE s.branch_id IS DISTINCT FROM w.branch_id) THEN RAISE EXCEPTION 'SALE_WAREHOUSE_BRANCH_MISMATCH'; END IF;
 IF EXISTS (SELECT 1 FROM public.stock_counts s JOIN public.warehouses w ON w.id=s.warehouse_id WHERE s.branch_id IS DISTINCT FROM w.branch_id) THEN RAISE EXCEPTION 'COUNT_WAREHOUSE_BRANCH_MISMATCH'; END IF;
END $guard$;
ALTER TABLE public.purchases ADD CONSTRAINT premier_purchases_warehouse_branch_fk
 FOREIGN KEY (warehouse_id,branch_id) REFERENCES public.warehouses(id,branch_id)
 ON DELETE SET NULL (warehouse_id) NOT VALID;
ALTER TABLE public.sales ADD CONSTRAINT premier_sales_warehouse_branch_fk
 FOREIGN KEY (warehouse_id,branch_id) REFERENCES public.warehouses(id,branch_id)
 ON DELETE SET NULL (warehouse_id) NOT VALID;
ALTER TABLE public.stock_counts ADD CONSTRAINT premier_stock_counts_warehouse_branch_fk
 FOREIGN KEY (warehouse_id,branch_id) REFERENCES public.warehouses(id,branch_id)
 ON DELETE RESTRICT NOT VALID;
COMMIT;
