-- Non-destructive consistency audit for PremierOS signed inventory.
-- Fail if stored product and raw balances diverge, or journal entries are unbalanced.
DO $audit$
DECLARE v_count bigint;
BEGIN
 SELECT count(*) INTO v_count FROM public.inventory i
 WHERE i.quantity IS DISTINCT FROM (
   SELECT COALESCE(SUM(b.quantity),0) FROM public.inventory_batches b
   WHERE b.product_id=i.product_id AND b.branch_id=i.branch_id AND b.warehouse_id=i.warehouse_id);
 IF v_count<>0 THEN RAISE EXCEPTION 'PRODUCT_BALANCE_DRIFT: %',v_count; END IF;
 SELECT count(*) INTO v_count FROM public.raw_material_inventory i
 WHERE i.quantity IS DISTINCT FROM (
   SELECT COALESCE(SUM(b.quantity),0) FROM public.raw_material_batches b
   WHERE b.raw_material_id=i.raw_material_id AND b.branch_id=i.branch_id);
 IF v_count<>0 THEN RAISE EXCEPTION 'RAW_BALANCE_DRIFT: %',v_count; END IF;
 SELECT count(*) INTO v_count FROM (
   SELECT journal_entry_id FROM public.journal_entry_lines GROUP BY journal_entry_id
   HAVING ROUND(SUM(COALESCE(debit,0)-COALESCE(credit,0)),2)<>0
 ) journal_errors;
 IF v_count<>0 THEN RAISE EXCEPTION 'UNBALANCED_JOURNALS: %',v_count; END IF;
END $audit$;