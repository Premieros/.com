# Warehouse-specific raw inventory ledger lookup index — 2026-10-23

Project: Premieros/.com; Supabase hvqlkapynjfjikqithvd ONLY.

Deployed Supabase migration: `index_warehouse_scoped_raw_inventory_ledger_recent`

```sql
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_branch_warehouse_raw_recent
ON public.inventory_ledger (branch_id, warehouse_id, raw_material_id, created_at DESC)
WHERE raw_material_id IS NOT NULL AND warehouse_id IS NOT NULL;
```

Measured representative query against actual inventory_ledger data:

```sql
SELECT id, created_at, quantity, unit_cost
FROM public.inventory_ledger
WHERE branch_id = :branch_id
  AND raw_material_id = :raw_material_id
  AND warehouse_id = :warehouse_id
ORDER BY created_at DESC
LIMIT 25;
```

EXPLAIN ANALYZE before: 2.599 ms execution, used idx_inventory_ledger_branch_created_at, filtered out 148 rows, 22 shared hits.
EXPLAIN ANALYZE after: 1.313 ms execution, used idx_inventory_ledger_branch_warehouse_raw_recent, 10 shared hits, 3 shared reads.

Note: Single-run timings with different cache/planning effects are not statistically robust; verify with representative repeated workloads and write overhead before claiming broad performance improvement. No business rows, balances, prices or journals were changed. This index supports efficient warehouse-scoped reads; it does not alone guarantee warehouse-specific stock correctness in offline POS.

Next: instrument checkout RPC and multi-user transaction timings, quantify write amplification, test high-volume synthetic fixture, and ensure remaining FIFO dependencies are removed before dropping tables.
