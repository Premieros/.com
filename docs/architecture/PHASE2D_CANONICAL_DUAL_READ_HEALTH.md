# Phase 2D — Canonical Dual-Read Health

## Purpose

Add a permanent dual-read reconciliation signal before any production UI is switched from legacy catalog reads to the canonical item model.

## Production migration

`20261009085820_phase2d_canonical_dual_read_reconciliation`

## Reconciliation view

`public.canonical_item_reconciliation`

The view compares legacy and canonical row counts by:

- organization
- branch
- source type

Source types:

- PRODUCTS
- RAW_MATERIALS
- INVENTORY_UNITS

Canonical mapping:

- FINISHED_GOOD / RETAIL_ITEM -> PRODUCTS
- RAW_MATERIAL -> RAW_MATERIALS
- SEMI_FINISHED -> INVENTORY_UNITS

Output:

- legacy_count
- canonical_count
- delta
- is_match

## Security

The reconciliation view is:

```
security_invoker = true
```

and therefore respects the RLS of the underlying legacy and canonical catalog tables.

Access:

- anon: no SELECT
- authenticated: SELECT
- service_role: SELECT

No SECURITY DEFINER function was introduced.

## Production baseline

At migration time:

- reconciliation groups: 6
- mismatched groups: 0
- absolute delta: 0
- all groups matched

## Application integration

`catalog.listCanonicalItemReconciliation(...)` reads the reconciliation view.

The System Health page now includes a dedicated check:

- green when every visible branch/type group matches;
- red when one or more groups differ;
- red when the reconciliation query itself fails.

This is diagnostic only. It does not mutate any catalog, stock, accounting, POS, or KDS data.

## CI guard

The Architecture V2 integration baseline now requires:

- zero reconciliation mismatches;
- zero absolute delta;
- security_invoker on the view;
- no anon SELECT;
- authenticated SELECT.

## Cutover rule

No operational page should switch to canonical reads unless this health check remains green and the legacy/canonical attribute reconciliation for that page has also been proven.

## Next step

Phase 2E should switch one non-critical read-only catalog surface to the canonical read model behind an immediate fallback to the legacy source, then observe before wider cutover.
