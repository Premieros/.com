# Sale-document validation for staged non-FIFO movement v4 — 2026-10-23

Scope only Premieros/.com and Supabase hvqlkapynjfjikqithvd.

Migration `guarded_sale_document_stock_v4` applied to live clone database:
- Introduced `private.apply_raw_sale_stock_v4(operation_id,sale_id,raw_material_id,delta,allow_negative)` as service-role-only SECURITY INVOKER.
- Derives branch/warehouse from a **real** public.sales row, requires completed sale and valid warehouse, material belonging to the same branch, and negative quantity delta; then delegates to staged document-aware v3 for atomic staging balance movement and public inventory_ledger entry.
- v3/v2 remains gated by `premieros.v2_movement_test='enabled'` and is not wired to checkout. No operational cutover.
- Rolled-back smoke test used an existing completed sale, sample raw material, -1 quantity. Within BEGIN transaction, v4 inserted typed public inventory_ledger row with sale reference and -1 quantity. ROLLBACK left zero private test movement records, zero recent sale ledger records for reference matching test, and baseline balance 976 unchanged.
- This is NOT full correctness: no actual sale line or recipe dependency validation, no accounting journal posted, no production sales integration, and no concurrency/load tests. Existing FIFO operational flow remains.
- Accounting changes require checking idempotent ledger/journal posting, original-sale snapshots, and warehouse-specific inventory prior to cutover. Remove the custom test GUC in reviewed production cutover.
