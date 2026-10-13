# Offline warehouse pinning and negative-stock gate — 2026-10-13

**Status:** App-only proposal. No production Supabase DDL/DML or historical inventory/journal repair.

Canonical repo `Premieros/.com`; canonical Supabase `hvqlkapynjfjikqithvd`.

## Proven existing risk

The explicit offline checkout passed `p_warehouse_id: null`, and the replay engine later chose the linked order's current warehouse or the branch's then-default active warehouse. Such post-capture reassignment could apply a financial sale to a warehouse different from its original operational intent. New local sale movements also omitted the `warehouseId`, preventing reliable warehouse-level reconciliation. Prior negative-stock preflight used a **branch aggregate** even for sales replaying against one warehouse.

## Changes

- During online POS use, `usePosOrder` prewarms the current branch default or linked order's warehouse using `fetchBranchWarehouseId`; that function checks the warehouse belongs to the requested branch and is active. Linked orders **never** silently fall back to the branch default.
- Only an online-verified assignment is cached in IndexedDB `system_settings`, scoped by **branch + order ID**, with a 24-hour freshness limit. It persists only after the local IndexedDB write transaction completes.
- Explicitly offline POS checkout loads that exact cached assignment, refusing the sale if absent, stale, inaccessible or from another order/branch. `queueOfflineSale` and `OfflineContext.queueSaleForOffline` also reject missing warehouse IDs.
- Offline sale movements include the pinned `warehouseId`, allowing accurate per-warehouse deductions and safe reconciliation when the original sale is confirmed.
- Replay never replaces a missing `p_warehouse_id` on a legacy outbox row with a newly chosen warehouse. The row stays held for review, with existing same-cashier attribution and idempotency preserved.
- When **negative stock is disabled**, explicitly offline checkout uses `getWarehouseAvailableStock`, never the branch total. If the verified per-product, per-warehouse stock snapshot is missing/stale/unscoped, fail closed with `OFFLINE_WAREHOUSE_STOCK_UNVERIFIED`. The existing **online** preflight/server flows and negative-enabled behavior remain unchanged.
- Eight focused unit tests cover branch/order isolation, stale bindings, missing bindings, cache write requirements and unpinned replay.

## Production reality — significant constraint

On the read-only production inspection of 2026-10-13, both `public.inventory` and `public.inventory_batches` contained **zero rows**, and there were **zero products typed `ready`**; the active warehouse count was four and raw material branch balances had 525 rows. Therefore, no trustworthy per-warehouse ready-product stock quantity can be inferred from those tables today, and this change does **not** invent a zero or repurpose raw FIFO as ready-product stock.

As a consequence, branches with negative stock **disabled** may see offline sales blocked with an unverified-warehouse-stock message until genuine inventory-specific source rows/controlled snapshots are available. This is a deliberate correctness boundary; it must be reviewed with operations, especially for recipe/restaurant products whose stock is deducted at kitchen send rather than sale. Negative-stock-enabled branches still require the pinned warehouse but do not use this quantity-based preflight.

## Verification / next work

- Exact-head verify, all unit tests, disposable PostgreSQL integration and browser smoke before merge.
- Prove warehouse snapshot source/hydration coverage for restaurant recipes without treating raw-material balances as product inventory.
- Add real-browser cross-tab restart tests for warehouse binding and queued sales, and a permission-scoped test with two active warehouses and differing ready-stock availability.
- Investigate legacy queued sales without a warehouse only using original documents/operator evidence; never silently assign the current default.
- Historical FIFO/COGS discrepancy issues #100 and multi-warehouse hardening #103 remain separate; no AI or automatic financial adjustments.
