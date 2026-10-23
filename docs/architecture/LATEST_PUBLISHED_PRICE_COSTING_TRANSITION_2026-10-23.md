# Transition from FIFO to latest published price — implementation status (2026-10-23)

Target only: `Premieros/.com` / Supabase `hvqlkapynjfjikqithvd`.

## Business policy
The user requires **price history / latest published price** rather than FIFO as the costing method.

## Applied to DB
Migration `published_price_only_raw_recipe_cost_context` replaced `public._raw_cost_context_for_costing(uuid, uuid)`. This helper now takes the latest non-future positive event in `raw_material_price_events`, ordered by `priced_at`, ties by ID; if absent it uses `raw_materials.default_cost`. It is branch scoped and returns published_price/catalog_default provenance. The existing `_raw_cost_for_costing` delegates to this helper. Verified sample calls returned catalog defaults.

**Critical**: `raw_material_price_events` currently contains 0 rows. Therefore all current prices are catalog fallbacks; some defaults are 0 and require remediation. Do not interpret 0 as a valid published material price. This change affects this helper, NOT all inventory costing.

## FIFO still active elsewhere — DO NOT DROP YET
Functions such as `_raw_remove_fifo`, `_product_inv_remove_fifo`, `_raw_fifo_settle_receipt`, FIFO COGS posting helpers and backfill functions exist. Removing their tables/functions without replacing stock consumption, purchase receipts, COGS and journal posting would break transactions.

## Next ordered implementation
1. Define nonnegative stock decrement that uses warehouse-specific quantities and writes authoritative inventory movements independent of FIFO batch allocation.
2. Seed/derive trustworthy per-material approved price timeline (with traceable source) from existing purchases/catalog if and only if business rules permit; keep original dates, unit conversion and branch IDs. Preserve history, prohibit unapproved inference.
3. Capture immutable sale-time cost snapshots based on most recent published price **at sale time**, and use them consistently in COGS and cost reports.
4. Replace all FIFO callers in purchase, returns, production, void, sales, transfer, stock count and reversal flows. Add isolated tests for underflow, idempotency, rollback, branch/warehouse isolation, recipes and modifiers.
5. Only after zero FIFO runtime references and acceptance suites pass, drop FIFO-specific tables, functions and triggers in reviewed ordered migration; maintain archival evidence as needed.
6. Review whether rollback of current helper is necessary if catalog defaults of 0 expose incomplete pricing.

No FIFO table was dropped in this price-policy migration.
