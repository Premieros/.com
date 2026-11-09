-- MIRRORED VERBATIM from already-applied Premier production migration history.
-- Version: 20261109073705; name: premier_inventory_composite_fk_delete_parity_20261109
-- DO NOT manually rerun on production. A fresh database replays sequentially.
BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='15s';
DO $guard$ BEGIN
 IF (SELECT count(*) FROM pg_constraint WHERE conname IN ('premier_inventory_warehouse_branch_fk','premier_inventory_product_branch_fk') AND confdeltype='a')<>2 THEN RAISE EXCEPTION 'INVENTORY_FK_BASELINE_DRIFT'; END IF;
END $guard$;
ALTER TABLE public.inventory DROP CONSTRAINT premier_inventory_warehouse_branch_fk;
ALTER TABLE public.inventory DROP CONSTRAINT premier_inventory_product_branch_fk;
ALTER TABLE public.inventory ADD CONSTRAINT premier_inventory_warehouse_branch_fk
 FOREIGN KEY (warehouse_id,branch_id) REFERENCES public.warehouses(id,branch_id)
 ON DELETE CASCADE NOT VALID;
ALTER TABLE public.inventory ADD CONSTRAINT premier_inventory_product_branch_fk
 FOREIGN KEY (product_id,branch_id) REFERENCES public.products(id,branch_id)
 ON DELETE CASCADE NOT VALID;
COMMIT;
