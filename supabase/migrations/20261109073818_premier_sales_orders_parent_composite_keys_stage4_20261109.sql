-- MIRRORED VERBATIM from already-applied Premier production migration history.
-- Version: 20261109073818; name: premier_sales_orders_parent_composite_keys_stage4_20261109
-- DO NOT manually rerun on production. A fresh database replays sequentially.
BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='20s';
DO $guard$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('premier_sales_id_branch_uq','premier_orders_id_branch_uq','premier_order_items_id_order_uq')) THEN RAISE EXCEPTION 'SALE_ORDER_PARENT_KEYS_ALREADY_PRESENT'; END IF;
END $guard$;
ALTER TABLE public.sales ADD CONSTRAINT premier_sales_id_branch_uq UNIQUE (id,branch_id);
ALTER TABLE public.orders ADD CONSTRAINT premier_orders_id_branch_uq UNIQUE (id,branch_id);
ALTER TABLE public.order_items ADD CONSTRAINT premier_order_items_id_order_uq UNIQUE (id,order_id);
COMMIT;
