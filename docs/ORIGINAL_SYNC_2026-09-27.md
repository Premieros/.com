# ORIGINAL PROJECT SYNC — ACTIVE WORK LOG

Repository: `Premieros/.com`
Production Supabase: `hvqlkapynjfjikqithvd`
Branch: `development/original-sync-20260927`
Current PR: `#5`
Last updated: 2026-09-27 Africa/Cairo

## Work status

State: **BLOCKED**

Goal: port the new verified functional changes from read-only `Premieros/johna-s` into the independent multi-organization `Premieros/.com` codebase without replacing its organization/module architecture or project identity.

## Guardrails

- Writable repository is only `Premieros/.com`.
- `Premieros/johna-s` and Supabase `azzdesuowpdcoflmyezn` are read-only/forbidden for writes.
- Preserve organization module routing and Permission-First behavior.
- Preserve the new project identity fence for `hvqlkapynjfjikqithvd`.
- No printing, Print Agent, routing, KDS transport, or send-to-kitchen behavioral changes.
- No hosted migration before exact-head Full Verify is Green.
- Never replace `CURRENT_WORK_PLAN.md` or API contract with old-project identity/configuration.

## Baseline

- Independent project main before sync: `c0e159400622a2b8d989c8414d4cea58668205ab`.
- Organization modules rollout is already verified and applied on `hvqlkapynjfjikqithvd`.
- Original project gained seven relevant packages after the clean fork: treasury daily rows, automatic day close, permission runtime alignment, simplified modifier groups/options, catalog model alignment, settlement modifier normalization, and zero-idle runtime optimization.
- The sync is a manual port/rebase because `.com` has additional organization/module code in Layout, routes, Super Admin and Supabase identity controls.

## Root-cause ledger

1. Blind cherry-picking would overwrite organization-aware route/navigation behavior.
2. The original project API contract does not contain `.com` organization RPCs, so it must be merged rather than copied.
3. Catalog alignment retires recipe/manufacturing navigation and treats component groups as catalog configuration.
4. The two new DB migrations must be verified on the independent schema before any hosted apply.
5. Runtime optimization must retain frozen printing/KDS/settlement authority boundaries.

## Change ledger

- Created isolated sync branch from exact independent main.
- Ported Treasury daily single-row UI and main/branch treasury presentation.
- Ported permission/runtime approval alignment and requester/action visibility.
- Ported simplified modifier groups plus separate modifier options page.
- Ported catalog model alignment and removal of legacy recipe/manufacturing UI dependencies.
- Ported POS settlement modifier-order normalization migration.
- Ported automatic fixed-time business-day close migration.
- Ported zero-idle runtime changes: realtime approval watches, visible-session role refresh, duplicate shell/POS read suppression, and lighter POS catalog reads.
- Merged routes manually to preserve organization module enforcement.
- Mapped modifier options and component groups to the catalog organization module.
- Merged API contract while retaining organization RPCs.

## Verification ledger

- Pre-sync independent main Full Verify: Green.
- Sync branch verification: pending.
- Hosted migrations: not applied.

## Production gate

State: **BLOCKED**

No migration or hosted schema mutation is allowed until the sync PR exact-head Full Verify is Green and the migration set is reviewed against `hvqlkapynjfjikqithvd`.

## Next action

Finish test/worklog synchronization, open the PR, run exact-head Full Verify, reconcile any organization-specific conflicts, and stop before hosted migration if any verification is not Green.

## Mandatory update protocol

- Before every write, confirm the sync branch remains the expected branch.
- Unexpected branch/head movement = STOP_AND_RECONCILE.
- Update this Change ledger for every logical port group.
- Update Verification ledger with exact CI run results.
- Keep `Premieros/johna-s` read-only.
- CI must fail rather than weakening identity, RLS, permissions, tests, or organization module guards.
- لا Merge ولا Production migration قبل Full Verify Green.
