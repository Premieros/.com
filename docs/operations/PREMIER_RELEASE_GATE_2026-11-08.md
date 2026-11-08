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
- Vercel deployment `premieros-sage.vercel.app` returned 404 to the
  **currently connected Vercel account**. That account lists other projects,
  not this site. GitHub repository homepage points at the site, but GitHub
  homepage metadata is not proof of deployment ownership or environment values.
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
| Canonical inventory mismatches | 10 | 9 raw material (7 Cleopatra, 2 Smouha), 1 semi-finished (ASD) |
| Raw stored-versus-batch mismatch | 1.35 absolute units across raw cases | The other 8 raw cases match batches but differ from movement sums; updating stored stock is not a remedy |
| Raw movement absolute deltas | 96.925 units summed across 9 cases | Historical movement lineage must be reconciled first |
| Semi-finished movement delta | 7 units | Stored -14, batches -7, movements -7; establish source-of-truth before adjustment |
| Tables vacant with effective open orders | 7 | All Cleopatra; frontend now shows occupied based on effective order, but stored state is not silently changed |
| Tables occupied without effective open order | 1 | Cleopatra; needs order lifecycle review |
| Kitchen send / pending inventory event mismatch | 1 | Cleopatra; no automatic extra deduction or reversal |
| Print jobs older than 10 minutes | 22 | 9 ASD kitchen/main, 4 Cleopatra kitchen/kit, 9 Cleopatra receipts/cashier; all pending, 0 attempts and never claimed. Some date back to 2026-09-30 |

Use `scripts/audit/premier-production-triage-readonly.sql` to reproduce
the branch/category summary; use existing
`scripts/audit/critical-integrity.sql` and
`scripts/audit/erp-cross-domain-readonly.sql` for broader invariants.

## Mandatory release gates

1. **Correct Vercel owner.** Connect the Vercel team that *actually owns*
   `premieros-sage`; verify project ID, Git repository, production branch,
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
