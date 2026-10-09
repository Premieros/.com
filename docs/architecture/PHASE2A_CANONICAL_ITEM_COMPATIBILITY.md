# Phase 2A — Canonical Item Compatibility Layer

## Purpose

Introduce organization-level item identity without changing any existing production writer.

This phase is additive and read-only for authenticated clients.

## Canonical UOM decision

The current database already has the desired UOM compatibility shape:

- `measurement_units` is the canonical base table.
- `units` is a `security_invoker=true` compatibility view.
- All 22 rows match one-to-one by UUID/code/name/symbol.
- All 803 raw materials point to IDs in `measurement_units`.
- `raw_materials.unit_id` already has a foreign key to `measurement_units(id)`.

Therefore no third UOM table is introduced.

## New canonical tables

### public.items

Organization-level identity with:

- item type
- code / SKU / barcode
- name / English name
- base UOM
- active state

Initial item types used by the backfill:

- products -> FINISHED_GOOD or RETAIL_ITEM
- raw materials -> RAW_MATERIAL
- inventory units -> SEMI_FINISHED

### public.item_sites

Branch/site-specific settings:

- active state
- preferred warehouse
- min stock
- max stock
- reorder point
- lead time

### private.item_legacy_links

Internal compatibility mapping:

```
products.id        -> items.id
raw_materials.id   -> items.id
inventory_units.id -> items.id
```

The mapping is private and not callable/readable by authenticated browser clients.

## Backfill

Production snapshot after reconciliation:

- 508 product mappings
- 803 raw-material mappings
- 34 inventory-unit mappings
- 1,345 canonical items
- 1,345 item-site rows
- 0 unmapped legacy rows
- 0 duplicate item mappings
- 0 attribute mismatches

## Security

- RLS enabled on `items` and `item_sites`.
- Authenticated clients receive SELECT only.
- Item visibility is organization-scoped.
- Item-site visibility is branch-scoped.
- No browser INSERT/UPDATE/DELETE grant exists yet.
- `private.item_legacy_links` is internal-only.

## Runtime behavior

No existing writer or page has been switched.

Existing operational tables remain authoritative for writes:

- products
- raw_materials
- inventory_units

The canonical layer is currently for mapping/reconciliation only.

## Next step

Phase 2B should introduce a synchronization strategy for new/updated legacy catalog records and then add stable read APIs over canonical items before any writer cutover.
