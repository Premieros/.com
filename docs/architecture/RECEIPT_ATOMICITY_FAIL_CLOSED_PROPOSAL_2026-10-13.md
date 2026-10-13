# Proposed atomicity guard for procurement receiving

**STATUS: DRAFT / PRODUCTION DATABASE FUNCTION CHANGE NOT AUTHORIZED.**

Canonical repository: `Premieros/.com`.
Canonical Supabase: `hvqlkapynjfjikqithvd`.

## Observed risk (read-only production function inspection, 2026-10-13)

`public.receive_purchase_order(uuid,jsonb)` writes a `purchase_receipts` record **before** processing each requested line.

In the line loop, when `_product_inv_add`, `_normalize_raw_purchase_uom` or `_raw_add` returns a JSON failure, current code has three `RETURN v_res` exits. A normal PL/pgSQL `RETURN` is not an error; consequently, GRN, warehouse stock, `received_quantity` and outbox writes performed earlier in the block may persist even though the RPC returns `success=false`.

This was verified as a code-path risk, not as a claim that any live order suffered this error. Production currently has **zero** GRNs, and read-only integrity checks previously returned zero hard violations.

## Staged fix (NOT DEPLOYED)

`supabase/migrations/20261013060000_receipt_atomicity_fail_closed_proposal.sql` preserves the existing function definition, including name, arguments, `SECURITY DEFINER`, permission checks, journal posting and inventory math, but converts its **three post-write `RETURN v_res` exits** into a controlled `RAISE EXCEPTION` carrying `PURCHASE_RECEIPT_STOCK_FAILED: <helper error>`.

Because the function wraps its mutable work in an inner `BEGIN ... EXCEPTION WHEN OTHERS ... END` block, an exception rolls back that subtransaction before returning the normal JSON `TRANSACTION_FAILED` failure response. This protects stock, GRN, operational receipt counters, journals and receipt event outbox as a unit.

The exact original function is captured in `scripts/rollback/20261013060000_restore_receipt_rpc.sql`, **operator-only** and unsafe to reapply automatically because it restores the old behavior.

## Disposable CI regression

`tests/integration/procurement-receipt-real-rpc-lifecycle.test.ts` already performs real creation, approval, partial/final receiving, balancing and over-receipt/replay checks.

The proposed regression appends a *fault injection* on a second purchase order:
1. Create and approve a product+raw-material PO with valid units.
2. In isolated CI, change the raw purchase line unit to incompatible `kg` while its stock unit is `u` — a simulated historical/corrupted PO line.
3. Call receiving with the product item **first**, then raw material. Product addition should be rolled back when the raw unit normalization rejects `INCOMPATIBLE_PURCHASE_UNIT`.
4. Assert zero GRNs, zero received quantity, unchanged product/raw inventory, zero journal/outbox events, and PO still approved.
5. Restore the unit, retry receipt and verify one GRN, one journal, correct stock additions.
6. Roll back the entire fixture with `ROLLBACK`, with no production data modifications.

## Release gates

- Keep this PR **draft**. Do not merge or apply to production until the user **explicitly authorizes the `receive_purchase_order` function change**.
- CI verify, database integration and browser-smoke must pass on the exact final head.
- Before approval, confirm original production `pg_get_functiondef` matches the saved rollback script; preserve ownership and grants.
- When approved, deploy the corresponding version to canonical Supabase, record the real remote version, verify function guards and execute the existing **read-only** cross-domain inventory/accounting/procurement audit.
- Never rewrite past FIFO debts, purchase receipts, journal entries or valuation based solely on this test.

The test does **not** prove real-event delivery to an external provider or end-to-end AI actions.
