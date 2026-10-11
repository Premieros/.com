# Phase 5F — Append-Only FIFO Orphan & Stock Reconciliation

## Purpose

Complete the FIFO accounting refactor by removing direct mutation of orphan-sale COGS and stock-valuation reconciliation journals.

After this phase, no active FIFO reconciliation helper directly updates or deletes posted journal entries or lines.

## Production migration

`20261011064956_phase5f_append_only_fifo_orphan_and_stock`

## Orphan sale COGS

`_fifo_adjust_orphan_sale_cogs_delta(...)` now:

- keeps cumulative exact/posted values in the existing summary row;
- calculates only the incremental rounded difference;
- writes one new `ORPHAN_SALE_COGS` event;
- creates one new balanced `fifo_cogs_reconcile` journal;
- never edits or deletes the historical reconciliation journal.

The original orphan sale journal is still used as the audit/correlation anchor.

## Stock valuation

`_fifo_adjust_stock_variance_delta(...)` now:

- keeps its existing summary row;
- calculates the incremental rounded variance;
- writes one new `STOCK_VARIANCE` event;
- creates one new balanced `fifo_stock_reconcile` journal;
- never edits or deletes an earlier stock-reconciliation journal.

Positive stock valuation delta:

```
Debit  Stock Variance
Credit Raw Inventory
```

Negative delta reverses the direction.

## Reference uniqueness

The normal one-reference/one-journal uniqueness rule remains in force for ordinary journal types.

Only these append-only reconciliation types are excluded:

- fifo_cogs_reconcile
- fifo_stock_reconcile

Each new FIFO adjustment is instead uniquely identified by `source_event_id`.

## Period behavior

Both helpers prefer the original document date only while that period remains OPEN.

When the original period is SOFT_CLOSED/CLOSED, the accounting adjustment posts in the current OPEN period.

No closed-period history is rewritten.

## Historical compatibility

Existing historical FIFO journals remain untouched.

Existing summary-table `journal_entry_id` values remain as legacy anchors.

When a cumulative target returns to zero, the pointer is cleared rather than deleting accounting history.

This also makes historical backfill reversal cleanup safe: compensating append-only journals survive even when old summary rows are removed.

## Mutation surface

After Phase 5F:

- direct journal mutation functions: 7
- unclassified: 0
- TRANSITIONAL_RECONCILIATION: 0

All three former FIFO reconciliation mutators are now absent from `private.journal_mutation_surface`.

## Production transactional smoke test

Two real historical adjustment families were tested inside one transaction:

### Orphan sale
- +1.11
- -1.11

### Stock valuation
- +1.11
- -1.11

Verified before rollback:

- original orphan journal unchanged;
- original stock journal unchanged;
- both summary rows returned exactly to their starting state;
- two ORPHAN_SALE_COGS events were created;
- two STOCK_VARIANCE events were created;
- all four new journals were balanced.

After rollback:

- residual test events: 0;
- TRANSITIONAL_RECONCILIATION mutators: 0.

## Security

Both private posting helpers:

- live in `private`;
- use SECURITY DEFINER;
- have explicit search_path;
- cannot be executed by anon/authenticated roles.

The event ledger remains private and service-role read-only.

## CI guard

Tests require:

- orphan helper absent from journal mutation surface;
- stock helper absent from journal mutation surface;
- zero transitional reconciliation mutators;
- zero unclassified journal mutators;
- event helpers inaccessible to browser roles;
- every persisted orphan/stock event links to a POSTED journal;
- all linked journals remain balanced;
- journal reference uniqueness explicitly excludes both append-only FIFO types.

## Next step

Phase 5G should address the remaining non-FIFO journal mutation categories:

- same-transaction finalization;
- historical repair;
- admin destructive purge;
- controlled reversal.

The immediate safe target is to remove unnecessary post-insert journal edits from purchase correction and then migrate sale/refund assembly toward explicit DRAFT -> POSTED finalization.
