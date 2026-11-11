# POS partial item transfers — release blocked pending compatibility/security audit

**Status: BLOCKED / NOT DEPLOYABLE.** This PR is a candidate only. Do not merge or apply the SQL to Premier production.

## Verified baseline
- Premier production currently exposes the 3-argument `transfer_order_items_to_table(uuid,uuid[],uuid)` RPC; no 4-argument quantity-transfer overload. Verified by read-only database introspection.
- The Johna's source's own feature document `docs/PARTIAL_ITEM_TRANSFER_20261024.md` explicitly marks partial quantity transfer **BLOCKED**, with no production migration, merge or deployment authorized.
- Porting the UI alone would break the existing transfer flow because its 4-argument RPC is unavailable.
- Source migration is ~75 KB and **overrides several POS ownership, kitchen send, sent-item, pricing, and permission guard functions**. Successful compilation would not establish safety against later Premier-specific permission and inventory migrations.

## Candidate implementation (never run against production as part of review)
- Exact persisted-line equality (including quantity, product, unit, price, discount, bonus, notes and modifiers) before enabling transfer.
- Quantity input per selected saved line and immutable expected-line evidence.
- Stable operation UUID across retry of an unknown outcome; no optimistic partial cart subtraction.
- Server-authoritative source/target/table/KDS snapshot reconciliation and preservation of unrelated unsaved lines.
- Additive transfer event lineage only; no inventory re-consumption or kitchen resend.
- Production schema/data/permissions untouched; source repository is read only.

## Mandatory gates before release
1. Replace the copied migration's broad trigger/function overrides with an **audited Premier-native diff**. Confirm current production function definitions, owner/ACL, trigger order, and security invoker/definer modes remain intact. Never bypass source-drift guards.
2. Ensure compatibility with all Premier migrations after October 2026, including November permission-first, composite branch FK, shift settlement, stock accounting and printing safeguards.
3. Exact-head TypeScript, lint, tests, build, and complete isolated PostgreSQL migration replay must all pass.
4. In isolated database, verify sent and unsent partial moves, KDS sent/served snapshots, frozen costs, modifier price preservation, payment restrictions, rollback on conflict, concurrent source changes, permission boundaries and idempotent replay.
5. Full-row transfer RPC must continue to work for existing clients.
6. Stage an **audited disable/rollback** action that preserves transfer lineage for already committed movements; never delete lineage or rewrite historical business records.
7. Obtain explicit production release approval for the reviewed migration and matching frontend before applying the migration to Premier's production DB. Verify function signatures and permission sources immediately before release.

## Important
GitHub CI may be queued; absence of test failure is not a pass. There is no authorization to edit Johna's or to manufacture sale/stock data for test transactions in production.

## Read-only Premier production function baseline (2026-11-11)
Verified directly from the currently connected Premier Supabase project, without data writes:

| Routine | Exact arguments | Security mode | Definition MD5 (audit reference only) |
|---|---|---|---|
| transfer_order_items_to_table | uuid, uuid[], uuid | SECURITY DEFINER | `1771e6316b3ae68627d362090c3ff1d4` |
| guard_pos_operator_ownership | none | SECURITY DEFINER | `493e1be94be8a4ff6ee322dbdca370c4` |
| guard_kitchen_send_operator_ownership | none | SECURITY DEFINER | `83c523bcd19573abc7bf6686e39a9fea` |
| guard_sent_order_item_mutation | none | SECURITY DEFINER | `e03bb3a524ed6a542442a7326ea0726a` |
| enforce_pos_permission_mutation | none | SECURITY DEFINER | `2c3c0814e1987308b210f289b955c784` |
| _reprice_order_item | none | SECURITY DEFINER | `3de734b13ece6baff879c66f7c0e0637` |

The checked functions are owned by `postgres`, have `search_path=public, pg_temp`, and their ACLs are restricted to `postgres, service_role` except the existing 3-argument transfer RPC, which also allows `authenticated`. The exact **four-argument JSON transfer overload is not present** in production. These hashes are diagnostic baselines, not blanket permission to replace functions. Re-read definitions, ownership and ACLs before any approved release.

Because the source SQL overrides existing functions without proven equivalence to these Premier definitions, **the copied 75 KB migration remains unapproved**. A future revision must explicitly preserve each security check introduced in Premier's later migrations, and the source's own documented release gate must be satisfied.
