# PremierOS online performance audit — 2026-11-23

Scope: online-first BUNKER handoff. No production schema or data modifications.

## Verified implementation

- **Products:** `ProductsPage` uses `usePaginatedRows`, 100 rows/page, branch-scoped `products` query, server-side case-insensitive search on `name`, `name_en`, `barcode`, `sku`, and an explicit Load More control. On this branch, typing is debounced 250ms before changing the server filter. Export remains a separate explicit full-data operation.
- **Sales:** `SalesPage` uses 100-row server pages, branch-scope filtering, excludes archived records, sorts newest first. An optional **All invoice numbers** checkbox now switches to debounced **server-side invoice_number** search throughout authorized sales history. The original search across loaded customer name/source order/status remains available when unchecked. The status tabs and local creation-date filter now run **on the authorized database rows before 100-record pagination** (with UTC boundaries derived from the operator's local calendar day). The secondary customer/source-order/status free-text lookup remains **loaded rows only**; never claim global customer/order text search. The optional invoice-number search remains database-wide.
- **Reports:** `fetchAllReportRows` reads the requested time range in 1,000-row server batches instead of silently accepting a default cap. This provides complete filtered report datasets but can still consume significant browser RAM on very large ranges; scalable aggregation/server-side pagination needs a separate design.
- **KDS:** must retain complete branch-authorized active tickets in a bounded operational queue. Never paginate KDS in a way that hides active sent orders.

## Production index inventory (read-only inspection)

Already present; DO NOT create duplicate indexes:

- `products`: `idx_products_branch`, `idx_products_branch_category`, `idx_products_barcode`.
- `sales`: `idx_sales_branch_created_at`, `idx_sales_branch_archived_created`, `sales_branch_invoice_unique`, `idx_sales_source_order_id`, plus cashier/customer indexes.
- `categories`: `idx_categories_branch`, `idx_categories_kitchen_station`.
- `order_kitchen_sends`: `idx_order_kitchen_sends_order`, `idx_order_kitchen_sends_branch`, and unique `order_item_id`.

`ILIKE '%term%'` generally cannot exploit a plain btree text index for substring search. **Do not add pg_trgm or GIN indexes blindly**: require measured query latency, row counts, extension support, and EXPLAIN (ANALYZE, BUFFERS) in a safe environment before deciding. In BUNKER's small demo dataset, index additions are not currently evidenced as useful.

## Regression gates

1. Products search immediately reflects typing visually; network query changes only after the 250ms quiet period, with cancellation on further typing.
2. A new branch or user scope invalidates loaded product results and uses the existing scoped pagination hook.
3. Sales financial actions and KDS behavior must not be changed by the catalog debounce.
4. Run TypeScript, lint, component tests, browser smoke, and production DB **read-only** audit before release.

**Not claimed:** measurable speedup or production load-test success. Those require measured before/after timings in authenticated sessions.
