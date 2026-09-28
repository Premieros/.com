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

## Next preparation step

Create an exact table/column compatibility matrix and classify every table as:
- COPY
- COPY_WITH_MAPPING
- REBUILD/DERIVED
- KEEP_DESTINATION
- SKIP_RUNTIME

Then prepare the import order and validation queries. No production copy yet.
