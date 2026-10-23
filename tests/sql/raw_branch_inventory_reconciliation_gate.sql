-- Stop non-FIFO cutover when material totals disagree with signed batch inventory.
-- Currently expected to raise until legacy drift is reconciled with source documents.
DO $$
DECLARE v_count integer;
BEGIN
 SELECT COUNT(*) INTO v_count
 FROM public.raw_material_inventory i
 WHERE i.quantity IS DISTINCT FROM (
   SELECT COALESCE(SUM(b.quantity),0)
   FROM public.raw_material_batches b
   WHERE b.branch_id=i.branch_id AND b.raw_material_id=i.raw_material_id
 );
 IF v_count<>0 THEN
   RAISE EXCEPTION 'RAW_BRANCH_INVENTORY_DRIFT: % mismatched raw balances',v_count;
 END IF;
END $$;
