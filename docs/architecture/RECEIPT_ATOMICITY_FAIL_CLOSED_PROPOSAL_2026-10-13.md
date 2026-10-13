# Procurement receipt atomicity guard — deployed and verified

**STATUS: APPROVED, DEPLOYED AND VERIFIED — 2026-10-13.**

Canonical repository: `Premieros/.com`.
Canonical Supabase: `hvqlkapynjfjikqithvd`.

## Observed risk (read-only production function inspection, 2026-10-13)

`public.receive_purchase_order(uuid,jsonb)` writes a `purchase_receipts` record **before** processing each requested line.

Before the fix, in the line loop, when `_product_inv_add`, `_normalize_raw_purchase_uom` or `_raw_add` returned a JSON failure, the code had three `RETURN v_res` exits. A normal PL/pgSQL `RETURN` is not an error; consequently, GRN, warehouse stock, `received_quantity` and outbox writes performed earlier in the block may persist even though the RPC returns `success=false`.

This was verified as a code-path risk, not as a claim that any live order suffered this error. Production currently has **zero** GRNs, and read-only integrity checks previously returned zero hard violations.

## Production fix (deployed)

`supabase/migrations/20261013060012_receipt_atomicity_fail_closed.sql` preserves the existing function definition, including name, arguments, `SECURITY DEFINER`, permission checks, journal posting and inventory math, but converts its **three post-write `RETURN v_res` exits** into a controlled `RAISE EXCEPTION` carrying `PURCHASE_RECEIPT_STOCK_FAILED: <helper error>`.

Because the function wraps its mutable work in an inner `BEGIN ... EXCEPTION WHEN OTHERS ... END` block, an exception rolls back that subtransaction before returning the normal JSON `TRANSACTION_FAILED` failure response. This protects stock, GRN, operational receipt counters, journals and receipt event outbox as a unit.

The exact original function is captured in `scripts/rollback/20261013060000_restore_receipt_rpc.sql`, **operator-only** and unsafe to reapply automatically because it restores the old behavior.

## Disposable CI regression

`tests/integration/procurement-receipt-real-rpc-lifecycle.test.ts` already performs real creation, approval, partial/final receiving, balancing and over-receipt/replay checks.

The verified regression includes *fault injection* on a second purchase order:
1. Create and approve a product+raw-material PO with valid units.
2. In isolated CI, change the raw purchase line unit to incompatible `kg` while its stock unit is `u` — a simulated historical/corrupted PO line.
3. Call receiving with the product item **first**, then raw material. Product addition should be rolled back when the raw unit normalization rejects `INCOMPATIBLE_PURCHASE_UNIT`.
4. Assert zero GRNs, zero received quantity, unchanged product/raw inventory, zero journal/outbox events, and PO still approved.
5. Restore the unit, retry receipt and verify one GRN, one journal, correct stock additions.
6. Roll back the entire fixture with `ROLLBACK`, with no production data modifications.

## Release record and remaining limits

- Owner explicitly approved production deployment after the PR #95 approval request on 2026-10-13. PR [#95](https://github.com/Premieros/.com/pull/95) was merged by squash to `main` at commit `d9170dcf960544b2dc512c2921b85b68796d1694`.
- Exact-head PR checks `verify`, `db` and `browser-smoke` were all `success`. The raw-product mixed receipt failure and successful retry passed in disposable PostgreSQL CI.
- Prior to applying, the staged function was compared byte-for-byte against the original production function with **only the three intended post-write exit replacements**. Original function body matched the operator-only rollback file exactly.
- Applied through canonical Supabase's migration API to project `hvqlkapynjfjikqithvd` as **remote version `20261013060012`** with migration name `receipt_atomicity_fail_closed`.
- Post-deploy check verified three `PURCHASE_RECEIPT_STOCK_FAILED` guards and no remaining `RETURN v_res;` exits; owner remains `postgres`, function remains `SECURITY DEFINER`, `search_path=public, pg_temp`, with `anon` denied and `authenticated`/`service_role` execute privileges preserved.
- Post-deploy read-only cross-domain audit: 16/16 blocking checks have zero violations. The production data counts were unchanged at acceptance: 175 purchases, 533 lines, 0 GRNs, 0 GRN lines, 21,779 inventory ledger entries, 8,718 FIFO debts, 2,247 journal headers and 7,259 journal lines. Inventory review cases remain 8, and nine batch-versus-operational quantity differences remain review-only.
- Repository migration file was aligned to the **actual remote migration timestamp `20261013060012`** in a separate ops pull request; its SQL body was renamed without change.
- Never rewrite past FIFO debts, purchase receipts, journal entries or valuation based solely on this test.

The test does **not** prove real-event delivery to an external provider or end-to-end AI actions.

## Operational caution

The production function now fails atomically on these three helper JSON failure paths. No synthetic purchase was created in production to test the error directly: runtime behavior was validated in isolated CI and deployment was checked with read-only production SQL. The old function rollback SQL must only be used during incident response; it would reintroduce the original fail-open defect. Operator-facing receipt error messages can be improved in the application without further production schema changes.
