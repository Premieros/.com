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

The repository identity cleanup is mandatory before any further architecture, offline, inventory, manufacturing or accounting work.

After identity cleanup, review the current offline/local-first implementation and negative-stock controls from the latest `main` baseline before making further changes.

## Verified execution checkpoint — 2026-10-12

- Phase 8C PR #89 merged on `main` as `6214f9f6`; production migration `20261011133446` already applied.
- Post-merge Verify main and GitHub Pages passed. Scheduled internal outbox invocation is healthy, but real-event ingestion is still unproven and no provider-backed AI agent is deployed.
- Read-only cross-domain audit found 0 failures in 16 hard invariant checks; 147 policy-allowed negative raw balances, 8 classified manual-only inventory review cases, and one additional 0.3000 batch/operational discrepancy pending provenance review.
- See `docs/architecture/POST_PHASE8C_INTEGRITY_AUDIT_2026-10-12.md` and `scripts/audit/erp-cross-domain-readonly.sql` for the recorded evidence. No data repair or schema change authorized by this checkpoint.
