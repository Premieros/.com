# Phase 2C — Canonical Item Read Model

## Purpose

Provide one stable, RLS-aware read model over the new canonical item layer before any page is switched away from the legacy catalog tables.

## Production migration

`20261009081634_phase2c_canonical_item_read_model`

## View

`public.canonical_item_catalog`

The view joins:

- `items`
- `item_sites`
- `branches`
- `measurement_units`

and exposes:

- organization
- branch
- canonical item type
- code / SKU / barcode
- name
- base UOM
- active state
- preferred warehouse
- min/max/reorder settings
- lead time
- timestamps

## Security

The view is created with:

```
security_invoker = true
```

Therefore the caller remains subject to RLS on the underlying `items` and `item_sites` tables.

Access:

- anon: no SELECT
- authenticated: SELECT
- service_role: SELECT

No SECURITY DEFINER read API was introduced.

## API layer

`src/api/domains/catalog.ts` now exposes:

```
catalog.listCanonicalItems(...)
```

Supported filters:

- branch
- item type(s)
- active state

No production page uses this method yet.

## Reconciliation

Production verification:

- canonical product rows: 508
- legacy products: 508
- canonical raw-material rows: 803
- legacy raw materials: 803
- canonical semi-finished rows: 34
- legacy inventory units: 34
- total canonical rows: 1,345

## Cutover policy

Do not switch UI pages until:

1. branch-by-branch counts remain equal;
2. key attributes remain equal;
3. canonical sync triggers remain green;
4. write paths still target legacy catalog tables;
5. rollback is trivial.

## Next step

Phase 2D should introduce a controlled dual-read comparison in non-mutating catalog flows, starting with internal/admin diagnostics rather than POS-critical screens.
