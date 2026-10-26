-- PremierOS non-FIFO product receipt/removal rollback acceptance test.
-- Run only on the authorized test project; leaves no data behind.
BEGIN;
DO $verify$
DECLARE v_add jsonb; v_remove jsonb; v_batches numeric; v_inventory numeric;
BEGIN
 v_add:=public._product_inv_add(
 'd80fca01-9639-45a0-9bc1-817d2940031e',
 '04348dcc-d24c-4b77-99e5-5c6e29551eec',
 '19c3fd23-d784-455b-8840-f4f2ac619651',
 2,9,'VERIFY-20261026',null,null,'adjustment','adjustment',null,'VERIFY',null);
 IF v_add->>'success'<>'true' THEN RAISE EXCEPTION 'RECEIPT_FAILED: %',v_add;END IF;
 v_remove:=private.remove_product_stock_non_fifo_v1(
 'd80fca01-9639-45a0-9bc1-817d2940031e',
 '04348dcc-d24c-4b77-99e5-5c6e29551eec',
 '19c3fd23-d784-455b-8840-f4f2ac619651',
 1,'sale','sale','00000000-0000-0000-0000-000000000881','VERIFY',null);
 IF v_remove->>'success'<>'true' THEN RAISE EXCEPTION 'REMOVAL_FAILED: %',v_remove;END IF;
 SELECT COALESCE(sum(quantity),0) INTO v_batches FROM public.inventory_batches
 WHERE product_id='d80fca01-9639-45a0-9bc1-817d2940031e'
 AND warehouse_id='04348dcc-d24c-4b77-99e5-5c6e29551eec';
 SELECT COALESCE(sum(quantity),0) INTO v_inventory FROM public.inventory
 WHERE product_id='d80fca01-9639-45a0-9bc1-817d2940031e'
 AND warehouse_id='04348dcc-d24c-4b77-99e5-5c6e29551eec';
 IF v_batches<>v_inventory OR v_inventory<>1 THEN
   RAISE EXCEPTION 'PRODUCT_BALANCE_MISMATCH: % %',v_batches,v_inventory;
 END IF;
END $verify$;
ROLLBACK;
