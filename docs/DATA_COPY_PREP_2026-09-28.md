# DATA COPY PREPARATION — ACTIVE WORK LOG

Repository: `Premieros/.com`
Branch: `development/data-copy-prep-20260928`
Source Supabase (READ ONLY): `azzdesuowpdcoflmyezn`
Destination Supabase: `hvqlkapynjfjikqithvd`
Started: 2026-09-28 Africa/Cairo

## Work status

**DATA COPY COMPLETE THROUGH 2026-09-28 23:59:59 Africa/Cairo. FINAL VALIDATION COMPLETE. MERGE APPROVED BY USER.**

The authoritative cutoff is strictly before `2026-09-29 00:00:00 Africa/Cairo` (`2026-09-28 21:00:00+00`). Rows belonging to 2026-09-29 local time were removed from the destination during reconciliation.

Final validated operating totals through cutoff include:
- sales: 1244, total 1,058,504.32
- purchases: 175, total 344,315.36
- expenses: 94,931.29
- customer payments: 289,649.00
- supplier payments: 26,565.00
- treasury transactions: 705,781.25
- inventory_ledger: 21,728 rows
- raw_material_batches: 11,031 rows
- raw_fifo_debts: 8,694 rows
- raw_fifo_settlements: 3,093 rows
- order_kitchen_voids: 333 rows
- sale_print_events: 541 rows
- shift_operations: 1,471 rows

Final safety verification:
- source remained READ ONLY
- no writes to `Premieros/johna-s`
- no post-cutoff operational rows remain in destination for orders/items/kitchen/sales/inventory/FIFO paths checked
- no checked FK orphan remains
- RLS remains enabled on checked operational/FIFO tables
- no USER trigger remains disabled
- financial aggregates match source through cutoff
- observed post-cutoff batch quantity movement was intentionally not copied

## Goal

Prepare and complete a safe data-only migration from the existing `johna-s` production database into the organization-aware `.com` database without replacing the `.com` schema, weakening RLS, or mutating the source.

## Hard guards

- Source database is read-only for this work.
- No destructive SQL on source.
- Preserve source branch UUIDs where safe so historical branch foreign keys stay valid.
- Map imported operational rows to the destination organization model.
- Do not overwrite destination organization/module bootstrap infrastructure.
- Auth/public.users mapping preserves historical UUID relationships while keeping the destination login bootstrap account.
- RLS, permissions, and triggers must remain enabled after controlled copy migrations.

## Migration classes

### KEEP_DESTINATION
- organizations framework
- organization_feature_overrides
- schema_migrations
- destination project configuration / organization-module bootstrap

### COPY_WITH_MAPPING
- branches where organization mapping is required
- organization_members
- users / auth identity linkage
- tenant-bearing rows intentionally retained

### REBUILD_DERIVED / EXCLUDED FROM AUTHORITATIVE COPY
- raw_fifo_debt_price_estimates
- raw_fifo_price_fallback_plan
- raw_fifo_price_fallback_runs
- temporary repair/backfill planning data not required for runtime truth

### COPY
Authoritative branch-scoped master and transactional data in FK-safe order, including catalog, raw materials, suppliers/customers, inventory ledgers, purchases, orders, sales, payments, shifts, treasury/journal, kitchen inventory effects, FIFO runtime state, void and print history where required.

## Final reconciliation notes

- `sale_item_inventory_effects` and `order_kitchen_inventory_effects` matched source IDs through cutoff.
- `inventory_ledger` and `raw_material_batches` matched row identity through cutoff.
- Differences observed against the *current* live source were limited to later FIFO repricing and post-cutoff consumption; destination correctly retains the cutoff snapshot.
- 13 pre-cutoff Order Items were reconciled from their pre-cutoff Kitchen Send history.
- One Order Item at 2026-09-29 00:30 Cairo was removed from destination because it exceeded the approved cutoff.
- FIFO runtime dependencies copied and verified: backfill runs needed as parents, debts, settlements, rebase snapshots, and rebase settlement snapshots.

## Merge gate

- User explicitly approved merge after final validation.
- PR #7 must be marked ready for review.
- CI must be Green before merge.
- If CI fails, fix only the documented cause on this branch and re-run verification.
