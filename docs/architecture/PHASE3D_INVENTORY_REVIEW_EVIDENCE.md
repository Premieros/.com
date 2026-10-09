# Phase 3D — Inventory Review Evidence

## Purpose

Turn the eight review-only raw inventory anomalies into evidence-backed cases without mutating historical inventory.

## Production migration

`20261009091524_phase3d_inventory_review_evidence`

## Views

- `private.canonical_inventory_review_cases`
- `private.canonical_inventory_review_summary`

Both are private and inaccessible to browser roles.

## Evidence classification

Each review case is classified using:

- historical opening batches
- oversold batches
- purchase batches
- zero-before purchase ledger rows
- opening ledger rows
- kitchen sends from non-positive operational balance

Current evidence reasons:

- `HISTORICAL_OPENING_REBASE`
- `TRANSACTION_BASELINE_DRIFT`
- `UNTRACKED_NEGATIVE_STOCK_PATH`
- `UNCLASSIFIED_REVIEW`

## Production baseline

Current review cases:

- HISTORICAL_OPENING_REBASE: 6
- TRANSACTION_BASELINE_DRIFT: 1
- UNTRACKED_NEGATIVE_STOCK_PATH: 1
- UNCLASSIFIED_REVIEW: 0

Total review cases: 8.

## Findings

### Historical opening rebase

Six rows show a historical opening batch that remains in FIFO history while a later operational path re-established the current balance from a different baseline.

These are not safe to rewrite automatically because historical cost/COGS implications depend on the original import intent.

### Transaction baseline drift

One row has a batch total above the operational balance without historical-opening evidence.

Its transaction chain requires targeted audit before any repair.

### Untracked negative-stock path

One row has a negative operational balance and an oversold batch marker but no matching open FIFO debt.

This indicates a legacy negative-stock path that did not produce the current debt model.

It must be repaired, if at all, through an audited migration that reconciles FIFO, valuation and COGS together.

## Safety policy

Every review row is stamped:

`repair_policy = NO_AUTOMATIC_REPAIR`

and:

`requires_human_review = true`

No repair mutation is performed by Phase 3D.

## CI guard

The integration baseline requires:

- zero unclassified review cases;
- every review case remains manual-only;
- every case is marked for human review;
- anon/authenticated cannot read the evidence views.

## Next step

The inventory architecture is now safe enough to proceed to Costing V2 design/read models while the eight historical cases remain quarantined from automatic repair.
