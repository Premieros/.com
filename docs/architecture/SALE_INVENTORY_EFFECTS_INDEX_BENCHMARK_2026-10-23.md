# Sale-item inventory-effects indexed lookup benchmark — 2026-10-23

Scope: Premieros/.com and Supabase hvqlkapynjfjikqithvd only.

Deployed migration: `index_sale_inventory_effects_warehouse_material_recent`

```sql
CREATE INDEX IF NOT EXISTS idx_sale_effect_branch_warehouse_target_recent
ON public.sale_item_inventory_effects
(branch_id, warehouse_id, target_type, target_id, created_at DESC)
WHERE warehouse_id IS NOT NULL;
```

Read-only EXPLAIN (ANALYZE, BUFFERS) sample: fetch latest 25 inventory effects for one actual branch, warehouse and raw material.

Before: 3.580 ms execution. Index scan using `idx_sale_item_inventory_effects_target` over 742 rows, filter by branch/warehouse then top-N sort; 184 shared buffer hits.
After: 0.812 ms execution. Index scan using composite index, no sort, 8 shared hits and 3 reads.

Single measurements, potentially affected by caching; this is not a production p95 or a load test. Index has write/storage overhead to evaluate later. No business data was mutated. Previous inventory_ledger composite index remains.

Major blockers: FIFO still in critical sale/purchase/return/production SQL; do not drop tables or trigger until replacements and regression tests. Issue #124. Performance/load-testing issue #125. Do not claim one million-transaction readiness from index microbenchmarks alone.