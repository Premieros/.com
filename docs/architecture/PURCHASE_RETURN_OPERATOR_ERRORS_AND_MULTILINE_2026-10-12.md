# Purchase correction operator errors and mixed-line FIFO safety — 2026-10-12

## Scope

This follow-up is application/UI plus regression-test work only. Canonical repository: `Premieros/.com`; canonical Supabase project: `hvqlkapynjfjikqithvd`.

Production database logic was already deployed and verified in PR #91 (remote migration `20261012134314`), with file version alignment in PR #92. **This branch contains no new migrations, no RLS/grant changes, and no stock/journal data repair.**

## Operator-facing behavior

`src/features/trade/pages/PurchasesPage.tsx` previously surfaced internal JSON `TRANSACTION_FAILED` details directly for `update_purchase_invoice` and `process_purchase_return`.

The UI now recognizes two stable failure markers in either an RPC result or transport error:

- `PURCHASE_RETURN_INSUFFICIENT_STOCK`: explain that the requested FIFO quantity cannot be withdrawn; the correction/return was **not committed**; review stock history before retrying.
- `PURCHASE_RETURN_FIFO_FAILED`: explain that withdrawal failed; review warehouse, unit of measure and stock movements.
- Unrelated error codes go through the existing error-handling/guided-prerequisite flow.
- Existing success flow, modal dismissal, reload and audit logging run **only** after `result.success`. Failed purchase edits do not close the correction form, and failed returns do not close the details modal.

Messages are available in Arabic and English through the pure helper `src/features/trade/utils/purchaseReturnErrors.ts` and unit coverage at `tests/unit/purchaseReturnErrors.test.ts`.

## Integration test

Extend the disposable PostgreSQL transaction-based regression at `tests/integration/purchase-return-fifo-shortage-guard.test.ts` with a **mixed-line purchase return**: one raw-material item has available stock, while a finished product in the same purchase has zero stock. The full return must fail and leave the raw stock, all return quantities, document status and reversal-ledger count unchanged. Existing cases still check raw/product no stock, valid stock and partial FIFO withdrawal rollback.

Fixtures use `BEGIN`/`ROLLBACK` in local CI PostgreSQL. Do not execute them against production data.

## Follow-up

- Investigate the documented historical 0.3000 batch-vs-operational delta for the Smouha raw material separately, and maintain the existing `NO_AUTOMATIC_REPAIR` policy for classified legacy cases.
- Expand receipt-to-invoice correction integration in an isolated DB, especially partial receipts, warehouse scope, and idempotency.
- Do not introduce AI-controlled accounting or stock mutations before authorization, audit trail and deterministic validation.
