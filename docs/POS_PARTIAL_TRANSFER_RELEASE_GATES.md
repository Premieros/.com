# POS partial item transfers — audited candidate, release approval required

**Do not merge, deploy, or apply this migration to production without explicit approval.**
Production was queried only for routine definitions/ownership/ACLs. No schema or business data was changed.

## CI and SQL fixes

- Head `1d7f195` failed both CI workflows because its test imported nonexistent `./db` and `./rls` helpers. The test now supplies a rollback-only fixture and authenticated-role executor; missing DB configuration/auth stub fails instead of skipping.
- Removed the copied `_capture_kitchen_ingredient_prices` replacement: Premier has no such routine. The canonical kitchen core writes frozen snapshots; splitting copies them without current recipe/price lookups.
- Rebased guards on Premier's actual definitions, retaining default-table bootstrap, authorized tenant purge, ownership, pricing, action-specific permissions and RLS. Removed unrelated quick-create/KDS permission changes copied from the source.
- Retained fail-closed source-body hashes and existing owner, ACL, search path and security mode. New helpers are SECURITY INVOKER with no authenticated/anon execution grants.
- Private transaction/backend-bound context prevents client-set session settings from authorizing split exceptions.
- November's `premier_kitchen_send_item_order_fk` remains validated and immediate by default. Transfer defers this exact FK while moving both parents, then forces validation before returning. No constraint, trigger, RLS policy or test was disabled by this fix.

## Production baseline rechecked read-only, 2026-11-12 Cairo

These normalized **function-body** MD5s supersede the older diagnostic hashes previously listed here; they match the full disposable canonical replay. They are not hashes of complete `pg_get_functiondef` strings.

| Routine | Body MD5 |
|---|---|
| `transfer_order_items_to_table(uuid,uuid[],uuid)` | `b0c4df0d8f3fba4bbf64c5b032b46084` |
| `guard_pos_operator_ownership()` | `b711286cb96b9959ae40e8ab4c7a39ec` |
| `guard_kitchen_send_operator_ownership()` | `df85fed351dae369b9baec70d5b36fac` |
| `guard_sent_order_item_mutation()` | `da5c7d97d3f7767e31d9c11d7df646b0` |
| `enforce_pos_permission_mutation()` | `bb52b53d857550c900cf8664214dfb78` |
| `_reprice_order_item()` | `3753587c8bd3ebff1469df445a7f1e02` |
| `_restore_kitchen_inventory_for_void(uuid,uuid,numeric)` | `01ae49ef4245574df2fa9b41f82e6e34` |
| `_restore_refund_hybrid_inventory(uuid,uuid,uuid,numeric,uuid,uuid,text)` | `0511c763a9243024d58571b34dcaedfb` |

All listed routines are postgres-owned SECURITY DEFINER with `search_path=public, pg_temp`. Existing guard/helper ACLs allow postgres/service_role only; the three-argument transfer additionally allows authenticated. Production has no four-argument quantity overload. No release was performed.

## Local execution evidence

Node 22.23.4, npm 10.9.9, PostgreSQL 16.15; owned loopback DB on port 55432, fresh `premier_pr170_final`.

- Canonical replay: **606 applied, 0 skipped**, auth stub separately. All five pinned historical CI compatibility tests passed; no source-drift guard was bypassed.
- Same schema verification/fixtures as `verify-main.yml`, including its pre-existing CI-only subscription/branch fixtures, which were not changed.
- Unit/components: **271 tests in 50 files passed**.
- Integration/security: **112 tests in 31 files passed**.
- Typecheck (application and tests), API contract/project identity, lint and production build passed locally. Lint has 39 existing warnings and no errors.
- Both Chromium smoke/offline-shell tests passed. Exact-head GitHub CI remains the final verification gate.

The 11 partial-transfer integration cases cover sent/unsent/served splits, frozen price/cost/rounding conservation, replay/conflict/stale evidence, permissions/foreign branches, paid orders, invalid quantities, old clients, concurrent branch commands, ACL/owner/FK invariants and the actual disable script.

The connected cycle receives 10 raw units, sends four through the real kitchen RPC (stock 6), transfers one, queues a thermal customer check once despite retry, and collects both orders with 15% tax (total 85.10). Stock stays 6; transfer and collection add no inventory ledger entries. Printing proof covers queue/payload/frontend contracts, not physical paper output on a production printer.

## Disable and rollback

`scripts/db/rollback/pos_partial_transfer_disable_REVIEW_ONLY.sql` disables **new** quantity commands through a private control row. It retains split rows, frozen snapshots, inventory effects, lineage/audit, and old three-argument transfers. Already-committed operations still resolve their idempotent result while disabled. The integration test executes the script within rollback-only fixtures.

Never roll back by deleting lineage, rewriting historical quantities, removing guards or replaying sales. Production use or re-enable requires approval.

## Release gates

1. Exact-head GitHub CI must pass, including DB and Chromium jobs.
2. Obtain explicit approval for reviewed SQL and matching frontend release.
3. Immediately before approved release, recheck function-body hashes, owners/ACLs, constraints and project identity; abort on drift.
4. Apply approved schema before publishing the matching frontend; verify RPC and agreed printer behavior under that separate approval.
