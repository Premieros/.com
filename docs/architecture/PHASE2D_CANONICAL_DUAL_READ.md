# Phase 2D — Canonical Dual-Read Reconciliation

## Purpose

Validate the canonical item model continuously in the running application before any production screen is switched to it.

## Runtime behavior

No operational writer changed.

No POS, purchasing, recipe, costing, inventory, or accounting screen was moved to the canonical model.

Instead, the application now performs a read-only comparison between:

- legacy `products`
- legacy `raw_materials`
- legacy `inventory_units`
- `canonical_item_catalog`

## Comparator

`catalog.compareCanonicalCatalog(branchId)`

The comparator:

- reads all rows with pagination;
- compares products, raw materials and semi-finished inventory units independently;
- compares attribute multisets rather than relying on different legacy/canonical IDs;
- checks branch, item type, code/SKU/barcode, name, UOM where applicable, active state and stock policy fields;
- returns counts and mismatch totals;
- never writes data.

## System Health integration

`SystemHealthPage` now includes:

`V2 canonical catalog reconciliation`

Healthy means:

- no query errors;
- legacy and canonical totals match;
- product mismatches = 0;
- raw-material mismatches = 0;
- inventory-unit mismatches = 0.

Any difference is surfaced as an error in System Health.

## Why application-side dual-read

The canonical mapping table remains in the private schema.

The comparator deliberately does not expose private legacy IDs through a new privileged RPC.

This keeps Phase 2D:

- read-only;
- RLS-aware;
- free of new SECURITY DEFINER API surface.

## Pagination

The comparator explicitly pages in chunks of 1000 rows so the result remains correct after catalog size exceeds the default Data API response limit.

## Cutover gate

A catalog UI read cutover is not approved until this check remains green across all organization branches in normal production use.

## Next step

Phase 2E may switch one non-critical catalog/admin read surface to the canonical read model behind a compatibility fallback, while all writes remain on the legacy tables.
