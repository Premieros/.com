# Database Identity Lock — Premieros/.com

## Canonical identity

This repository is bound to exactly one hosted Supabase project:

- Repository: `Premieros/.com`
- Supabase project ref: `cuitndfayupfysejlpda`
- Supabase project URL: `https://cuitndfayupfysejlpda.supabase.co`

## Non-negotiable rule

Application code, CI, deployment workflows, print agents, operational scripts and documentation must not point to any other hosted Supabase project or any other Premieros repository.

Local PostgreSQL on `localhost` / `127.0.0.1` is allowed only for isolated CI and development tests.

## Enforcement

- `scripts/db/verify-database-identity.js` validates runtime environment identity.
- `scripts/db/verify-project-references.js` scans the repository and rejects foreign project/database references.
- CI and deployment workflows run both checks.

## Change control

Changing the canonical project identity requires an explicit user instruction and a separately reviewed migration/rollback plan. Database schema changes remain separately approval-gated.
