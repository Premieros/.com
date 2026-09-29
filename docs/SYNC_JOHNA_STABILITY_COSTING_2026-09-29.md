# SYNC JOHNA STABILITY + COSTING — ACTIVE WORK LOG

Repository: `Premieros/.com`
Branch: `development/sync-johna-stability-costing-20260929`
Current PR: `#8`
Production Supabase: `hvqlkapynjfjikqithvd`
Source repository: `Premieros/johna-s` — READ ONLY
Source Supabase: `azzdesuowpdcoflmyezn` — READ ONLY
Last updated: 2026-09-29 Africa/Cairo

## Work status

State: **BLOCKED**

Implementation is complete on the development branch. Block reason: Full Verify / DB / Browser Smoke must be Green before merge or Production migration.

## Guardrails

- Never write to `Premieros/johna-s`.
- Never write to source Supabase `azzdesuowpdcoflmyezn`.
- No direct write to `main`.
- Preserve `.com` organization/tenant model, RLS, permissions and branch isolation.
- Printing / Print Agent / KDS / send_to_kitchen / shifts are not modified.
- No Production migration before Green CI and explicit approval.

## Baseline

- `.com/main` baseline: `8db0815d2957a61b048aacfe99f04904d6b41bf6`.
- Source `johna-s/main`: `62daffd608b7e0dba4052157a8b3bd6b4e9022bc`.
- Synced source PRs: #401, #403, #404 only.
- Source PR #402 remains Draft and is excluded.

## Root-cause ledger

- `.com` was missing dashboard/system-health snapshot RPCs introduced by source PR #401.
- Internal trigger helper functions still had PUBLIC EXECUTE in `.com`.
- `.com` costing functions predated linked manufactured-group costing and theoretical recipe-source hotfix.
- Controlled numeric inputs did not preserve decimal draft strings such as `.050`.
- Heavy report loaders were still concentrated in the report page.

## Change ledger

- Added controlled decimal number draft handling.
- Added linked manufactured component-group costing detail.
- Added component-group costing types.
- Added dashboard bounded snapshot RPC + frontend service + dashboard integration.
- Added operational system health RPC + UI integration.
- Added bounded report loader services and ReportsPage split.
- Added internal trigger EXECUTE hardening migration.
- Added linked component-group costing migration.
- Added theoretical recipe-source costing hotfix migration.
- Preserved `.com` organization admin APIs and appended only the system-health RPC method.

## Verification ledger

- Source repository writes: none.
- Source database writes: none.
- Destination schema dependency check for required tables: passed.
- Full CI: pending.
- DB integration/security: pending.
- Browser smoke: pending.
- Production migration: not applied.

## Production gate

- Merge: blocked until Green CI.
- Production migration: blocked until Green CI and approval.
- Source remains read-only regardless of result.

## Next action

1. Run PR #8 Verify main.
2. Fix only `.com` regressions if any.
3. Require Verify + DB + Browser Smoke Green.
4. Stop before Production migration/merge unless explicitly approved.

## Mandatory update protocol

- Before every write, verify branch HEAD.
- Unexpected HEAD = STOP_AND_RECONCILE.
- Keep this file as source of truth for PR #8.
- Record verification and any blocker before Production changes.
