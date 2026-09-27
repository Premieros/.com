# CLEAN CLONE BOOTSTRAP — 2026-09-27

Repository: `Premieros/.com`
Production Supabase: `hvqlkapynjfjikqithvd`
Branch: `development/clean-clone-bootstrap-20260927`
Current PR: `#1`
Last updated: 2026-09-27
State: **BLOCKED**

## Work status

- Independent clean clone created from `Premieros/johna-s`.
- New Supabase project: `hvqlkapynjfjikqithvd`.
- All 444 canonical migrations applied successfully.
- Operational data is empty: users, sales, orders, purchases, expenses, inventory ledger, journal entries = 0.
- Structural baseline seeds from migrations remain (default branch, 50 tables, roles, units, chart of accounts).
- PR #1 is Draft. No merge yet.

## Guardrails

- Never connect this repository to `azzdesuowpdcoflmyezn`.
- No direct writes to `main`.
- No merge until exact-head verification is green.
- No copying of operational data from the original system.
- Printing / Print Agent / routing / KDS / send-to-kitchen behavior is not being modified by this bootstrap.
- Permission-First and RLS remain unchanged.

## Baseline

- New repository: `Premieros/.com`.
- New Supabase project: `hvqlkapynjfjikqithvd`.
- Database migration ledger: 444 rows.
- Last migration: `20260926180000_pos_table_order_binding_guard.sql`.

## Root-cause ledger

- Initial clone retained hard-coded references to the original Production Supabase project.
- CI worklog gate retained original repository/project identity.
- GitHub workflows retained original Supabase project identity.

## Change ledger

- Removed application fallback to the original Production Supabase URL.
- Locked identity verification to `hvqlkapynjfjikqithvd` and blocked `azzdesuowpdcoflmyezn`.
- Deployment remains manual during bootstrap.
- CI/worklog identity is being aligned to the new repository/project.

## Verification ledger

- New Supabase project status: ACTIVE_HEALTHY.
- 444/444 migrations applied.
- Operational tables verified empty.
- Security advisor comparison shows no new security warning class versus the source Production project.
- PR #1 first Verify run failed only at the inherited mandatory-worklog identity gate.
- Exact-head Full Verify: pending after CI/worklog update.

## Production gate

- Merge to `main`: **BLOCKED**.
- GitHub Pages deployment: **BLOCKED**.
- First operational user/bootstrap: **BLOCKED** until exact-head verification is green.
- No action may target the original Production project.

## Next action

Run exact-head PR verification after the CI/worklog identity update. If green, report readiness and wait for explicit merge approval.

## Mandatory update protocol

- Update this log after every material repository change.
- Record every verification run and result.
- Re-check branch HEAD before further writes.
- Keep State **BLOCKED** until exact-head verification is green and merge is explicitly approved.
