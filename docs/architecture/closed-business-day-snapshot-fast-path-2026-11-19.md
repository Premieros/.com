# Premier OS — sealed business day report fast path

**Implementation scope:** Reuse the existing `public.daily_closes` materialized JSON report snapshots and the existing `private.run_due_business_day_closes()` cutoff worker. Do not create a second day-close subsystem, archive original ledger records, or change posting times for sales and refunds.

## Current architecture (reviewed in production, read-only)

- Per-branch time rules already live in `public.branch_settings` (`business_day_mode`, `business_day_start`, `business_day_end`, `auto_close_shift_at_day_end`).
- `private.business_day_fixed_cutoff` resolves a Cairo local end time with overnight days; the automatic worker locks each branch, advances `business_day_state`, closes eligible shifts according to policy, builds the report and writes one `daily_closes` row per (branch, business date). There is already a unique constraint for that pair.
- The day-close builder performs the expensive transaction aggregations once during sealing.
- Previously `get_day_closing_report` first initialized/checks live state and normalizes the archived report using *current* expense data. That made closed-day reads do unnecessary work and allowed the displayed cash figures to change after later adjustments.

## Implemented changes

1. `get_day_closing_report(branch, day)` keeps existing authentication, branch and role checks but looks up the sealed row **first**. For a sealed report it returns the exact saved `report_snapshot` plus status flags. It never initializes business-day state, scans shifts, normalizes cash or recomputes historic sales/expenses.
2. A sealed row with missing/empty JSON raises the explicit `DAY_CLOSE_SNAPSHOT_MISSING` result rather than silently rebuilding figures from mutable transaction data.
3. Unclosed days still use the original live builder and cash normalization. Transactional sale, stock, purchase and GL processing is unchanged.
4. Repeated `_finalize_day_close` calls immediately return the previously saved report (including after a newer shift is open). New close requests still reject open shifts and retain the shift-span requirement; a per-(branch,date) advisory lock and unique key guard duplicate requests.
5. Existing `get_day_closing_range_report` uses `get_day_closing_report` for each business date, so closed dates now benefit from its fast path automatically, without changing the API response shape.
6. Existing historical snapshots are **not backfilled, silently corrected, or rewritten** by this release; any legacy accuracy reconciliation must be separate, audited work.

## Important accounting boundaries

- Closed-day numbers are period-specific snapshots. A refund, purchase return, inventory adjustment or payment correction *after* the close must be recorded as a current, traceable adjustment referencing the historical document. It must not mutate a sealed daily snapshot.
- Inventory batches, stock availability and cost basis continue across days. **Do not freeze stock posting, remove ledger entries, or rely on day-close snapshots to calculate live available inventory.**
- System-wide financial statements and cross-period ledger/reconciliation may still require journal-level queries; this optimization applies to **day-closing reports and their existing range report**, not every report or POS engine.
- Manual cutoff configured in the app and auto-close shift policy are retained. If an eligible shift is still open and auto-close is off, the worker currently raises `SHIFT_CLOSE_REQUIRED_BY_BRANCH_SETTINGS`; this feature does not force-close it.
- Closed-day snapshots can be corrupted by privileged direct database writes unless the existing operational access policies prohibit them. Future formal archival should use append-only versioned corrections and signature/checksum verification.

## Validation

`tests/integration/closed-business-day-snapshot-readonly.test.ts` creates an isolated organization, branch, user and artificial sealed snapshot inside a rolled-back transaction on disposable CI PostgreSQL. It verifies that multiple reads return unchanged snapshot values, do not create business_day_state records, ignore a newly opened shift, and do not duplicate or recompute a previous day on repeated close.

**Deployment safety:** Ship the migration only after clean schema replay, integration tests and browser smoke. Never test the close mechanism by writing dummy sales into the customer's production tenant.
