-- Read-only acceptance gate for PremierOS sale costing/stock-policy unification.
-- This is intentionally a FAILING test until the sale stock writer is reconciled.
-- Do not deploy an unverified rewrite of the stock writer to work around this gate.
DO $audit$
DECLARE body text; n integer;
BEGIN
  SELECT p.prosrc INTO body FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
  WHERE ns.nspname='public' AND p.proname='_deduct_ready_product_stock_policy'
    AND pg_get_function_identity_arguments(p.oid)='p_product_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_qty numeric, p_reference_id uuid, p_reference_number text, p_allow_negative boolean';
  IF body IS NULL THEN RAISE EXCEPTION 'READY_PRODUCT_POLICY_NOT_FOUND'; END IF;
  IF position('product-stock:' in body)>0 THEN
    RAISE EXCEPTION 'SALE_AND_ADJUSTMENT_PRODUCT_LOCK_KEYS_DIVERGE';
  END IF;
  IF position('v_batch.unit_cost' in body)>0 THEN
    RAISE EXCEPTION 'SALE_COST_FROM_BATCH_CONFLICTS_WITH_CATALOG_PRODUCT_COST_POLICY';
  END IF;
  SELECT count(*) INTO n FROM public.inventory i WHERE i.quantity IS DISTINCT FROM
    (SELECT COALESCE(SUM(b.quantity),0) FROM public.inventory_batches b
     WHERE b.product_id=i.product_id AND b.warehouse_id=i.warehouse_id AND b.branch_id=i.branch_id);
  IF n>0 THEN RAISE EXCEPTION 'PRODUCT_STOCK_BALANCE_DRIFT: %',n; END IF;
END $audit$;
