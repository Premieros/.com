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
