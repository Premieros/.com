# Premier OS — go-live readiness checkpoint (12 November 2026)

**Scope:** pre-flight audit only, taken 11 November 2026 from canonical production Supabase project `hvqlkapynjfjikqithvd`. The owner stated that all earlier records are trial data and explicitly requested preserving them, with real work starting **12 November 2026**. Do not reset historic orders/sales, account balances, inventory, journal entries, shifts or original migration metadata. This report is **not** authorization to automatically switch every tenant/branch.

## Confirmed live state

- Server `cron.job` ID **4**, `auto-business-day-close`, `* * * * *`, active, most recent observed cron invocation status **succeeded**. The job's *SQL invocation* success is **not** proof all branch closes succeeded; branch-specific errors have previously been observed inside JSON results.
- PR #157 database migration `premier_branch_cutoff_shift_handoff` was installed by separate approval. The PR frontend still **Draft/unmerged**, and the new 10:00–02:00 defaults in the code are not yet in the released frontend. No company-wide or branch-wide schedule update was performed.
- Open operational rows: **21 orders**, **2 shifts**, **63 daily closes**. Existing historic sales **1,248** and posted journal headers **2,249** (only row-count checks).
- Production has **9 active branches** in distinct organizations/tenants; blanket updates to time schedules would be unsafe. **40 active user rows**, **4 global super admins**, **8 users with role names cashier/pos_cashier**; this is not sufficient to certify branch permission grants without end-to-end authentication tests.
- Each branch has treasury accounts (2–3). The `public.inventory` table has no rows for those branches; this does **not** prove stock is zero because raw-material inventory/stock ledgers/batches live in separate tables. Opening cash/stock/COA is **not certified** by this audit.

## Branch-by-branch schedule and cutover constraints

| Branch | Time (Cairo) | Shift auto close | Open shifts | Open orders | Status for 12 November |
| --- | --- | --- | ---: | ---: | --- |
| Smouha club | 08:00–03:00 | yes | 0 | 1 | Ready for *new shift opening*, subject to accounting/inventory opening checks |
| Johna's Cleopatra | 08:00–02:30 | yes | 1 | 13 | **BLOCKED** — shift since 2026-09-28, 39 recorded shift operations (4 after old cutoff); historic `HISTORICAL_SHIFT_CUTOFF_REQUIRES_REVIEW` |
| ASD | 00:00–00:00 | no | 1 | 7 | **BLOCKED** — open shift since 2026-10-27; automatic shift close disabled |
| Main branch | 00:00–00:00 | no | 0 | 0 | Confirm intended hours and operating branch before 12 Nov |
| chefbox | 00:00–00:00 | no | 0 | 0 | Confirm intended hours and operating branch |
| M-Mohamed | 00:00–00:00 | no | 0 | 0 | Confirm intended hours and operating branch |
| zein | 00:00–00:00 | no | 0 | 0 | Confirm intended hours and operating branch |
| Tashkwaz | 00:00–00:00 | no | 0 | 0 | Confirm intended hours and operating branch |
| Asfahani Kebab | 00:00–00:00 | no | 0 | 0 | Confirm intended hours and operating branch |

**Do not silently rewrite these times to 10:00–02:00.** The owner requested that policy for a branch-settings implementation but has not identified which existing branches/organizations should be changed, and the two real branches currently have specific 08:00-based schedules.

## Release gates to close *before accepting live sales*

1. **Operational cutover:** Identify which organization and branch(es) will trade on 12 Nov. Confirm branch start/end times, time zone Africa/Cairo, `auto_close_shift_at_day_end` and who opens the new shift. Never open a new shift automatically under an invented user identity.
2. **Old open shift isolation:** Before trading in Cleopatra/ASD, resolve stale shift operation attribution using a separate auditable approval. Do not mutate historic financial entries, change historic close timestamps or cancel open orders as a shortcut.
3. **Opening evidence:** Verify physical cash count, treasury and account opening balances; stock of each warehouse/raw material, FIFO/COGS, payment methods and accounting period. Do not assume zero opening balances because older entries were experimental.
4. **Cashier permissions:** Validate `shifts.open`, `shifts.close`, `pos.payment.take`, role/branch scopes, and connectivity/offline idempotency on a non-production fixture. Confirm mobile/browser UI points to the same canonical backend.
5. **Settlement handoff:** Test split payment/admin/regular sale paths: carried open order settles exactly once to an actual new **open** branch shift, not a closed or trial shift; stock, COGS and journal postings remain single and balanced. The published PR #157 does not close all these gates.
6. **Scheduler safety:** Detect `run_due_business_day_closes()` JSON `errors` separately from `cron.job_run_details.status='succeeded'`. Current Cleopatra and ASD failures must not be hidden by cron's successful SQL result.
7. **PR #157 remains Draft/unmerged** until integration, security, and accounting release checks finish and the owner gives merge/deployment approval. Branch settings UI defaults are not yet in production.

## Read-only checks / explicit non-actions

The live inspection did **not** change production data, close shifts, clear orders, modify branch settings, seed starting balances, fabricate opening ledger entries, alter permissions or activate a new job. These require scoped decisions and verified source-of-truth amounts. Existing cron job is already active; no second job was created.

**Go-live decision:** **CONDITIONAL / NOT CERTIFIED** for all branches as a whole. Smouha has no old open shift and is the strongest candidate; Cleopatra and ASD have explicit cutover blockers. Maintain hard safety gates rather than interpret 'trial data' as permission to destroy or silently rewrite financial provenance.
