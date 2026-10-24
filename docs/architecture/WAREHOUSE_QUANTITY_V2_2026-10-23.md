# Warehouse quantity v2 migration and unexpected negative balances — 2026-10-23

Only Premieros/.com / Supabase project hvqlkapynjfjikqithvd.

Migration `warehouse_scoped_raw_material_quantity_v2` deployed `private.raw_material_warehouse_quantity_v2(branch_id,warehouse_id,raw_material_id)` as a SQL STABLE SECURITY INVOKER read helper with search_path pg_catalog.
- Checks warehouse is active and belongs to branch.
- Returns sum of raw_material_batches.quantity for exact branch/warehouse/material; NULL for invalid/inactive warehouse.
- No FIFO ordering/cost logic. Does not mutate any records.
- EXECUTE revoked PUBLIC, anon, authenticated; granted service_role.
- Existing positive-only warehouse index may not cover negative rows; benchmark before promoting to hot path.

Verified 5 actual branch/warehouse/material combinations vs direct group by; match.
Observed negative batch balances, e.g. material prefixes d763e74c -5686, 7771c0ea -4730, 1052f471 -1299. These may be intended historical negative-stock behavior; investigate root causes and avoid silently clipping to zero or deleting legacy debt before migration.

Critically this read helper does NOT replace operational `_raw_remove_fifo` (which currently loops batches and writes per-batch inventory_ledger movements, FIFO debts and avg_cost). It is not safe to drop runtime FIFO yet. Next implementation: spec non-FIFO transactional quantity updates with dedicated warehouse balance authority, idempotence, and exact published-price COGS. Existing historical posted journals must not be rewritten without specific reviewed reconciliation.
