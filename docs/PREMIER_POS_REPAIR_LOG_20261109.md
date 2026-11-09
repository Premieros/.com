# Premier OS — POS and system repair register (2026-11-09)

**Production safety:** audit uses read-only source / read-only SQL evidence. No customer sale was attempted; no production SQL, schema, accounts, inventory or payment records were modified. This register covers the **web POS on main**, not the separate Windows development work.

## Evidence-driven issue queue

| ID | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| WEBPOS-01 | P0 | After the online RPC reports a committed sale, failure of an IndexedDB synchronized-stock projection was caught as a *payment failure*. This affects normal and manager-approved manual payments. | `src/features/pos/services/payment.ts` former post-RPC `recordLocalMovement` loops and outer `catch`. | **FIXED IN THIS DRAFT PR**; awaiting CI and review |
| WEBPOS-02 | P0 | Kitchen-unsent settlement/print safety is UI-only in current Premier server definitions. `_prepare_kitchen_sale_settlement` and `enqueue_cloud_open_order_print` lacked an `ORDER_NOT_FULLY_SENT` check; print enqueue also lacks order row lock. | Read-only inspection of production `pg_get_functiondef` on 2026-11-09. | **OPEN — NEEDS isolated SQL integration + explicit production approval** |
| WEBPOS-03 | P1 | React button guard blocks paying open orders with unsent items, while usePosOrder still includes a “settle sent portion, keep unsent additions” flow. Policy is inconsistent. | `PosWorkspacePage.tsx` and `usePosOrder.ts`. | **OPEN — decide full-send policy versus split/partial settlement**, then tests |
| WEBPOS-04 | P1 | `Verify main` cannot replay the historical migration on a clean CI DB (missing function terminator before REVOKE); a separate draft CI PR exists but full tests are not green. | GitHub Actions Verify main run 42519130653. | **OPEN — keep isolated from POS financial behavior** |
| WEBPOS-05 | P1 | Some historical period-cost reports and secondary-branch recipe access are not equivalent to the reference implementation. Missing named objects are not proof of every report being broken. | Read-only `pg_policies`/`pg_proc` inspection. | **OPEN — design role/branch negative tests before RLS change** |
| WEBPOS-06 | P1 | Offline IndexedDB queue persists a pending sale before separately writing stock-cache movements. An IndexedDB error may lead to an error while the queued sale remains; replay behavior needs dedicated regression tests. | `queueOfflineSale` in `payment.ts`, `stockProjection.ts`. | **OPEN — investigate independently; do not change financial outbox semantics blindly** |
| WEBPOS-07 | P2 | Full web POS hardware printing and cross-device races not exercised in this audit. | Absence of device evidence in this review. | **NEEDS TEST** |

## Fix delivered in this PR — WEBPOS-01

- New helper `src/features/pos/services/saleConfirmationCache.ts` records *synced* server-confirmed stock movements as **best-effort** local projections, with stable per-sale/per-line IDs. It catches individual IndexedDB failures and a diagnostic reporting failure.
- `src/features/pos/services/payment.ts` uses the helper in both normal idempotent RPC settlement and approved manual payment settlement **only after an authoritative `success`**. Payment success and receipt flow are now independent of local cache availability.
- `tests/unit/posPostcommitCache.test.ts` tests stable retry identifiers, quota/write errors, missing product IDs, and invoice fallback. This does not prove browser IndexedDB device behavior.
- No SQL migration or entitlement/RLS modification. Remote settlement rejection remains authoritative. The local-stock projection may be stale until refreshed/reconciled; that limitation must not be hidden from stock reports.

## Release gates

Run repository identity checks, lint, `typecheck:all`, tests for both POS and cash settlement, and app build on the exact head SHA. The full `Verify main` DB stage may be blocked by the previously documented historical migration; report this separately. **Do not merge or deploy automatically**: main push triggers a GitHub Pages workflow. Do not claim WEBPOS-02 or remaining items fixed by this frontend-only PR.

## Next tasks

1. Confirm WEBPOS-01 integrated tests against mocked sale RPC success + IndexedDB failure.
2. Isolated database simulation for WEBPOS-02, including concurrent kitchen send/settle and print queue; explicit approval before production migration.
3. Decide partial-settlement policy for WEBPOS-03.
4. Independently verify and repair WEBPOS-06 without allowing duplicate offline sale enqueue.
