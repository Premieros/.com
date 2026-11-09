-- MIRRORED VERBATIM from already-applied Premier production migration history.
-- Version: 20261109073617; name: premier_inventory_tenant_keys_stage1_20261109
-- DO NOT manually rerun on production. A fresh database replays sequentially.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='20s';
DO $guard$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname IN ('premier_warehouses_id_branch_uq','premier_products_id_branch_uq','premier_inventory_warehouse_branch_fk','premier_inventory_product_branch_fk')) THEN RAISE EXCEPTION 'TENANT_INVENTORY_KEYS_ALREADY_PRESENT'; END IF;
 IF EXISTS (SELECT 1 FROM public.inventory i JOIN public.warehouses w ON w.id=i.warehouse_id WHERE i.branch_id IS DISTINCT FROM w.branch_id) THEN RAISE EXCEPTION 'INVENTORY_WAREHOUSE_TENANT_MISMATCH'; END IF;
 IF EXISTS (SELECT 1 FROM public.inventory i JOIN public.products p ON p.id=i.product_id WHERE i.branch_id IS DISTINCT FROM p.branch_id) THEN RAISE EXCEPTION 'INVENTORY_PRODUCT_TENANT_MISMATCH'; END IF;
END $guard$;
ALTER TABLE public.warehouses ADD CONSTRAINT premier_warehouses_id_branch_uq UNIQUE (id,branch_id);
ALTER TABLE public.products ADD CONSTRAINT premier_products_id_branch_uq UNIQUE (id,branch_id);
ALTER TABLE public.inventory ADD CONSTRAINT premier_inventory_warehouse_branch_fk FOREIGN KEY (warehouse_id,branch_id) REFERENCES public.warehouses(id,branch_id) NOT VALID;
ALTER TABLE public.inventory ADD CONSTRAINT premier_inventory_product_branch_fk FOREIGN KEY (product_id,branch_id) REFERENCES public.products(id,branch_id) NOT VALID;
COMMIT;
