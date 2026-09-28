# DATA COPY PREPARATION — ACTIVE WORK LOG

Repository: `Premieros/.com`
Branch: `development/data-copy-prep-20260928`
Source Supabase (READ ONLY): `azzdesuowpdcoflmyezn`
Destination Supabase: `hvqlkapynjfjikqithvd`
Started: 2026-09-28 Africa/Cairo

## Goal

Prepare a safe data-only migration from the existing `johna-s` production database into the organization-aware `.com` database without replacing the `.com` schema, weakening RLS, or mutating the source.

## Hard guards

- Source database is read-only for this work.
- No destructive SQL on either database during preparation.
- No production data copy until schema/data mapping is verified.
- Preserve source branch UUIDs where possible so historical branch foreign keys stay valid.
- Map imported operational rows to the destination organization model.
- Do not overwrite the destination bootstrap organization/super-admin until the final cutover plan explicitly accounts for them.
- Auth migration must preserve user UUID relationships; existing sessions are not assumed portable across projects.

## Current verified baseline

Source:
- public tables: 134
- branches: 2
- public users: 33
- auth users: 34
- products: 508
- raw materials: 803
- orders: 1213
- sales: 1151
- purchases: 171

Destination:
- public tables: 131
- organizations: 1
- branches: 1 (bootstrap)
- public users: 2
- auth users: 2
- products/raw materials/orders/sales/purchases: 0

Source operational branches:
- Cleopatra
- Smoha

## Schema drift found before copy

Present in source but absent from destination:
- `raw_fifo_debt_price_estimates`
- `raw_fifo_price_fallback_plan`
- `raw_fifo_price_fallback_runs`
- `supplier_opening_balances`

Present in destination but absent from source:
- `organization_feature_overrides`

This drift blocks a blind dump/restore or direct all-table copy.

## Migration strategy

1. Bring destination schema to a migration-compatible state without replacing the organization-aware `.com` additions.
2. Build explicit organization + branch mapping.
3. Prepare Auth/public.users identity mapping while preserving UUIDs and the existing `.com` super-admin.
4. Copy reference/master data first.
5. Copy transactional data in foreign-key order.
6. Copy derived/history ledgers only after their prerequisites.
7. Synchronize sequences/counters.
8. Run row-count, FK, financial, inventory, branch-isolation, and RLS verification.
9. Only after verification, perform final cutover delta if needed.

## Do not copy blindly

Do not blindly overwrite:
- organizations
- organization_members
- organization_feature_overrides
- schema_migrations
- project-specific subscription/bootstrap configuration
- generated API/auth project settings
- RLS/policies/functions/triggers from the source

## Missing-table data classification

- `supplier_opening_balances`: 0 source rows. Schema/feature parity should be ported, but there is no historical row payload to migrate today.
- `raw_fifo_debt_price_estimates`: 1303 source rows — derived repair/estimate data.
- `raw_fifo_price_fallback_plan`: 4222 source rows — derived repair plan data.
- `raw_fifo_price_fallback_runs`: 1 source row — parent run record for the derived repair data.

The three `raw_fifo_*price*` tables reference branches/raw materials/raw FIFO debts/inventory ledger and should be classified as `REBUILD_DERIVED` unless a later compatibility check proves the target runtime still requires their historical records. Do not let them block copying the authoritative operational ledgers.

## Initial migration classes

### KEEP_DESTINATION
- organizations framework
- organization_feature_overrides
- schema_migrations
- destination project configuration / organization-module bootstrap

### COPY_WITH_MAPPING
- branches (preserve source branch UUIDs, replace/map organization_id)
- organization_members
- treasury rows carrying organization_id
- users / auth identity linkage
- any tenant_id-bearing subscription/feature rows that are intentionally retained

### REBUILD_DERIVED
- raw_fifo_debt_price_estimates
- raw_fifo_price_fallback_plan
- raw_fifo_price_fallback_runs
- other temporary repair/backfill planning tables after dependency review

### COPY
Authoritative branch-scoped master and transactional data after FK ordering is generated, including catalog, raw materials, suppliers/customers, inventory authoritative ledgers, purchases, orders, sales, payments, shifts, treasury/journal, and kitchen inventory effects where schema-compatible.

### SKIP_RUNTIME
Runtime/transient rows that must not wake old infrastructure in the new project will be explicitly identified before cutover (for example queued print/wake work).

## Next preparation step

1. Complete exact column compatibility for authoritative tables.
2. Port the missing supplier-opening-balance schema/permission contract needed for future use.
3. Generate FK-safe import order.
4. Define transient/runtime exclusions.
5. Prepare validation queries and stop before production copy.
