# Premier selective Johna feature parity — unified integration

## Source boundaries
- **Write target:** `Premieros/.com` (Premier), based on `main`.
- **Target database:** Supabase project `john's 1` (`hvqlkapynjfjikqithvd`), PostgreSQL database `postgres`.
- **Read-only reference:** `Premieros/johna-s` and Supabase `john's` (`azzdesuowpdcoflmyezn`). Do not write to either.
- This document tracks selected compatibility work; do **not** bulk-copy code or apply source database migrations.
- No automatic merging of unrelated legacy PRs or release branches.

## Status legend
- DONE: committed in this branch; not necessarily reviewed or released
- REVIEW: found in source or older Premier PR, requires adaptation and tests
- BLOCKED: dependency/invariant not validated yet

| Area | Work item | Status | Notes |
| --- | --- | --- | --- |
| POS printing | Guard cloud print queue against cross-branch stale responses, duplicate concurrent requests and hidden-tab polling | DONE | `src/features/pos/components/settings/PrinterSettingsPanel.tsx`; requires browser/CI validation |
| POS printing | Cashier area / second station settings | BLOCKED | Source UI requires `get_cashier_area_settings` and `save_cashier_area_settings`; missing in Premier target database during read-only check; design Premier-native branch-scoped permissions and routing before enabling |
| POS printing | Manual delayed-ticket print recovery | REVIEW | Reference flow depends on print recovery RPCs, job claiming, anti-duplicate safeguards and `pos.print_recovery`; preserve fail-closed behavior |
| Reports | Search, reorder and persist report columns | DONE | Adapted to Premier's existing ReportsPage, visibility, export/print column order; unit tests added, CI validation pending |
| Reports | Reporting dashboard and filters | REVIEW | Draft PR #160 exists; compare against current Premier reports before cherry-picking |
| Reports | Month/period close, consumption reports, exports | REVIEW | Source components may have different schema/permissions; match Premier native report loaders |
| Inventory | Branch/warehouse stock, transfer and valuation gaps | REVIEW | Preserve Premier atomic counting and branch isolation |
| Costing | Recipe costs, raw prices, FIFO/approved price consistency | REVIEW | Preserve merged approved-zero and inventory-cost invariants |
| Accounting and procurement | Receivables, journal reports, buying workflow gaps | REVIEW | Assess dependencies and schema; no production data writes for discovery |
| Admin | Registration, branch pulse, support and permissions | REVIEW | Use Premier org/branch boundaries and permission model |
| Database | Migration-history reconciliation | BLOCKED | Draft PR #155 exists; do not merge automatically or apply migrations without staged audit |
| Offline/LAN | Existing draft PRs #133–#140 | REVIEW | Separate architectural scope, dependent branches; not automatic candidates for feature parity |

## Validation gate before merging
1. Review each changed file for Premier's org/branch permission model and current API contracts.
2. Run TypeScript/build, relevant UI tests and print/order regression tests.
3. Confirm branch-switching and failed/slow print-queue reads never show another branch's data.
4. Check all database changes in a disposable environment first; verify RLS, function grants and cross-branch isolation.
5. Merge this one integration PR only after the above checks pass. Its draft state is intentional.

## Working convention
Commit each completed feature separately to the **same branch and PR**; record a test and the exact dependency for every addition. Preserve already-merged features (notably area bulk-create PR #197, stock-count Excel PR #167 and purchase unit price conversion PR #168).
