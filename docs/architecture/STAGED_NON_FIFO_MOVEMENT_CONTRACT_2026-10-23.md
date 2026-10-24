# Non-FIFO movement contract staged — 2026-10-23

Scope: Premieros/.com, Supabase hvqlkapynjfjikqithvd.

Migration `stage_non_fifo_idempotent_movement_contract` applied.

- Created restricted private.raw_warehouse_movements_v2 with unique operation_id, branch/warehouse/raw material, signed quantity delta, before/after balances, unit/total cost and event provenance columns. CHECK after=before+delta. RLS enabled; only service_role DML grant.
- Created private.apply_raw_warehouse_delta_v2 with input precision validation, branch/warehouse checks, advisory transaction lock per (branch,warehouse,material), idempotency-operation conflict semantics and stale staged balance check. Restricted EXECUTE to service_role.
- **INTENTIONALLY DISABLED**: currently returns CUTOVER_NOT_ENABLED after checks and does not mutate balances or write any movement. Price event lookup and atomic delta posting are NOT yet implemented. Avoid misrepresenting this as operational implementation.
- Verified test returned CUTOVER_NOT_ENABLED and private movement row count remained 0.

Why disabled: legacy FIFO still changes raw_material_batches and existing business paths; enabling a parallel writer without atomic cutover would corrupt inventory.

Next critical work: implement atomic movement and latest-published-price-at-event-time cost, test idempotency and concurrency using transactions rolled back during testing, shift all ten FIFO operational callers and accounting to new source, reconcile branch/warehouse inventory + negative quantities, then enable v2 and retire legacy. #124 #125.

No journal, sales, historical batch or stock quantity changes in this migration.