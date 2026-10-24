# Non-FIFO document-aware movements v3 — 2026-10-23

Scope: Premieros/.com, Supabase hvqlkapynjfjikqithvd ONLY.

Migration deployed: `non_fifo_v3_document_aware_movement_stage`.
- Added nullable `entry_type`, `source_reference_type`, `source_reference_id` to private.raw_warehouse_movements_v2.
- Created service-role-only `private.apply_raw_warehouse_delta_document_v3(uuid,uuid,uuid,uuid,numeric,boolean,text,text,uuid)`.
- Requires recognized entry_type and reference_type, source UUID, and the explicit test-only session GUC, then calls v2 atomic quantity writer. Sets typed provenance on private movement and updates matching public inventory_ledger row to original document type and ID; uses transaction atomicity and operation idempotence metadata conflict check.
- Validated inside BEGIN/ROLLBACK: -1 raw unit for sample warehouse from 976, generated ledger with entry_type='sale',reference_type='sale',reference_id=synthetic test UUID; rollback restored 976 and left 0 private/ledger test records.
- Nonmatching category/reference combinations aren't fully constrained; references aren't checked against real documents; type is still a staging contract, not production checkout.
- **Not connected** to existing checkout, purchase/return, stock count or accounting journals; FIFO still active, test GUC required, do not run in production. Use a proper production cutover migration with accounting, reference validity, negative stock policy, and concurrency/integration/load tests before removing legacy logic.
