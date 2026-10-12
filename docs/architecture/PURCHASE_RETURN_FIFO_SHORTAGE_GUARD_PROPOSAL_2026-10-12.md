# Purchase-return FIFO shortage: fail-closed guard — deployed

**Status: DEPLOYED AND VERIFIED — 2026-10-12.**

## Production rollout evidence

- Repository PR [#91](https://github.com/Premieros/.com/pull/91) merged into `main` at commit `1482492f9d89e8fb33f1645fcbdc6ddcf0acb45f`.
- CI on the exact proposed head `df9b3cd87b6bcc066cb19b199aee1128f0310ff9`: `verify`, `db`, and `browser-smoke` succeeded. The regression covers no-stock raw and finished-product returns, an adequate-stock valid return, and an atomic rollback after partial FIFO removal.
- Supabase project **`hvqlkapynjfjikqithvd`** applied migration as remote version `20261012134314` with migration name `purchase_return_fifo_shortage_guard`.
- Repository migration file is aligned to **`supabase/migrations/20261012134314_purchase_return_fifo_shortage_guard.sql`**. The earlier proposal filename `20261012130000_...` was renamed to prevent replay on future migration pushes; SQL body is unchanged.
- Original function definition is preserved as operator-only rollback SQL in `scripts/rollback/20261012130000_restore_purchase_return.sql`. Restoring this function would re-enable the earlier shortage bug and requires separate incident review.
- Post-deployment verification: existing function owner `postgres`, `SECURITY DEFINER`, `search_path=public, pg_temp`, and execute privileges remained unchanged (`anon=false`, `authenticated=true`, `service_role=true`). Both `PURCHASE_RETURN_INSUFFICIENT_STOCK` and `PURCHASE_RETURN_FIFO_FAILED` guards appear twice (raw + product).
- Read-only post-deployment audit: 16/16 hard domain checks returned zero violations; existing 8 manually classified inventory review cases and the extra 0.3000 historical discrepancy were not modified. Operational counts remained 175 purchases, 533 purchase items, 21,779 stock ledger entries, 8,718 FIFO debts, 2,247 journal headers and 7,259 journal lines at the acceptance snapshot.
- Security advisors reported the same categories as prior audit (34 INFO and 272 WARN); no RLS or grant changes were introduced.

**No production test purchase/return was fabricated.** Behavior regression tests ran on an isolated CI database; read-only production verification checked installed code and invariants.

## Confirmed mechanism (read-only investigation 2026-10-12)
- `process_purchase_return` calls `_raw_remove_fifo` and `_product_inv_remove_fifo`, then previously checked only `success`.
- Both FIFO helpers can return `success=true` with a **positive `shortage`** when stock is insufficient; raw removal can return `removed=0`, `shortage>0`.
- `process_purchase_return` then marks the purchase lines/header returned, even though stock was not fully removed. `update_purchase_invoice` first calls that return workflow and then posts a corrected replacement.
- In one September historical purchase correction, an old revision and a replacement both led to receipt/settlement entries for the same amount. The operational raw-material balance exceeded remaining FIFO debt by 0.3000 quantity; a replacement settlement dated later followed the revision. **This is a documented exception, not permission to edit historical accounting/FIFO data.**
- A branch-level quantity/debt check shows two negative raw-material cases where operational negative quantity exceeds open FIFO debt. Other historical exceptions remain manual-review only.

## Implemented code change
- Preserve the original `process_purchase_return` function signature, grants, authorization and posting.
- After each FIFO helper call, if `success` is false, raise a controlled exception rather than returning a JSON error **after earlier lines may already have mutated**.
- If `shortage > 0`, raise `PURCHASE_RETURN_INSUFFICIENT_STOCK`, allowing the existing PL/pgSQL exception block to roll back all changes from the attempted purchase return, and return `success=false`.
- Do **not** set `p_allow_negative=true` just to bypass the issue: return/correction FIFO accounting must be separately designed and reconciled.
- The regression test creates an insufficient-stock raw and product purchase in a disposable PostgreSQL fixture, asserts rejection and unchanged purchase status/returned quantities/ledger, then rolls back.

## Acceptance gates and remaining follow-up
1. Owner instructed to continue after the explicit production-fix approval question; migration has now been applied.
2. Full code/typecheck, database/integration and Playwright checks succeeded on the exact merged PR head.
3. Adequate-stock return and atomic partial-stock rollback tests passed; add broader real-world multi-line and receipt-based procurement coverage as a follow-up.
4. Inspect behavior of actual completed purchases that have already been sold or consumed; changing legacy edit behavior to refuse correction needs an operator-facing error in the UI.
5. Independent rollback/recovery path for historical FIFO debt, valuation and COGS. Do **not** reverse or reinsert historical settlement/batch rows automatically.
6. Post-deployment database inspection and cross-domain read-only monitoring passed; retain operational monitoring for any new failed returns.

The production guard blocks future fail-open stock returns, but **does not automatically repair the historical 0.3000 discrepancy or related valuation/COGS evidence**.
