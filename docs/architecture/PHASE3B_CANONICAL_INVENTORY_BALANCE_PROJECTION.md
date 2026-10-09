# Phase 3B — Canonical Inventory Balance Projection

## Purpose

Create one internal balance projection across raw materials and semi-finished inventory units without changing any production inventory writer.

## Production migration

`20261009090833_phase3b_canonical_inventory_balance_projection`

## Source-of-truth decision

### Raw materials

Operational quantity is sourced from:

`raw_material_inventory.quantity`

This was chosen because production reconciliation showed:

- 525 raw-material balance rows
- 525 / 525 matched the latest `inventory_ledger.after_qty`
- 0 movement mismatches
- max movement delta = 0

Historical summation of the ledger is **not** used as the current balance because some historical import/opening flows reset the baseline.

### Semi-finished inventory units

Operational quantity is:

`sum(inventory_unit_batches.quantity) - open inventory_unit_stock_debt`

This matched the net `inventory_unit_entries.quantity` for all current unit/branch/warehouse scopes.

## View

`private.canonical_inventory_balances`

Columns include:

- item_id
- inventory_kind
- branch_id
- warehouse_id
- quantity
- batch_quantity
- open_debt_quantity
- movement_quantity
- movement_delta
- batch_delta
- balance_source
- warehouse_scope
- reconciliation_status
- updated_at

## Warehouse handling

Raw-material legacy balance is branch-level.

The projection resolves warehouse only when the branch currently has exactly one warehouse:

- `EXACT_SINGLE_WAREHOUSE`
- otherwise `LEGACY_BRANCH_ONLY`

At the reviewed production baseline all active branches have exactly one warehouse, and no raw material has movements in multiple warehouses for the same branch.

This avoids inventing per-warehouse precision if multi-warehouse branch usage appears later.

## Batch diagnostics

Raw-material batches are retained as FIFO/valuation history but are **not** used directly as the current operational balance.

At baseline:

- 153 raw balance rows have a non-zero `batch_delta`

This is explicitly diagnostic and does not fail Phase 3B because current operational quantity remains fully reconciled to the latest ledger `after_qty`.

No automatic historical batch rewrite is performed.

## Production reconciliation

After migration:

- canonical balance rows: 537
- raw-material rows: 525
- semi-finished rows: 12
- missing canonical item IDs: 0
- missing branches: 0
- missing warehouses: 0
- reconciliation mismatches: 0
- branch-only warehouse scopes: 0
- max movement delta: 0
- historical raw batch diagnostic mismatches: 153

## Security

The projection remains private.

Access:

- anon: none
- authenticated browser clients: none
- postgres/service_role: SELECT

## Writer status

No production writer changes in Phase 3B.

FIFO, purchases, sales, refunds, kitchen, production, transfers, waste, stock counts and negative-stock debt continue to use the existing production paths.

## Next step

Phase 3C should add an internal inventory health summary and classify the 153 historical raw-batch deltas by cause before deciding whether any batch repair is justified.

Do not rewrite historical batches merely to force them to equal the operational balance.
