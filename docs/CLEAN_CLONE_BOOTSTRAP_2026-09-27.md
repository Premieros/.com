# CLEAN CLONE BOOTSTRAP — 2026-09-27

Repository: `Premieros/.com`
Production Supabase: `hvqlkapynjfjikqithvd`
Branch: `development/safe-pages-deploy-20260927`
Current PR: `#2`
Last updated: 2026-09-27
State: **BLOCKED**

## Work status

- Independent clean clone created from `Premieros/johna-s`.
- New Supabase project: `hvqlkapynjfjikqithvd`.
- All 444 canonical migrations applied successfully.
- PR #1 merged to `main`.
- Post-merge Full Verify reported Green.
- First Auth user `sayed3la2@gmail.com` is linked in `public.users` as active `super_admin` on the default branch.
- Bootstrap RPC is not executable by `PUBLIC`, `anon`, or `authenticated`.
- GitHub Pages deployment remains manual while deployment parity is hardened.

## Guardrails

- Never connect this repository to `azzdesuowpdcoflmyezn`.
- No direct writes to `main`.
- No merge until exact-head verification is green.
- No copying of operational data from the original system.
- Printing / Print Agent / routing / KDS / send-to-kitchen behavior is not being modified.
- Permission-First and RLS remain unchanged.
- Deployment changes must remain scoped to `Premieros/.com` and `hvqlkapynjfjikqithvd`.

## Baseline

- New repository: `Premieros/.com`.
- New Supabase project: `hvqlkapynjfjikqithvd`.
- Base `main` commit: `1689bdaa5df6ef956e65858ddcb960adcfb26417`.
- Database migration ledger: 444 canonical migrations.
- Last canonical migration: `20260926180000_pos_table_order_binding_guard.sql`.

## Root-cause ledger

- Bootstrap clone initially retained hard-coded references to the original Production project; PR #1 corrected those references.
- The manual Pages workflow still relied on repository variables for its production-parity job, creating an avoidable deployment configuration dependency.
- The browser client key is a Supabase publishable key and is safe to expose in frontend build configuration; secret/service-role credentials remain prohibited.

## Change ledger

- PR #1 merged and locked application/CI identity to `hvqlkapynjfjikqithvd`.
- First operational super admin has been bootstrapped without copying source-system operational data.
- Created `development/safe-pages-deploy-20260927` from the exact merged `main` head.
- Next change: make the manual GitHub Pages deploy workflow self-contained for the locked clean-clone identity, without repository-variable drift and without any privileged Supabase secret.

## Verification ledger

- New Supabase project status: ACTIVE_HEALTHY.
- `sayed3la2@gmail.com` exists once in Auth and is linked as active `super_admin`.
- Bootstrap function execute privileges: `PUBLIC=false`, `anon=false`, `authenticated=false`.
- Application routing uses `HashRouter`, suitable for GitHub Pages project-site navigation.
- Vite base defaults to relative `./`, suitable for project-site assets.
- Security advisor shows inherited warnings; no broad security rewrite is included in this deployment-only change.
- Exact-head verification for PR #2: pending.

## Production gate

- Merge to `main`: **BLOCKED** pending PR #2 exact-head verification.
- GitHub Pages deployment: **BLOCKED** pending PR #2 merge and manual workflow dispatch.
- Original Production project `azzdesuowpdcoflmyezn`: **DO NOT TOUCH**.

## Next action

Harden `.github/workflows/deploy.yml` so all deployment jobs use the same locked clean-clone project URL/ref and the browser-safe publishable key, then run exact-head verification on PR #2. Do not merge until Green.

## Mandatory update protocol

- Update this log after every material repository change.
- Record every verification run and result.
- Re-check branch HEAD before further writes.
- Keep State **BLOCKED** until exact-head verification is green and merge is explicitly approved.
