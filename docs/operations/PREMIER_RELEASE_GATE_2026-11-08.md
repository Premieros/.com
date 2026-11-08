# Premier OS — production release and reconciliation gate (2026-11-08)

> **Scope lock:** Only repository `Premieros/.com` and canonical Supabase project
> `hvqlkapynjfjikqithvd`. This is a read-only evidence / rollout checklist.
> **No production migration, data mutation, Git merge or Vercel release is authorized
> by the presence of this file.** Keep PR #132 as draft until each gate is signed off.

## Verified release facts

- Pull request: https://github.com/Premieros/.com/pull/132
- CI at commit `209e04fe9672ad1c5ded81e2b7d876f025303671` passed
  lint, TypeScript, unit tests, app build, PostgreSQL integration (91/91),
  and browser smoke:
  https://github.com/Premieros/.com/actions/runs/42417073562
- This PR now includes further *read-only print diagnostics*; run CI on the
  **latest** commit and use that exact SHA for any promotion.
- Frontend PostgREST contract was checked read-only against production:
  **182/182** RPC signatures and **55/55** tables/views present. This proves
  object/signature existence, *not* authenticated/authorized button behavior.
- GitHub's **Vercel commit status** points to the real Vercel team
  `premieros-3817`, project `premier.os`:
  https://vercel.com/premieros-3817/premier.os/CxoAB3Lc98YJRVNJ6pU1MrdaFoSM
  However the currently connected Vercel account does not have that team grant:
  both project/deployment introspection returned **403 forbidden**. The
  connector's team-consent action returned 404 for both team ID and slug,
  so project configuration and production deployment ownership remain unverified.
  A green GitHub Vercel status is **not** proof that production was promoted.
- The connected Supabase migration history reported **707 entries**,
  latest `20261028081704_branch_hub_canonical_posting_v1`.
  The separate `public.schema_migrations` log had **449 entries** and last
  applied-at 2026-10-07. These are different migration tracking schemes.
  Among 476 timestamp-named files on GitHub main, only 39 version numbers
  matched the Supabase migration history *exactly*. The many nonmatches
  **do not prove the code is missing in production**: historic migration
  names/versions diverged; most live functions were verified present.
  **Do not blindly replay the repository's complete migration directory on production.**

## Production audit findings (read-only)

| Issue | Quantity | Evidence / safety |
| --- | ---: | --- |
| Canonical inventory mismatches | 10 | 9 raw material across two branches, 1 semi-finished in a third branch |
| Debt-adjusted raw batch diagnostic delta | 1.35 absolute units across raw cases | All 533 current raw balances match the signed batch sums; this diagnostic subtracts open FIFO debt, not a stored-vs-batch discrepancy. Do not alter stock to zero this metric |
| Raw latest-ledger-snapshot absolute deltas | 96.925 units summed across 9 cases | Historical movement lineage must be reconciled first |
| Semi-finished movement delta | 7 units | Projection -14, signed batches -7, signed unit entries -7, open debt 7; potential double subtraction, not a stored stock reading |
| Tables vacant with effective open orders | 7 | One affected branch; frontend now shows occupied based on effective order, but stored state is not silently changed |
| Tables occupied without effective open order | 1 | Affected branch needs order lifecycle review |
| Kitchen send / pending inventory event mismatch | 1 | Affected branch; no automatic extra deduction or reversal |
| Print jobs older than 10 minutes | 22 | Across two branches (13 kitchen, 9 receipt); all pending, 0 attempts and never claimed. Some date back to 2026-09-30 |

Use `scripts/audit/premier-production-triage-readonly.sql` to reproduce
the branch/category summary; use existing
`scripts/audit/critical-integrity.sql` and
`scripts/audit/erp-cross-domain-readonly.sql` for broader invariants.

## Inventory lineage follow-up (read-only, 2026-11-08)

**Important design constraint:** `docs/architecture/PHASE3B_CANONICAL_INVENTORY_BALANCE_PROJECTION.md`
says the latest `inventory_ledger.after_qty` was deliberately used as the
raw-material reconciliation baseline because historical opening/import flows
can reset the stock baseline. **Do not globally switch the canonical view to
`sum(inventory_ledger.quantity)` merely to clear nine warnings.**

The read-only `scripts/audit/premier-inventory-source-lineage-readonly.sql`
compared all currently affected rows with ledger sums and source-item names:

- 533/533 current raw-material balances equal signed ledger totals and batch sums;
  nine still disagree with the **latest event's `after_qty` snapshot**.
  Classification: `LATEST_SNAPSHOT_DISAGREES_WITH_CONSISTENT_SUMS`.
- All 15 semi-finished unit batch totals equal signed unit entries; the one
  flagged item has batch/entry quantity -7 and open debt 7, while the
  current projection shows -14. Classification:
  `POSSIBLE_DEBT_DOUBLE_SUBTRACTION_IN_PROJECTION`. This is a hypothesis
  requiring comparison with the negative-stock writer; do not auto-change debt.
- Neither evidence class authorizes rewriting source inventory, event history,
  posted accounting, or replacing the established canonical baseline.
  The PR now contains a **guarded read-model migration candidate**
  `20261108072500_canonical_balance_snapshot_and_signed_debt_projection.sql`
  plus rollback-only integration regressions. It preserves latest ledger
  `after_qty` semantics, but uses insertion-ID ordering for backdated openings;
  it excludes open debt from signed negative batches only when movement entries
  corroborate that the debt is already represented. Validate this change
  on staging before any production application.

## Mandatory release gates

1. **Correct Vercel owner.** Obtain an authorized Vercel grant for team
   `premieros-3817` and project `premier.os`; verify project ID, Git repository, production branch,
   domain assignment, deployed commit SHA, and the **host** of
   `VITE_SUPABASE_URL` (not its credentials). It must resolve to
   `hvqlkapynjfjikqithvd.supabase.co`. Never display or copy API keys,
   connection strings, print agent passwords, session storage or env files.
2. **Migration parity.** Collect a baseline schema fingerprint from the exact
   canonical production database: function signatures/bodies for modified RPCs,
   constraints/RLS on the two private raw movement/balance tables, and the last
   applied migrations in both tracking schemes. Compare the PR migration files
   against that live baseline; execute **only** reviewed, missing changes on a
   disposable production-schema-compatible staging DB. The CI seed-db test is
   important but is not a substitute for staging parity.
3. **Backup and rollback.** Prove a recoverable point-in-time backup or
   validated snapshot and a revert plan, plus an operational maintenance window.
   Never treat a compensating inventory adjustment as equivalent to a database
   rollback of accounted transactions.
4. **Print agent.** Inspect each branch's *physical* Windows PC: printer test
   page, local print service/agent connectivity, branch binding, station route
   `kit`/`main`/`cashier`, and sole active queue consumer. The V8.1 agent
   documentation defaults `Production Queue` OFF and prohibits V7+V8.1
   simultaneous consumers. Reconcile old jobs with actual paper/receipts
   **one at a time**; no bulk replay/requeue/delete or automatic claiming of
   months-old receipts. The PR adds only a dashboard warning.
5. **Inventory.** For each of 10 records compare the original purchase,
   production, sale, stock count and warehouse transfer documents to signed
   batches, `inventory_ledger`, movement records and any FIFO debt. Verify
   physical count with branch operator. Decide whether a *missing movement
   event*, historic opening balance or a *real physical difference* exists.
   Only after approval apply an idempotent, branch- and warehouse-scoped
   correction through the existing stock adjustment RPC and balanced
   accounting path; **never** directly UPDATE balance caches, opening balances,
   posted journals or debt totals to make the audit green.
6. **Kitchen and table.** Confirm seven active table orders and the one
   occupied-without-order against order events before any correction. Match the
   one kitchen send to inventory event/sale settlement and ensure no repeat raw
   deduction. Do not independently change table/order rows while orders are open.
7. **Check and release.** Re-run read-only production audits (posted journals
   balanced, stock source relationships, print queue statuses, branch isolation),
   CI on the latest PR SHA, staged Playwright authenticated flows for both
   branches, and a staged production deployment before domain promotion.
   Merge or promote only after the owner and operator sign off.

## Explicitly withheld operations

No live DB schema updates, cash/accounting journal edits, inventory quantity
updates, order status changes, print-job status rewrites, branch assignment
changes, Vercel deployment, GitHub main merge or Supabase branch creation
were performed by this reconciliation pass.
