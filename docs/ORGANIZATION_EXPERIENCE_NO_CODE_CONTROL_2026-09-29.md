# ORGANIZATION EXPERIENCE / SUPER ADMIN NO-CODE CONTROL — ACTIVE WORK LOG

Repository: `Premieros/.com`
Branch: `development/organization-theme-pos-layout-20260929`
Production Supabase: `hvqlkapynjfjikqithvd`
Source repository: `Premieros/johna-s` — READ ONLY
Source Supabase: `azzdesuowpdcoflmyezn` — READ ONLY
Last updated: 2026-09-29 Africa/Cairo
State: **BLOCKED**

## Work status

Active implementation. Goal is to move broad organization customization into Super Admin so normal business customization does not require source-code edits. This work must remain configuration-driven while preserving one shared codebase and one stable financial/security core.

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
- Core financial settlement, accounting invariants, RLS, stock integrity and audit rules are not exposed as free-form customization.
- Printing / Print Agent routing / KDS transport / send_to_kitchen internals are not changed casually.
- No Production migration or data write without exact-head Full Verify Green and explicit approval.
- This log is the execution source of truth. Memory/chat is not.

## Baseline

- Base `main`: `b647830ad93ef1028db3c62818cf3dcc7585ecf3`.
- PR #9 organization business profiles are merged and post-merge Verify/DB/Browser Smoke Green.
- Existing `organizations.business_type` and `organizations.business_profile` are reused.
- No new database schema is required for theme/terminology/POS layout unless later proven necessary.
- Current active branch: `development/organization-theme-pos-layout-20260929`.

## Root-cause ledger

1. Business profiles now define capabilities, but large UI/customization changes still require source edits.
2. ThemeContext is global/user-oriented and not yet organization-aware.
3. Navigation labels are mostly static translations rather than tenant terminology.
4. POS layout assumes restaurant concepts in several places: tables, kitchen, delivery, drive-thru, shifts and order labels.
5. Existing organizations need the same customization controls as newly created organizations.
6. Super Admin needs safe no-code control without exposing accounting/security invariants.

## Target architecture

### 1. Organization Experience Profile
Stored inside `organizations.business_profile`:
- `theme_profile`
- `terminology_profile`
- `pos_layout`
- future safe UI configuration keys

### 2. Business Theme
Super Admin controls:
- theme preset
- brand hue/saturation
- surface hue/saturation
- light/dark default
- radius/density profile
- later: logo/visual identity linkage

### 3. Terminology Pack
Per-organization labels for:
- item / items
- customer / customers
- supplier / suppliers
- branch / branches
- sale / sales
- order / orders
- new order
- business records
- later: center/page aliases where safe

Terminology changes UI labels only. Database names, API contracts and permission keys stay canonical.

### 4. POS Layout Presets
Supported layouts:
- restaurant
- retail
- pharmacy
- wholesale
- vehicle
- service

Each preset controls presentation/capability visibility:
- tables
- kitchen/KDS
- delivery
- drive-thru
- shift controls
- customer focus
- barcode-first mode
- product card density
- primary action label/intent

The payment/settlement engine remains shared.

### 5. Existing Organization Customization
Super Admin must be able to modify:
- organization theme
- terminology
- POS layout
- module toggles

Changes must not require repository edits.

### 6. Future No-Code Customization Backlog
Add only after current phase is stable:
- configurable safe POS action visibility
- configurable dashboard widgets
- configurable center/page ordering
- default new-branch settings templates
- reusable organization templates
- clone template to another organization
- reset organization to business-type defaults
- controlled custom fields editor using existing runtime field schema
- controlled business-record type editor
- logo/receipt visual identity where existing settings support it

## Safety boundary — never no-code free-form

The following remain code-governed:
- RLS/security policies
- payment settlement invariants
- accounting posting rules
- inventory integrity/consumption rules
- audit requirements
- permission identifiers and authorization semantics
- Print Agent routing safety
- database destructive behavior
- arbitrary SQL / arbitrary scripts

## Change ledger

Completed on active branch:
- [x] Added `organizationExperience.ts` with activity-specific theme, terminology and POS layout presets.
- [x] Added `OrganizationExperienceContext.tsx` to resolve organization experience at runtime.
- [x] Applied organization theme variables dynamically.
- [x] Extended organization creation wizard with theme, POS layout and terminology controls.
- [x] Added editing of theme, POS layout and terminology for existing organizations in Super Admin.
- [x] Began POS top-bar adaptation: tables/KDS/delivery/shift controls respect organization layout.
- [x] Began POS workspace adaptation: non-table organizations skip table landing; kitchen requirements are layout-aware.
- [x] POS cart terminology and available order-type buttons are organization-aware.
- [x] Navigation labels for products/people/operations now use organization terminology.

Pending:
- [ ] Validate and fix TypeScript/runtime regressions from current changes.
- [ ] Ensure restaurant behavior remains unchanged by default.
- [ ] Ensure non-restaurant POS cannot accidentally expose dine-in/table/KDS flows.
- [ ] Make barcode-first layout focus/search behavior deterministic.
- [ ] Add safe theme customization controls beyond preset selection only if existing CSS variables support them cleanly.
- [ ] Add reset-to-business-default action in Super Admin.
- [ ] Add regression contract tests for theme/terminology/POS layout.
- [ ] Add browser smoke coverage for restaurant vs non-restaurant layout visibility.
- [ ] Update CURRENT_WORK_PLAN and keep this log current.
- [ ] Open Draft PR.
- [ ] Fast Verify exact-head Green.
- [ ] Full Verify exact-head Green: app + DB/security + Browser Smoke.
- [ ] Stop before Production/merge gates unless explicitly approved.

## Verification ledger

Not yet final. Current code HEAD before documentation update:
`fde4f3ba84b2cc36d9e09d22415d083ca0d1a7dc`

No hosted Production migration/data write has been performed for this phase.

## Production gate

Production database mutation: **NOT REQUIRED CURRENTLY / BLOCKED IF SCOPE CHANGES**
Merge: **BLOCKED**
Deployment: **BLOCKED**

## Next action

1. Point CURRENT_WORK_PLAN to this file and active branch.
2. Run code-level inspection/CI to identify current regressions.
3. Complete safe POS/no-code customization controls.
4. Add contract and browser regression tests.
5. Open Draft PR and run Fast Verify + Full Verify.
6. Stop at merge/deploy approval gate.

## Mandatory update protocol

- Read this file and CURRENT_WORK_PLAN before substantive continuation.
- Before every repository write, verify current branch HEAD.
- Any unexpected HEAD movement = STOP_AND_RECONCILE.
- Update Change ledger and Verification ledger after material progress.
- Never infer completion from chat history.
- Do not mark items complete without tool evidence.
