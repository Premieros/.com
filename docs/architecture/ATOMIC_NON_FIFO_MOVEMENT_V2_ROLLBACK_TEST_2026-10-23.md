# Atomic non-FIFO movement v2 implementation and rollback test — 2026-10-23

Scope: Premieros/.com, Supabase hvqlkapynjfjikqithvd only.

Applied migration: `implement_gated_atomic_non_fifo_movement_v2`.

Updated `private.apply_raw_warehouse_delta_v2` to perform an atomic balance row UPDATE plus unique operation_id movement INSERT after:
- nonzero 4dp delta validation and correct branch/warehouse/material mapping;
- per-branch, per-warehouse, per-material advisory transaction lock and balance FOR UPDATE;
- idempotency key lookup; matching replay returns original cost/balances, conflicting reused key rejected;
- staged balance equal to legacy raw_material_batches sum guard;
- **explicit session-local test gate** `current_setting('premieros.v2_movement_test',true)='enabled'`; without it returns CUTOVER_NOT_ENABLED;
- negative stock policy validation;
- `private.raw_published_unit_cost_at_v2(...,statement_timestamp())` returning latest published price at time of movement, or zero, with price_event_id provenance.

This v2 engine does not yet insert public.inventory_ledger or post financial journal entries. It is NOT fit for production checkout cutover in its current form. Legacy FIFO writers remain live. GUC gate is not a durable production feature flag; current function only service_role callable; do not expose test mode to clients.

Rollback test performed:
BEGIN; SELECT set_config('premieros.v2_movement_test','enabled',true); call delta -1 for an existing material with stock 976; repeat exact operation_id; ROLLBACK.
Second result: success=true,replayed=true,before_qty=976,after_qty=975,unit_cost=0.
Post-rollback verification: balance remained 976, movement table contains 0 test rows; ungated call returns CUTOVER_NOT_ENABLED. No historical finance or inventory data altered.

Remaining: enforce an explicit cutover protocol (the gate should ultimately be removed), complete public.inventory_ledger and COGS posting integration and price snapshots, instrument and replace all FIFO consumer functions, full regression/load/concurrency tests before deleting FIFO runtime objects.