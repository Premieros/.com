# Phase 2B — Canonical Item Synchronization

## Purpose

Keep the additive canonical item layer synchronized while the existing catalog tables remain the production write model.

## Production migration

`20261009081334_phase2b_canonical_item_sync`

## Sync sources

- `products`
- `raw_materials`
- `inventory_units`

Each source table has an AFTER INSERT / UPDATE / DELETE trigger.

## Internal trigger functions

- `private.sync_product_canonical_item()`
- `private.sync_raw_material_canonical_item()`
- `private.sync_inventory_unit_canonical_item()`

All three:

- run as SECURITY DEFINER;
- have explicit search_path;
- live in the private schema;
- are not executable by anon/authenticated;
- preserve the legacy source as the current writer of truth.

## Behavior

### INSERT

Creates:

- one `items` row;
- one `item_sites` row;
- one `private.item_legacy_links` row.

### UPDATE

Synchronizes canonical identity and branch/site settings.

If the legacy row changes branch, the compatibility item remains one canonical identity and its old site row is removed before the new site row is upserted.

### DELETE

Deletes the canonical item. Cascades clean:

- item_sites;
- item_legacy_links.

## Production smoke test

A temporary raw material was created, updated and deleted.

Verified:

- canonical item created on INSERT;
- canonical site created on INSERT;
- name/min-stock synchronized on UPDATE;
- mapping and canonical item removed on DELETE;
- zero residual temporary rows remained.

## Runtime cutover status

No frontend page or business writer has moved to `items` yet.

Current production writers remain:

- products;
- raw_materials;
- inventory_units.

The canonical layer is now safe to use as a synchronized read/mapping model.

## Next step

Phase 2C should add stable canonical read APIs and compare their output to legacy catalog reads before any UI read cutover.
