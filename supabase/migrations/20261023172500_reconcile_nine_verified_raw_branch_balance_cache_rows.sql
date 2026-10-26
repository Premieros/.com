-- Reconciles precisely nine branch-level cached raw inventory balances, not stock transactions.
-- Preconditions: signed batch sums and official inventory ledger quantity sums match for each.
-- Historical journal and ledger records are never modified.
DO $repair$
DECLARE v_pending integer;v_updated integer;v_remaining integer;v_unsafe integer;
BEGIN
 LOCK TABLE public.raw_material_batches IN SHARE MODE;
 LOCK TABLE public.inventory_ledger IN SHARE MODE;
 LOCK TABLE public.raw_material_inventory IN SHARE ROW EXCLUSIVE MODE;
 WITH aggregate_stock AS (
 SELECT i.id,i.quantity stored,i.branch_id,i.raw_material_id,
 (SELECT COALESCE(SUM(b.quantity),0) FROM public.raw_material_batches b WHERE b.branch_id=i.branch_id AND b.raw_material_id=i.raw_material_id) batch_qty,
 (SELECT COALESCE(SUM(l.quantity),0) FROM public.inventory_ledger l WHERE l.branch_id=i.branch_id AND l.raw_material_id=i.raw_material_id) ledger_qty
 FROM public.raw_material_inventory i
 ) SELECT COUNT(*),COUNT(*) FILTER(WHERE batch_qty IS DISTINCT FROM ledger_qty)
 INTO v_pending,v_unsafe FROM aggregate_stock WHERE stored IS DISTINCT FROM batch_qty;
 IF v_pending<>9 OR v_unsafe<>0 THEN RAISE EXCEPTION 'Reconciliation abort: pending %, unsafe %',v_pending,v_unsafe; END IF;
 WITH verified AS (
 SELECT i.id,
 (SELECT COALESCE(SUM(b.quantity),0) FROM public.raw_material_batches b WHERE b.branch_id=i.branch_id AND b.raw_material_id=i.raw_material_id) batch_qty,
 (SELECT COALESCE(SUM(l.quantity),0) FROM public.inventory_ledger l WHERE l.branch_id=i.branch_id AND l.raw_material_id=i.raw_material_id) ledger_qty
 FROM public.raw_material_inventory i
 ), changed AS (
 UPDATE public.raw_material_inventory i SET quantity=v.batch_qty,updated_at=now()
 FROM verified v WHERE i.id=v.id AND i.quantity IS DISTINCT FROM v.batch_qty
 AND v.batch_qty=v.ledger_qty RETURNING i.id
 ) SELECT COUNT(*) INTO v_updated FROM changed;
 IF v_updated<>9 THEN RAISE EXCEPTION 'Updated % instead of 9',v_updated; END IF;
 SELECT count(*) INTO v_remaining FROM public.raw_material_inventory i WHERE i.quantity IS DISTINCT FROM
 (SELECT COALESCE(SUM(b.quantity),0) FROM public.raw_material_batches b WHERE b.branch_id=i.branch_id AND b.raw_material_id=i.raw_material_id);
 IF v_remaining<>0 THEN RAISE EXCEPTION 'Remaining mismatches: %',v_remaining; END IF;
END $repair$;
