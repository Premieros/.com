-- MIRRORED VERBATIM from already-applied Premier production migration history.
-- Version: 20261109073920; name: premier_validate_inventory_branch_fks_20261109
-- DO NOT manually rerun on production. A fresh database replays sequentially.
BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='20s'; ALTER TABLE public.inventory VALIDATE CONSTRAINT premier_inventory_warehouse_branch_fk; ALTER TABLE public.inventory VALIDATE CONSTRAINT premier_inventory_product_branch_fk; COMMIT;
