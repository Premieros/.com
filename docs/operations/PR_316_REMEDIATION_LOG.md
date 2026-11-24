# PR #316 — Remediation and merge log

Started 2026-11-24. Reviewed head: `74a65abbe0f9da54a7e2c5fa45865d05608eb921`. Target: main.

OPEN = unresolved; PARTIAL = incomplete mitigation; CODE = patch committed, verification pending; PASS = recorded verification; BLOCKED = requires evidence or authorization. Update this log after each batch and record final head, CI run IDs, acceptance evidence and merge SHA. No production writes, Vercel deployment, budget change or station remap authorized.

| ID | Priority | Work item | Status |
|---|---|---|---|
| R01 | P1 | Bind discount approval to sale/cart, server-side scope and single consumption | PARTIAL |
| R02 | P2 | Recover missed approval events and expose RPC failures | CODE |
| R03 | P1 | Isolate user settings and invalidate stale async writes/cache | PARTIAL |
| R04 | P1 | Bind journal status and reversal confirmation to selected entry | CODE |
| R05 | P1 | Make invoice metadata/payment saves explicitly independent or atomic | CODE |
| R06 | P1 | Financial RPC/column grants, ledger and refund integration verification | PARTIAL |
| R07 | P1 | Kitchen/barista explicit staff assignment and least privilege | BLOCKED |
| R08 | P2 | QR recovery enabled in both branches: cross-branch denial | PASS |
| R09 | P2 | QR check-in/recovery toggle policy | CODE |
| R10 | P2 | Business day versus browser calendar date | PARTIAL |
| R11 | P2 | Stable sales pagination under concurrent inserts | CODE |
| R12 | P2 | Historical station remap NULL guard and concurrency | PARTIAL |
| R13 | P1 | Independent cashier/captain/kitchen/barista/customer browser acceptance | BLOCKED |
| R14 | P1 | Backup/restore checkpoint and financial reconciliation | BLOCKED |
| R15 | P1 | Final head CI and review; merge only when gates satisfied | OPEN |

## Timeline
- 2026-11-24: Baseline static review of 56-file diff; four successful workflows on original head. Existing production reports are documentation, not newly verified live evidence. No production changes.

### Batch 1 — 2026-11-24 (code, not validated)
- R04: `aa98dc9` invalidates stale journal status reads, locks the reversal target and prevents duplicate in-flight submission. `665ed8b` source contract regression checks. Runtime race test and server authorization still required.
- R08: `9c3ba5b` verifies policy-off denial, then enables recovery on the foreign branch and checks QR_PIN_INVALID. Disposable DB execution pending.
- R12: `7091f4d` rejects NULL station mapping. Advisory lock still does not coordinate with ordinary order writers; historical script remains manual, no rerun authorized.
- R05: `e1a66c8` surfaces successful payment change / failed metadata separately and reloads invoice state. This is explicit partial-outcome handling, not transaction atomicity; runtime integration pending.
- R03: `eb3a6cd` invalidates pending saves across session switches, refreshes empty local cache, and requires successful settings read before auto-close scheduling. Remaining: audit all legacy/shared stock keys and IndexedDB purge, test session races and authorization.
- R01/R02: `1d8f0e5` checks current approval state after subscription, visibility return and polling, reports request errors, rejects changed subtotal at approval time. `cf1cd51` records status read in API contract; `7147897` source checks. This does NOT bind an approval to the full cart or consume it on the server; R01 remains PARTIAL. Verify RLS, expiry, disconnect, changed cart and final checkout with independent sessions.
- R09: `d71f257` explicitly documents that recovery preference is retained when check-in is disabled. No silent backend policy change.
- R06/R07/R10/R11/R13/R14 remain unresolved. No staging/production DB or Vercel changes performed. No merge.
- Last implementation head before this log update: `7147897129f790b148b097803ef84910ca136b7d`. CI for new head not yet verified. 

### Batch 2 — 2026-11-24
- Baseline head `47a78cf64268ed8bcdc45b787b11a7bb4881d89f`: [POS recovery](https://github.com/Premieros/.com/actions/runs/45417634383), [QR security](https://github.com/Premieros/.com/actions/runs/45417631830), [readiness](https://github.com/Premieros/.com/actions/runs/45417632669) succeeded. [Verify main](https://github.com/Premieros/.com/actions/runs/45417631978) verify job passed API contract, lint, typecheck, unit tests, build and readiness; DB and browser jobs were cancelled following newer commits. Do not count them as passed.
- R11: `9512462`, `d0d1d86`, `af62940`, `81faef8`: sales opt-in keyset uses created_at DESC, id DESC, preserves exact DB timestamps, validates cursor values and uses strict tuple boundaries for load-more/export. Other callers retain existing offset behavior. Unit tests added; verify real PostgREST multi-page results and concurrent insertion behavior before PASS. Keyset does not constitute a transaction snapshot.
- R10: `af62940` labels the existing device calendar filter explicitly; branch business-day policy and timezone implementation remain unresolved. No accounting-day semantics changed without verified requirements.
- Additional scope protection: `af62940` disables SalesPage pagination until permission and nonempty resolved branch scope exist.
- R06: `c510d1c` strengthens disposable CI SQL gate to enumerate all real sales columns (only notes/customer_id may be updated directly by authenticated) and verify anon destructive privileges. Financial RPCs, trigger inputs, payment/refund/ledger and stock reconciliation still need verification.
- R01/R03: no server-side approval/cart binding or comprehensive legacy stock cache fix this batch. GitHub code search returned no matches for relevant symbols; cannot safely infer authoritative RPC implementations or all legacy callers. Further source discovery and runtime tests needed.
- R07/R13/R14 remain BLOCKED (physical independent users, end-to-end evidence, backup/restore and reconciliation). No production mutation, deployment, or merge.
- Implementation head before this log: `c510d1c4616be16c3191526bc091cdafa45ca509`. Latest head CI pending; do not keep pushing during CI just to record transient states.

### Batch 3 — 2026-11-24
- Head `e1ddfd859ffe0335130e7e71aa1ba88c93da7955` verified: all four workflows passed ([POS recovery](https://github.com/Premieros/.com/actions/runs/45418792873), [readiness](https://github.com/Premieros/.com/actions/runs/45418792886), [QR security](https://github.com/Premieros/.com/actions/runs/45418792556), [Verify main](https://github.com/Premieros/.com/actions/runs/45418792680)). All three Verify main jobs (verify, db, browser-smoke) succeeded, including SQL privilege/recovery gates; 57 integration test files passed. These results do not cover the subsequent batch.
- R08 PASS (specific disposable DB regression): the DB job log explicitly records tests/integration/premier-customer-pin-branch-recovery.test.ts passing (1 test), including the added cross-branch enabled-policy denial. This is not production acceptance.
- R02/R01: `dfb675b` stops processing terminal or stale approval callbacks, deduplicates in-flight reads and request submissions, handles query failures. `a4f540b` adds behavioral component tests for missed Realtime approval, changed subtotal and late old-request events. R02 CODE, R01 PARTIAL (server-side cart binding/consumption remains unresolved).
- R03: `87d6ef4` + `accd7c7` replace the authenticated user's IndexedDB snapshot in a single transaction, including deleting removed branch rows; publish full localStorage snapshot synchronously. `4c8d11e` updates contract checks. Legacy shared negative-stock projection remains for compatibility; do not claim comprehensive cache isolation until consumers are audited. R03 PARTIAL.
- R11: `110cfe1` adds a disposable PostgreSQL temporary-table test for exact timestamp/UUID tie-breaks and insertion between pages. This simulates the insertion between reads and tests the SQL predicate, not real PostgREST or a parallel browser session. R11 CODE pending latest CI.
- R06: actual SQL column allowlist and anon privilege gates passed on batch 2 head. Broader financial transaction/ledger/approval checks remain PARTIAL.
- No production DB, deployment, station assignment, Vercel settings or main changes. R07/R13/R14 BLOCKED. Do not mark ready or merge without the remaining evidence.
- Last implementation head: `110cfe14a2bdfcbd448a46d6e6a25a6346986a59`; new head CI must finish before another round.

### Batch 4 — 2026-11-24
- Head `2b0d94bc67d88ddb440321c4408d98e267f148ed`: all four workflows succeeded ([readiness](https://github.com/Premieros/.com/actions/runs/45420959415), [QR security](https://github.com/Premieros/.com/actions/runs/45420959601), [POS recovery](https://github.com/Premieros/.com/actions/runs/45420959498), [Verify main](https://github.com/Premieros/.com/actions/runs/45420959518)). Verify main verify, db, browser-smoke all succeeded. Verified logs: 146 unit/component test files passed, including all three approval recovery component tests; 58 integration test files passed, including the keyset SQL insertion regression. These are evidence on batch 3 only.
- Source discovery recovered through GitHub recursive tree (1,837 entries, not truncated). The canonical approval pricing definitions include branch/requester, monetary amount, subtotal, expiry and row-locked single consumption. Existing NULL entity wildcard still permitted an approval for an unsaved sale to match a different persisted order. Original approval INSERT RLS checked requester and branch but not approval status; direct client write privileges must be removed.
- R01/R06: `b705151` adds a draft migration revoking direct approval writes and closing INSERT RLS; tightens normal/split settlement approval matching to exact order ID (including NULL-to-NULL for unlinked sales). Existing unbound approvals for persisted orders must be requested again; migration asserts the expected canonical SQL predicate before replacing it. `6483e44`, `71b5d9d`, `fb3457d` pass branch and order ID to the approval UI and use monetary amount for persisted-order settlement. `1796a98`, `50491c3`, `9c302ad` add contract, SQL privilege and behavioral order-switch regressions. Still PARTIAL: unlinked sales lack an immutable cart/operation binding; verify actual DB migration, normal/split/manual settlement, rollback/retry and full financial reconciliation. No production migration applied.
- R03: `3ad6003` reads offline negative-stock policy only from the originating cashier's scoped cache, captures user before preflight and verifies the same user at durable enqueue. Online stock policy still comes from server. `3402eed` adds regression contract. Legacy shared key consumers and other cross-session races still require audit. No change to actual branch stock settings.
- R02/R11: earlier behavioral and isolated SQL tests passed on batch 3, but latest changed approval UI and actual multi-page PostgREST verification still pending; retain CODE. R08 previously PASS. R07/R13/R14 remain BLOCKED.
- Implementation head before log update: `3402eeddcdffae282abaa0be729a9e194d1ace58`. Final CI pending; keep draft until evidence and remaining blockers are resolved. No Vercel or production changes.

### Batch 5 — 2026-11-24
- Head `62c424c868843ac9919a515555c0dd76d7b2b091`: [readiness](https://github.com/Premieros/.com/actions/runs/45423323919), [POS recovery](https://github.com/Premieros/.com/actions/runs/45423323549), [Verify main](https://github.com/Premieros/.com/actions/runs/45423323764), [QR security](https://github.com/Premieros/.com/actions/runs/45423322817) all completed successfully. All three Verify main jobs (verify, db, browser-smoke) passed, including approval privilege and exact order-scope migration gates from batch 4.
- R01/R06: `86ec77f`, `a80defe`, `1ba88a6` add draft migration `20261124170000_discount_approval_cart_and_policy_guard.sql`. Unlinked normal/split sales must match the approved financially relevant cart multiset (product, unit, quantity, line discount, bonus, modifiers); presentation fields do not determine authority. Malformed cart payloads return NULL and fail closed. Persisted orders still require the exact order ID from batch 4; server comparison of their full mutable contents is not yet enforced. Approval policy checks the actual discount amount instead of unrelated supplied total/amount; invalid amounts cannot be approved. Exact source anchors cause migration to fail if canonical definitions have drifted.
- R01/R02: `8d53764`, `ae87d34`, `76117f0`, `3147a5e`: approval UI sends the cart payload and rejects same-subtotal cart changes while pending. Approved percentage inputs become rounded monetary discounts before checkout to avoid percentage reapplication to a different base. Existing unlinked approvals without a cart must be re-requested.
- `c9792ea`: disposable PostgreSQL test for cart canonicalization and both settlement predicates. `326fa77`: disposable DB test for actual manager limit (20 discount with misleading total/amount of 1 must fail; 5 discount within limit must pass). These are new, not yet verified.
- R01 remains PARTIAL: separate identical carts are not uniquely bound to a checkout operation; persisted order revision, failed settlement consumption/rollback, manager display and end-to-end normal/split/manual approval consumption still require explicit tests. Do not mark this as full financial closure. R03/R06/R10/R12 remain PARTIAL; R07/R13/R14 require external acceptance evidence.
- Latest implementation head before this log: `1ba88a63238587b12c1fc552cacd2df602aeb868`. New CI pending. No production DB write, deployment, station remap or merge.
