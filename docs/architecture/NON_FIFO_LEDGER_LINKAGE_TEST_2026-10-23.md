# Non-FIFO movement ledger linkage — 2026-10-23

Scope: Premieros/.com, Supabase hvqlkapynjfjikqithvd only.

Applied migration `link_gated_non_fifo_movements_to_inventory_ledger`:
- Adds `private.raw_warehouse_movements_v2.ledger_id bigint UNIQUE REFERENCES public.inventory_ledger(id)`.
- Extends the gated `private.apply_raw_warehouse_delta_v2` so that after balance UPDATE and private movement INSERT, it inserts a corresponding `public.inventory_ledger` row, using branch, warehouse, material, quantity delta and cost from latest published price (zero if absent); `reference_type='warehouse_movement_v2'`, `reference_id=operation_id`.
- Updates private movement's ledger_id to the returned inventory_ledger.id.
- All statements participate in the caller's transaction; no orphan writes if an exception rolls back.

Test:
BEGIN; set local `premieros.v2_movement_test=enabled`; apply -1 to sample material with starting balance 976; verify after_qty=975, ledger_id=25124, quantity=-1, unit_cost=0, reference ID matches; ROLLBACK.
Post rollback verified: 0 private test movements, 0 corresponding public ledger entries, restored balance 976.

**IMPORTANT NOT PRODUCTION READY:** Test gate required, legacy FIFO continues to write old batches; the new v2 engine does not yet update legacy batches or raw_material_inventory and does NOT post accounting journals. The v2 ledger entry_type is provisional (negative 'production', positive 'adjustment') and must be replaced with exact type supplied by operational caller before cutover. No sale/purchase/return/production entrypoint migrated yet. Price-history correctness beyond missing event not thoroughly tested; load/concurrency tests pending.

Plan to replace each operational flow, with branch/warehouse accounting and idempotency tests, reconcile stock and general ledger, then retire FIFO. Issues #124 and #125.
