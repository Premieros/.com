# Phase 3C — Inventory Batch Diagnostics

## Purpose

Classify raw-material batch differences without rewriting historical inventory data.

## Production migration

`20261009091158_phase3c_inventory_batch_diagnostics`

## Diagnostic views

- `private.canonical_raw_batch_diagnostics`
- `private.canonical_inventory_health_summary`

These remain internal and are not exposed to browser clients.

## Classification model

Each raw-material balance is classified as one of:

- `MATCH`
- `NEGATIVE_STOCK_DEBT`
- `NEGATIVE_BALANCE_WITHOUT_DEBT`
- `HISTORICAL_BATCH_EXCESS`
- `HISTORICAL_BATCH_SHORTFALL`
- `UNKNOWN`

Rows with expected negative-stock debt are not treated as historical corruption.

## Production baseline

Current classification:

- MATCH: 372
- NEGATIVE_STOCK_DEBT: 145
- HISTORICAL_BATCH_EXCESS: 7
- NEGATIVE_BALANCE_WITHOUT_DEBT: 1
- UNKNOWN: 0

Therefore:

- 153 raw rows have non-zero batch delta;
- 145 are explained by active negative-stock debt;
- only 8 rows require historical/manual review;
- operational balance reconciliation remains green.

## Safety decision

Phase 3C performs **no automatic batch repair**.

The presence of a batch delta does not automatically mean inventory is wrong. Operational quantity continues to be validated against the latest ledger snapshot.

Automatic rewriting of historical batches is prohibited unless:

1. the source transaction history is proven;
2. accounting/COGS impact is understood;
3. repair is idempotent and auditable;
4. post-repair reconciliation remains green.

## Recommended actions

- `NEGATIVE_STOCK_DEBT` -> observe settlement through normal receipts/FIFO reconciliation.
- `HISTORICAL_BATCH_EXCESS` -> review old opening/import baseline.
- `NEGATIVE_BALANCE_WITHOUT_DEBT` -> review the negative-stock path for that item.
- `HISTORICAL_BATCH_SHORTFALL` -> review historical receipt/consumption chain if it appears later.

## CI guard

The integration baseline requires:

- no UNKNOWN diagnostic state;
- no operational balance reconciliation mismatch;
- no missing canonical item/branch/warehouse scope;
- no anon/authenticated access to diagnostic views.

## Next step

Phase 3D should inspect the 8 review rows individually and decide whether they are data-history artifacts or genuine repair candidates before any mutation is allowed.
