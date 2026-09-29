# ORGANIZATION BUSINESS PROFILES — ACTIVE WORK LOG

Repository: `Premieros/.com`
Branch: `development/organization-business-profiles-20260929`
Production Supabase: `hvqlkapynjfjikqithvd`
Source repository: `Premieros/johna-s` — READ ONLY
Source Supabase: `azzdesuowpdcoflmyezn` — READ ONLY
Last updated: 2026-09-29 Africa/Cairo

## Goal

Turn organization creation into full business provisioning. A Super Admin selects a business type and the system creates a runnable organization with its first branch, warehouse, branch settings, trial subscription, owner account, organization membership, selected modules, terminology and capability profile.

## Approved business profiles

- restaurant
- food_manufacturing
- pharmacy
- car_showroom
- tourism
- retail
- services
- custom

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

## Implementation

- Added business profile presets in `src/core/organizations/businessProfiles.ts`.
- Presets define default modules, terminology, capabilities, tax and currency defaults.
- Added append-only migration `20260929144000_organization_business_profiles.sql`.
- Added Super Admin-only atomic RPC `super_admin_create_organization_from_profile`.
- RPC provisions organization + first branch + warehouse + branch settings + trial + owner + membership + explicit organization module overrides.
- Added `OrganizationCreateWizard` to Super Admin organization directory.
- The wizard allows reviewing and changing modules before creation.
- API contract updated for the new RPC.
- Hosted Production migration has NOT been applied.

## Verification gate

Required before merge or hosted migration:
- active work log gate Green
- repository/Supabase identity Green
- frontend API contract Green
- lint Green
- typecheck Green
- unit Green
- build Green
- DB integration/security/RLS Green
- browser smoke Green

## Next action

1. Add regression contracts for profile presets and provisioning security.
2. Run Fast Verify and Full Verify on exact branch HEAD.
3. Fix target-side failures only.
4. Stop at Production migration gate unless explicit approval is given.
