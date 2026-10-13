# Offline warehouse-specific inventory availability — bounded first step

## Confirmed problem

At main commit `2de3474a`, the offline stock methods `getEffectiveAvailableStock(productId,branchId)` and `getBranchStockMap(branchId)` use branch totals. A sale may later replay with a pinned `p_warehouse_id` and remove inventory from only one warehouse. Branch stock is **not proof** of availability in the sale's warehouse.

The current explicitly-offline POS checkout sometimes queues `p_warehouse_id=null`; replay resolves an order warehouse or branch default later. That origin-warehouse ambiguity cannot be resolved from the branch stock map.

## This change

- Add **warehouse-specific** `InventoryRepository.getWarehouseAvailableStock(productId,branchId,warehouseId)`, using a strict read of cached stock snapshots, local movements and pending sales.
- Add `updateWarehouseStockSnapshot(branchId,warehouseId,productId,quantity)`, **only for callers who already have an authoritative server-sourced warehouse quantity**, stored alongside (not overwriting) legacy branch-wide stock balances.
- Reject absent/stale (>24 hours), invalid or future-dated snapshots as `unknown`, **not 0** and never a branch fallback. An unscoped legacy stock movement or sale for the requested product also returns `unknown`.
- Pending sale reservations and movements are reconciled by branch, warehouse and product; locally written sale movements are deducted once, with missing crash-partial deductions taken from the outbox.
- Unit tests cover a two-warehouse branch where product is absent in the first and plentiful in the second, missing/old cached data, legacy no-warehouse records, partial writes, and timestamp errors.

## What this DOES NOT yet do

This is the **safe foundation**, not a claim that every offline POS payment enforces warehouse availability today. The existing branch-wide cache API stays unchanged for legacy POS screens, and online checkout still uses its existing server controls. The new warehouse-specific method is intentionally **not yet wired into payment** because there is no verified, continuous, authoritative *warehouse-level* cache hydration in the existing offline workflow. Integrating it without hydration would block most explicitly offline sales or misrepresent unknown stock.

**Next gate for issue #103:** hydrate verified per-warehouse quantities while connected, persist the origin warehouse (not a later guessed default), then enforce `status='known'` and enough stock when negative stock is disabled; separately test two-warehouse checkout in an isolated real-browser profile. Never convert branch-level quantities into warehouse snapshots.

## Safety boundaries

No production Supabase schema/SQL changes; no historical stock, FIFO or accounting rewrites; no synthetic production sales; no self-authorizing AI actions. Existing review issue #100 remains independent.
