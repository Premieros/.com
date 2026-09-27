# ORGANIZATION MODULES — 2026-09-27

Repository: `Premieros/.com`
Production Supabase: `hvqlkapynjfjikqithvd`
Branch: `main`
Current PR: `#0`
Last updated: 2026-09-27
State: **BLOCKED**

## Work status

- The new development project is the only writable repository for this work.
- Organization / tenant architecture is being rebuilt around explicit organization-scoped modules.
- Existing feature-gating tables and RPCs will be reused instead of creating a second parallel system.
- Direct writes to `main` are explicitly authorized by the user for this development-only project.
- Database migrations remain blocked from the hosted Supabase project until Full Verify is Green.

## Guardrails

- Writable repository: `Premieros/.com` only.
- Writable Supabase target after verification: `hvqlkapynjfjikqithvd` only.
- `Premieros/johna-s` is strictly read-only reference material and MUST NEVER receive a write from this work.
- `azzdesuowpdcoflmyezn` is strictly blocked.
- Any detected repository identity other than `Premieros/.com` = STOP immediately.
- Any detected Supabase project ref other than `hvqlkapynjfjikqithvd` = STOP immediately.
- No force push.
- Permission-First remains mandatory; Super Admin is the only implicit platform-wide bypass.
- Do not weaken RLS.
- Printing / Print Agent / routing / KDS / send-to-kitchen internals are not modified by the organization-module project.

## Baseline

- Current module registry already exists in `public.features`.
- Existing tenant feature resolution exists through `get_feature_access` / `can_access_feature`.
- Existing plan / subscription architecture exists, but `resolve_feature_access` currently returns unrestricted direct access and therefore does not enforce tenant module selection.
- Organization membership data is incomplete in the clean project bootstrap and must be repaired safely before relying on membership-only scoping.
- UI navigation currently filters by user permissions only; it is not yet filtered by organization-enabled modules.

## Root-cause ledger

1. Tenant feature infrastructure exists but runtime resolver currently allows every feature.
2. Organization-specific module selection is not exposed as a simple Super Admin control.
3. Navigation and route guards do not yet combine module access with Permission-First.
4. Membership and branch scope coexist and need one consistent organization resolution path.
5. Legacy subscription plan features include retired concepts that should not drive the new module model blindly.

## Change ledger

- Added repository identity lock to `scripts/db/verify-database-identity.js`.
- CI now fails when `GITHUB_REPOSITORY` is not exactly `Premieros/.com`.
- Original repository `Premieros/johna-s` is explicitly blocked by the identity check.
- Supabase project lock remains fixed to `hvqlkapynjfjikqithvd`; original project remains explicitly blocked.

## Verification ledger

- Identity-lock commit: `cc86114039af1681e649a3df5f236d4e2ed021a9`.
- Full Verify pending after organization-module implementation.

## Production gate

- Hosted Supabase migration: BLOCKED.
- Organization module schema/RPC changes may be committed to `main`, but may not be applied to hosted Supabase until exact-main Full Verify is Green.
- No write to any other repository or Supabase project is authorized.

## Next action

1. Normalize the module registry to business-facing modules.
2. Add organization-level module overrides using the existing feature registry.
3. Implement one authoritative organization module resolver.
4. Connect navigation + route access to module resolver while keeping Permission-First.
5. Add Super Admin UI to enable/disable modules per organization.
6. Add tenant-isolation and module-gating tests.
7. Run Full Verify before any hosted migration.

## Mandatory update protocol

- Before every repository write, read current `main` HEAD and reconcile unexpected movement.
- After every code or migration change, update this log.
- CI should fail on repository/Supabase identity mismatch.
- No hosted database mutation before Full Verify Green.
