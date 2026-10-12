# Purchase-return FIFO shortage: proposed fail-closed guard

**Status: DRAFT FOR APPROVAL — NOT DEPLOYED TO PRODUCTION.**

## Confirmed mechanism (read-only investigation 2026-10-12)
- `process_purchase_return` calls `_raw_remove_fifo` and `_product_inv_remove_fifo`, then previously checked only `success`.
- Both FIFO helpers can return `success=true` with a **positive `shortage`** when stock is insufficient; raw removal can return `removed=0`, `shortage>0`.
- `process_purchase_return` then marks the purchase lines/header returned, even though stock was not fully removed. `update_purchase_invoice` first calls that return workflow and then posts a corrected replacement.
- In one September historical purchase correction, an old revision and a replacement both led to receipt/settlement entries for the same amount. The operational raw-material balance exceeded remaining FIFO debt by 0.3000 quantity; a replacement settlement dated later followed the revision. **This is a documented exception, not permission to edit historical accounting/FIFO data.**
- A branch-level quantity/debt check shows two negative raw-material cases where operational negative quantity exceeds open FIFO debt. Other historical exceptions remain manual-review only.

## Proposed minimal code change
- Preserve the original `process_purchase_return` function signature, grants, authorization and posting.
- After each FIFO helper call, if `success` is false, raise a controlled exception rather than returning a JSON error **after earlier lines may already have mutated**.
- If `shortage > 0`, raise `PURCHASE_RETURN_INSUFFICIENT_STOCK`, allowing the existing PL/pgSQL exception block to roll back all changes from the attempted purchase return, and return `success=false`.
- Do **not** set `p_allow_negative=true` just to bypass the issue: return/correction FIFO accounting must be separately designed and reconciled.
- The regression test creates an insufficient-stock raw and product purchase in a disposable PostgreSQL fixture, asserts rejection and unchanged purchase status/returned quantities/ledger, then rolls back.

## Rollout gates
1. Explicit owner approval before applying any function change to Supabase production or merging a runnable migration into main.
2. All code/typecheck, DB/integration, and Playwright CI green on the exact PR head.
3. Confirm legitimate purchase returns that have sufficient stock still work under tests, including multi-line partial returns and receipt-based procurement.
4. Inspect behavior of actual completed purchases that have already been sold or consumed; changing legacy edit behavior to refuse correction needs an operator-facing error in the UI.
5. Independent rollback/recovery path for historical FIFO debt, valuation and COGS. Do **not** reverse or reinsert historical settlement/batch rows automatically.
6. Once approved, verify forward behavior with disposable rollback-only DB fixtures, and record precise deployment version.

The migration in this draft PR is **staged proposal code**, not an authorization to apply it or a claim that the existing 0.3000 historical discrepancy is repaired.
