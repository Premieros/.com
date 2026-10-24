-- Read-only readiness check; intentionally blocks final cutover while product FIFO callers or discrepancies remain.
CREATE OR REPLACE FUNCTION private.product_non_fifo_cutover_gate_v1()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
WITH products AS (
 SELECT count(*) AS mismatches FROM public.inventory i
 WHERE i.quantity IS DISTINCT FROM
 (SELECT COALESCE(sum(b.quantity),0) FROM public.inventory_batches b
 WHERE b.product_id=i.product_id AND b.warehouse_id=i.warehouse_id AND b.branch_id=i.branch_id)
), callers AS (
 SELECT count(*) AS count FROM pg_catalog.pg_proc p
 WHERE p.proname NOT IN ('_product_inv_remove_fifo','product_non_fifo_cutover_gate_v1')
 AND p.prosrc ILIKE '%_product_inv_remove_fifo%'
), negatives AS (
 SELECT count(*) AS count FROM public.inventory_batches WHERE quantity<0
)
SELECT pg_catalog.jsonb_build_object(
 'safe_to_cutover',products.mismatches=0 AND negatives.count=0 AND callers.count=0,
 'inventory_batch_mismatches',products.mismatches,
 'legacy_product_fifo_callers',callers.count,
 'negative_product_batches',negatives.count,
 'requires_full_integration_tests',true
) FROM products,callers,negatives
$function$
;
REVOKE ALL ON FUNCTION private.product_non_fifo_cutover_gate_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.product_non_fifo_cutover_gate_v1() TO service_role;
