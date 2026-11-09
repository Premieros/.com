-- MIRRORED VERBATIM from already-applied Premier production migration history.
-- Version: 20261109073839; name: premier_payments_kitchen_composite_foreign_keys_stage5_20261109
-- DO NOT manually rerun on production. A fresh database replays sequentially.
BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='20s';
DO $guard$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('premier_sale_payments_sale_branch_fk','premier_kitchen_send_order_branch_fk','premier_kitchen_send_item_order_fk')) THEN RAISE EXCEPTION 'SALE_KITCHEN_FK_ALREADY_PRESENT'; END IF;
 IF EXISTS (SELECT 1 FROM public.sale_payments p JOIN public.sales s ON s.id=p.sale_id WHERE p.branch_id IS DISTINCT FROM s.branch_id) THEN RAISE EXCEPTION 'PAYMENT_SALE_BRANCH_MISMATCH'; END IF;
 IF EXISTS (SELECT 1 FROM public.order_kitchen_sends s JOIN public.orders o ON o.id=s.order_id WHERE s.branch_id IS DISTINCT FROM o.branch_id) THEN RAISE EXCEPTION 'KITCHEN_ORDER_BRANCH_MISMATCH'; END IF;
 IF EXISTS (SELECT 1 FROM public.order_kitchen_sends s JOIN public.order_items i ON i.id=s.order_item_id WHERE s.order_id IS DISTINCT FROM i.order_id) THEN RAISE EXCEPTION 'KITCHEN_LINE_PARENT_MISMATCH'; END IF;
END $guard$;
ALTER TABLE public.sale_payments ADD CONSTRAINT premier_sale_payments_sale_branch_fk
 FOREIGN KEY (sale_id,branch_id) REFERENCES public.sales(id,branch_id)
 ON DELETE CASCADE NOT VALID;
ALTER TABLE public.order_kitchen_sends ADD CONSTRAINT premier_kitchen_send_order_branch_fk
 FOREIGN KEY (order_id,branch_id) REFERENCES public.orders(id,branch_id)
 ON DELETE CASCADE NOT VALID;
ALTER TABLE public.order_kitchen_sends ADD CONSTRAINT premier_kitchen_send_item_order_fk
 FOREIGN KEY (order_item_id,order_id) REFERENCES public.order_items(id,order_id)
 ON DELETE CASCADE NOT VALID;
COMMIT;
