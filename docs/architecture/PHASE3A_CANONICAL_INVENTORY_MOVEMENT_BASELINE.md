# Phase 3A — Canonical Inventory Movement Baseline

## Purpose

Establish one internal read model for inventory movements before changing any stock writer.

## Production migration

`20261009090317_phase3a_canonical_inventory_movement_read_model`

## Current production reality

The active inventory history is split across:

- `public.inventory_ledger` for raw-material movements
- `public.inventory_unit_entries` for semi-finished inventory-unit movements

Legacy finished-product inventory tables are currently inactive:

- `inventory`: 0 rows
- `inventory_batches`: 0 rows

At the reviewed production baseline:

- inventory_ledger rows: 21,750
- inventory_unit_entries rows: 331
- unified movement rows: 22,081

## Canonical read model

`private.canonical_inventory_movements`

The view resolves every legacy stock movement to the organization-level `items.id` through `private.item_legacy_links`.

Columns include:

- source_stream
- source_entry_id
- item_id
- source_entity_type
- branch_id
- warehouse_id
- batch_number
- base_quantity
- unit_cost
- movement_value
- before_qty / after_qty when available
- movement_type
- legacy_entry_type
- reference_type / reference_id / reference_number
- created_by / created_at

## Movement vocabulary

Current entries are normalized without rewriting history:

- opening -> OPENING
- purchase -> PURCHASE_RECEIPT
- purchase_return -> SUPPLIER_RETURN
- sale -> SALE_CONSUMPTION
- refund -> SALE_REVERSAL
- kitchen_send -> KITCHEN_CONSUMPTION
- kitchen_void -> KITCHEN_REVERSAL
- raw production -> PRODUCTION_ISSUE
- inventory-unit production -> PRODUCTION_RECEIPT
- transfer -> TRANSFER
- adjustment -> ADJUSTMENT

The original `legacy_entry_type` is retained so no audit meaning is lost.

## Quantity sign convention

Production data already follows a consistent signed-quantity model:

- receipts/opening/customer reversals: positive
- sale/kitchen consumption/supplier return/raw production issue: negative
- inventory-unit production receipt: positive
- transfer: paired negative/positive

The canonical read model preserves the sign exactly.

## Reconciliation result

Verified after migration:

- source rows: 22,081
- canonical rows: 22,081
- missing item IDs: 0
- missing branches: 0
- missing warehouses: 0
- duplicate source rows: 0
- missing inventory_ledger rows: 0
- missing inventory_unit_entries rows: 0

## Security

This read model remains in the `private` schema.

Access:

- anon: none
- authenticated browser clients: none
- service_role/postgres: SELECT

No new public inventory API was introduced.

## Writer status

No inventory writer changed in Phase 3A.

Existing FIFO, batches, kitchen consumption, purchases, refunds, production, transfers, waste and stock-count flows continue to use their current production functions/tables.

## Next step

Phase 3B should define canonical balance projections and reconcile them against:

- raw_material_inventory
- raw_material_batches
- inventory_unit_batches

before any writer cutover or table removal.
