# Purchase receiving: operator error messages and uncertain network outcomes

**Change type:** frontend-only. **No database migration or production ledger change.**

Canonical repository: `Premieros/.com`. Canonical Supabase: `hvqlkapynjfjikqithvd`.

## Motivation

After PR #95 deployed the fail-closed `receive_purchase_order` SQL behavior (remote version `20261013060012`), the receiving screen was still displaying `TRANSACTION_FAILED` and internal `PURCHASE_RECEIPT_STOCK_FAILED` markers directly to operators. When the RPC promise rejected instead of resolving with `{error}`, the UI could remain locked with `saving=true` and did not explain uncertain network outcomes.

## Behavior

- `src/features/trade/utils/purchaseReceiptErrors.ts` maps stable rollback error markers to actionable Arabic and English guidance. It specifically recognizes `INCOMPATIBLE_PURCHASE_UNIT` and provides a general atomic receipt rollback explanation for other inventory helper failures.
- Existing warehouse, branch, over-receipt and order-status rejection hints remain available; missing/invalid quantity and wrong purchase item also have guidance.
- The receiving modal remains open when the RPC responds with `success:false` or an error. No success toast or artificial GRN is written.
- A rejected network promise is **not** treated as a proven failed database transaction. The message directs the operator to inspect saved GRNs before retrying because a response can be lost *after* the server commits. The save button is re-enabled via `finally`.
- Unrelated backend and network errors retain the previous fallback text rather than being misclassified as a confirmed rollback.
- New focused unit tests in `tests/unit/purchaseReceiptErrors.test.ts`.

## Verification and boundaries

Run typecheck, lint, unit tests, full disposable Postgres integration tests and browser-smoke against the exact head commit before merging.

No Supabase schema/function/RLS changes; no historical FIFO debt, batch, journal, or costing repair. The already documented 0.3000 historical discrepancy remains for read-only provenance review.
