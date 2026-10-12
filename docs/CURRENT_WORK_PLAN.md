# CURRENT WORK PLAN — Premieros/.com — SOURCE OF TRUTH

## Canonical project

- Repository: `Premieros/.com`
- Baseline branch: `main`
- Canonical Supabase project: `hvqlkapynjfjikqithvd`
- Canonical Supabase URL: `https://hvqlkapynjfjikqithvd.supabase.co`

No other hosted database or repository is an allowed source, fallback, donor, mirror or runtime dependency.

## Mandatory execution rules

- Verify repository/database identity before every deployment or database-facing operation.
- Do not modify database schema, tables, columns, relationships, constraints, indexes, functions, triggers or RLS without explicit user approval.
- Preserve organization, branch, warehouse, permissions and accounting/inventory integrity.
- Repository writes must be sequential and based on the latest verified HEAD.
- Do not force-push or rewrite production history.
- Build, typecheck, lint and relevant tests must pass for completed changes.

## Current priority

Canonical repository and Supabase identity are locked. Continue with the approved change set and evidence-backed rollouts from the latest verified `main` baseline.

Post-Phase 8C priority: investigate the historical raw FIFO/branch-balance variance (manual review only), verify offline/local-first sale replay and negative-stock guards, extend procurement receipt and purchase correction end-to-end coverage, and finish organization-account cutover before provider-backed AI integration.

## Verified execution checkpoint — 2026-10-12

- Phase 8C PR #89 merged on `main` as `6214f9f6`; production migration `20261011133446` already applied.
- Post-merge Verify main and GitHub Pages passed. Scheduled internal outbox invocation is healthy, but real-event ingestion is still unproven and no provider-backed AI agent is deployed.
- Read-only cross-domain audit found 0 failures in 16 hard invariant checks; 147 policy-allowed negative raw balances, 8 classified manual-only inventory review cases, and one additional 0.3000 batch/operational discrepancy pending provenance review.
- See `docs/architecture/POST_PHASE8C_INTEGRITY_AUDIT_2026-10-12.md` and `scripts/audit/erp-cross-domain-readonly.sql` for the recorded evidence. No data repair or schema change authorized by this checkpoint.

## Purchase-return guard rollout checkpoint — 2026-10-12

- PR #91 merged to `main` at `1482492f` after complete Verify, DB and Playwright success. This is an approved modification to the `process_purchase_return` routine, not a stock or journal data migration.
- Supabase canonical project `hvqlkapynjfjikqithvd`: remote migration version **`20261012134314`**, named `purchase_return_fifo_shortage_guard`; repository migration file was aligned to that exact version in a follow-up PR.
- The function now raises on partial FIFO shortages and rolls back previous sub-operations; production owner and grants were preserved. A version-specific operator-only rollback definition remains at `scripts/rollback/20261012130000_restore_purchase_return.sql`.
- 16 read-only hard cross-domain checks passed after deployment. Inventory history and ledger counts did not change. The 0.3000 extra batch/operational discrepancy and previously classified 8 exceptions remain under review; no automatic historical repair.
- Remaining follow-up: purchase correction UI error display, broader multi-line/receipt tests, and historical FIFO debt/COGS evidence inspection before any data changes.

See `docs/architecture/PURCHASE_RETURN_FIFO_SHORTAGE_GUARD_PROPOSAL_2026-10-12.md` for the full evidence and safety/rollback gates.
