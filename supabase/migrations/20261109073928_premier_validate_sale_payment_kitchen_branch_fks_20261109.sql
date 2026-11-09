-- MIRRORED VERBATIM from already-applied Premier production migration history.
-- Version: 20261109073928; name: premier_validate_sale_payment_kitchen_branch_fks_20261109
-- DO NOT manually rerun on production. A fresh database replays sequentially.
BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='25s'; ALTER TABLE public.sale_payments VALIDATE CONSTRAINT premier_sale_payments_sale_branch_fk; ALTER TABLE public.order_kitchen_sends VALIDATE CONSTRAINT premier_kitchen_send_order_branch_fk; ALTER TABLE public.order_kitchen_sends VALIDATE CONSTRAINT premier_kitchen_send_item_order_fk; COMMIT;
