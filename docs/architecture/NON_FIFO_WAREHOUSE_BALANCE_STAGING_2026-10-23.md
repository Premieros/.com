# Non-FIFO warehouse balance staging — 2026-10-23

Scope exclusively Premieros/.com and Supabase hvqlkapynjfjikqithvd.

Applied remote migration: `stage_non_fifo_warehouse_balances_v2`.

Created `private.raw_warehouse_balances_v2` keyed by (branch_id,warehouse_id,raw_material_id), with numeric(18,4) quantity and updated_at, PK and FKs, RLS enabled, revoked PUBLIC/anon/authenticated table grants; service_role table read/write grants. Seeded snapshot using rounded SUM(raw_material_batches.quantity) grouped by matching valid branch and warehouse. Existing rows preserved with ON CONFLICT DO NOTHING. Explicit COMMENT warns **staging only, NOT authoritative** while current stock writers still use FIFO/batches.

Verification: 525 balance keys, 146 have negative stock, zero mismatches against current batch aggregate at time of snapshot. Did not rewrite sales, journals, historical batches or inventory_ledger. No hot-path switch, no decrement function and no load-test yet. Because legacy writers continue changing batches, staging balances become stale; do NOT make operational reads use staging data until atomic cutover or synchronization has been designed and verified.

Next: warehouse ownership and transaction idempotency for a minimal v2 writer, ledger cost from latest published event as of transaction time or zero, rollback/concurrency tests, replacement of each sale/purchase/returns/production/stock-count writer and journal correctness, then retire FIFO tables. Avoid deleting FIFO dependencies while live callers exist.
