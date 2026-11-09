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
| WEBPOS-06 | P1 | Offline IndexedDB queue persists a pending sale before separately writing stock-cache movements. An IndexedDB error may lead to an error while the queued sale remains; replay behavior needs dedicated regression tests. | `queueOfflineSale` in `payment.ts`, `stockProjection.ts`. | **FIXED for post-enqueue projection failure in THIS DRAFT PR**. Pending-sale idempotency across repeated user attempts still needs separate coverage |
| WEBPOS-07 | P2 | Full web POS hardware printing and cross-device races not exercised in this audit. | Absence of device evidence in this review. | **NEEDS TEST** |

## Fix delivered in this PR — WEBPOS-01

- New helper `src/features/pos/services/saleConfirmationCache.ts` records *synced* server-confirmed stock movements as **best-effort** local projections, with stable per-sale/per-line IDs. It catches individual IndexedDB failures and a diagnostic reporting failure.
- `src/features/pos/services/payment.ts` uses the helper in both normal idempotent RPC settlement and approved manual payment settlement **only after an authoritative `success`**. Payment success and receipt flow are now independent of local cache availability.
- `tests/unit/posPostcommitCache.test.ts` tests stable retry identifiers, quota/write errors, missing product IDs, and invoice fallback. This does not prove browser IndexedDB device behavior.
- No SQL migration or entitlement/RLS modification. Remote settlement rejection remains authoritative. The local-stock projection may be stale until refreshed/reconciled; that limitation must not be hidden from stock reports.

## Additional fix — WEBPOS-06

After `enqueueOfflineSale` has committed a pending sale to IndexedDB, failure to record a derived stock movement previously could cause `queueOfflineSale` to throw, making the UI think the **durable pending sale** had failed and inviting a duplicate capture. The local stock projection already explicitly accounts for missing queued-sale movement rows (per product and branch) in `stockProjection.ts`.

`queueOfflineSale` now stores movement rows best-effort after the authoritative outbox write. Each movement uses a deterministic id scoped to the durable queued-sale id and line index. A failed derived write reports a warning but does not convert the pending financial capture into a failure. Unit coverage asserts exactly one outbox enqueue after simulated IndexedDB movement failure. This does **not** solve user-triggered duplicate operations with new operation keys or prove arbitrary browser crash interleavings.

## Release gates

Run repository identity checks, lint, `typecheck:all`, tests for both POS and cash settlement, and app build on the exact head SHA. The full `Verify main` DB stage may be blocked by the previously documented historical migration; report this separately. **Do not merge or deploy automatically**: main push triggers a GitHub Pages workflow. Do not claim WEBPOS-02 or remaining items fixed by this frontend-only PR.

## Next tasks

1. Confirm WEBPOS-01 and WEBPOS-06 integrated tests against mocked sale RPC/outbox success + IndexedDB projection failure.
2. Isolated database simulation for WEBPOS-02, including concurrent kitchen send/settle and print queue; explicit approval before production migration.
3. Decide partial-settlement policy for WEBPOS-03.
4. Add durable offline sale idempotency keyed by originating client-operation key, in a separate isolated proposal after storage transaction review.

## 2026-11-09 independent review of PR #141

**Reviewed against main and exact PR source:**
- Online normal and manual-payment routes call the best-effort helper **only after** server-confirmed success. Server rejection and ambiguous network failure stay errors; no offline fallback is added to online payment.
- `dbPut` in `LocalDatabase.ts` commits its transaction before resolving and uses the movement `id` as the IndexedDB object key; stable confirmed-sale ids can overwrite an earlier projected replay rather than appending random duplicates.
- Offline `enqueueOfflineSale` waits for its `sales_queue` transaction to complete before recording derived `local_stock_movements`; `stockProjection.ts` computes unrecorded queued-sale deductions per branch, reference and product. This justifies treating *post-enqueue projection* errors as warnings, but **does not** guarantee no duplicate sales if the caller starts a new separate operation with a different key.
- A residual failure path was fixed: if `console.warn` itself throws after successful offline queue persistence, payment completion must still remain pending/successful. Added targeted test.
- The shared source of truth for confirmed online sales remains Supabase; failure to write an IndexedDB projection may leave local history temporarily stale. A durable repair/reconciliation notification for missing projections is not implemented here.
- **No approval to merge** until post-review HEAD unit/typecheck/build results are checked. Existing `Verify main` database-migration bootstrap failure is unrelated to this PR and must not be misreported as success.

## 2026-11-09 continuation — durable offline operation-key de-duplication

- New `src/core/offline/offlineSaleIdempotency.ts` provides a pure, testable decision guard using the stored financial operation key, originating user, branch and canonicalized financial payload. An invoice number generated afresh on a retry does **not** change the financial payload identity; changing amount, items, user or branch with the same key is rejected, not silently reused.
- `enqueueOfflineSaleIdempotent` in `src/core/offline/offlineStorage.ts` executes its lookup and conditional `add` in **one** IndexedDB `sales_queue` readwrite transaction. Concurrent tabs are serialized by the store transaction. Replayed rows in any status are returned without insertion.
- `queueOfflineSale` now leaves stock projections untouched on an existing operation-key replay. `usePosOrder.ts` holds a stable operation key for retries in the same live checkout attempt until a durable pending sale is confirmed.
- `tests/unit/offlineSaleIdempotency.test.ts` checks amount/items/user/branch conflict, duplicate historical rows, status replay, invoice-number renewal and missing scope. `tests/unit/posCommittedSaleResult.test.ts` checks that replay doesn't rewrite stock, and conflict is fail-closed.
- **Limitations:** cannot guarantee de-duplication across a completely new checkout after UI state is lost *and* the old outbox row has been deleted, since the server's authoritative operation-key uniqueness must still enforce it. Stock preflight may reject a repeated request before it reaches the outbox de-duplication when cached available stock has dropped. Full browser IndexedDB multi-tab tests, close/reopen crash tests, and unverified `main` SQL migrations remain release gates.
- This change **does not alter Supabase production data** or SQL policies and remains on draft PR #141 until full review.
