# ORGANIZATION BUSINESS PROFILES — ACTIVE WORK LOG

Repository: `Premieros/.com`
Branch: `development/organization-business-profiles-20260929`
Current PR: `#9`
Production Supabase: `hvqlkapynjfjikqithvd`
Source repository: `Premieros/johna-s` — READ ONLY
Source Supabase: `azzdesuowpdcoflmyezn` — READ ONLY
Last updated: 2026-09-29 Africa/Cairo
State: **BLOCKED**

## Work status

Implementation is active on PR #9. The feature is code-complete enough for CI, but merge and hosted Production migration remain blocked until exact-head Full Verify is Green and explicit approval is given.

## Guardrails

- Write only to `Premieros/.com`.
- Never write to `Premieros/johna-s`.
- Never write to source Supabase `azzdesuowpdcoflmyezn`.
- No direct write to `main`.
- No force push.
- Check exact branch HEAD before every write.
- Unexpected HEAD = STOP_AND_RECONCILE.
- Permission-First, RLS, organization isolation and branch isolation remain mandatory.
- Super Admin is the only implicit platform-wide bypass.
- No Production migration on `hvqlkapynjfjikqithvd` before exact-head Full Verify Green and explicit approval.
- Printing / Print Agent / KDS internals / send_to_kitchen / shifts are not modified by this project.

## Baseline

- Base `main`: `20c2fed81a7b11624293d7a5e586a89ae38f1ee4`.
- Existing organization module controls and route gating are reused.
- Existing `organizations`, `branches`, `warehouses`, `branch_settings`, subscriptions, membership and feature override infrastructure are retained.
- No parallel tenant/module system is introduced.

## Root-cause ledger

1. Super Admin could manage existing organizations but had no complete organization provisioning flow.
2. Business type was not persisted on organizations.
3. Organization module selection existed, but new organizations did not receive activity-specific module presets.
4. Creating an organization did not atomically provision a first branch, warehouse, owner and organization membership.
5. Activity-specific terminology/capability metadata did not exist.

## Change ledger

- Added business profile presets in `src/core/organizations/businessProfiles.ts`.
- Presets cover restaurant, food manufacturing, pharmacy, car showroom, tourism, retail, services and custom.
- Presets define default modules, terminology, capabilities, tax and currency defaults.
- Added append-only migration `20260929144000_organization_business_profiles.sql`.
- Added Super Admin-only atomic RPC `super_admin_create_organization_from_profile`.
- RPC provisions organization + first branch + warehouse + branch settings + trial + owner + membership + explicit organization module overrides.
- Added `OrganizationCreateWizard` to Super Admin organization directory.
- Wizard allows reviewing and changing modules before creation.
- API contract updated for the new RPC.
- Added regression contract test `organizationBusinessProfilesContract.test.ts`.
- Hosted Production migration has NOT been applied.

## Verification ledger

- Fast Verify and Full Verify started on HEAD `21d126ca9808ef8aa806e9a134e901195ae42526`.
- Initial Full Verify stopped only at active-worklog structure gate.
- API contract verification passed in Fast Verify before the documentation correction.
- Worklog structure is being reconciled before rerunning verification.

## Production gate

- Hosted Production migration: **BLOCKED**.
- No DDL has been applied to `hvqlkapynjfjikqithvd` for this feature.
- No source database or source repository mutation is allowed.
- Merge and hosted migration require exact-head Green verification and explicit approval.

## Next action

1. Re-run verification after the worklog gate correction.
2. Repair only target-side regressions.
3. Stop at hosted Production migration gate after Green verification.

## Mandatory update protocol

- Before every repository write, read the current branch HEAD.
- Any unexpected HEAD movement means STOP_AND_RECONCILE.
- Update this log after material scope or verification-state changes.
- Keep the declared branch equal to the PR head branch.
- Do not mark State unblocked until the full verification gate is satisfied.
