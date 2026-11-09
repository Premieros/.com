# Premier stock valuation and historical cost integrity — 2026-11-09

## Verified cost contracts

- `public.get_stock_valuation` (20261027004000) uses `v_stock_balances_unified` quantities times `v_stock_current_costs` (for products, current catalog `products.cost_price`). It is **a current operational display**, not historical inventory batch cost, COGS or a posted journal trial balance.
- `public._deduct_ready_product_stock_policy` (20261109094032) records actual consumed batch unit cost for positive batches into inventory ledger/stock transactions and returned total sale cost; zero-cost legacy batches use catalog fallback. Historical ledger entries must not be repriced to match current catalog price.
- Raw costs follow published price events in `v_stock_current_costs`. Raw and manufactured costs are NOT interchangeable with product batch consumption cost.
- Production read-only audit on 2026-11-09 returned **zero current product batch positions and zero unified product stock positions**. Thus it cannot establish real-world accounting consistency or demonstrate a historical valuation discrepancy; no data was changed.

## Frontend safety repair

`StockValuationPage` used to:
- retain rows and old summary/export values after RPC or warehouse-query failure;
- keep a branch selector separate from the canonical active branch, potentially showing the wrong branch's valuation following a context change;
- treat a missing RPC payload as an empty array, which presents a misleading zero total.

Now:
- every request has an explicit accessible active branch ID; never call a SECURITY DEFINER financial RPC with a null (unbounded) branch;
- warehouse options and row-level validation are pinned to the same branch;
- stale rows cannot display or export during loading, failure, or branch/warehouse changes;
- missing/invalid or out-of-scope data fails closed with a localized error;
- the page labels cost as **current display cost** to prevent confusing it with historical sale COGS or posted journal values.

## Next gates (separate work)

1. **Added first disposable Postgres fixture:** one branch/product/warehouse with actual batch cost different from catalog cost, consumed sale quantity, ledger/stock-transaction and current valuation assertions in `tests/integration/premier-batch-cogs-vs-current-valuation.test.ts`. A *separate* two-branch/two-warehouse, returns and posted journal integration scenario is still required before certifying full accounting reconciliation.
2. Review `get_stock_valuation` server-side authorization for direct RPC callers, including permission scope and cross-organization branch access. **UI filtering is not a replacement for RLS/RPC authorization.** No SECURITY DEFINER function replaced in this change.
3. Add an explicit **historical/as-of inventory valuation** only with an authoritative as-of contract and snapshot policy; never reinterpret the present-value report as a historical close.
4. Fiscal period close/export must use frozen source journal evidence, not live mutable product prices.

## Boundaries

Only `Premieros/.com` feature branch changed. Johna's is read-only. No production schema writes, costing updates, journal modifications, or Vercel deployment.
