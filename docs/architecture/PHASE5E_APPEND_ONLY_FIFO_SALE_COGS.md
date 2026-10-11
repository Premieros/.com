# Phase 5E — Append-Only FIFO Sale COGS Reconciliation

## Purpose

Stop mutating one long-lived FIFO sale COGS reconciliation journal.

Each new rounded FIFO valuation increment is now represented by a new immutable adjustment journal.

## Production migration

`20261011064606_phase5e_append_only_fifo_sale_cogs`

## Previous behavior

`_fifo_adjust_sale_cogs_delta(sale_id,delta)` maintained one reconciliation journal per sale.

As exact FIFO valuation changed, the function:

- updated debit/credit on the same journal lines;
- deleted the journal when the target rounded delta returned to zero.

That behavior made posted accounting history mutable.

## New behavior

The existing summary table remains:

`raw_fifo_sale_cogs_adjustments`

It continues to track:

- cumulative exact_delta;
- cumulative posted_delta.

However, when rounded posted_delta changes, the function now calculates:

```
posted_increment =
new rounded target
-
previous posted target
```

and creates a new journal for only that increment.

Positive increment:

```
Debit  COGS
Credit Inventory
```

Negative increment:

```
Debit  Inventory
Credit COGS
```

No historical reconciliation journal line is updated or deleted.

## Event ledger

New private table:

`private.fifo_reconciliation_events`

For Phase 5E, event kind is:

`SALE_COGS`

Each event stores:

- sale/business reference;
- branch;
- exact input delta;
- posted incremental delta;
- cumulative target posted delta;
- linked journal;
- actor/time.

Each journal stores the event UUID in `source_event_id`.

A unique partial index prevents one event from producing multiple journals.

## Journal reference compatibility

Existing reports join FIFO COGS journals by:

- `reference_type = fifo_cogs_reconcile`
- `reference_id = sale_id`

Those semantics are preserved.

The journal reference uniqueness index now excludes only `fifo_cogs_reconcile`, allowing multiple append-only adjustments for the same sale while retaining uniqueness for all other financial reference types.

Existing costing reports already SUM matching journal lines, so they remain compatible with multiple adjustment journals.

## Period behavior

A FIFO adjustment prefers the original sale date only when that accounting period is still OPEN.

If the original period is SOFT_CLOSED/CLOSED, the adjustment posts on the current date instead.

The selected date must pass `assert_accounting_period_postable`.

This prevents a later FIFO correction from silently rewriting a closed accounting period.

## Legacy journal compatibility

Historical mutable reconciliation journals are left untouched.

The legacy `journal_entry_id` pointer on `raw_fifo_sale_cogs_adjustments` is retained for historical compatibility.

Future append-only events use `source_event_id` and the private event ledger.

If cumulative target returns to zero, the summary's legacy journal pointer is cleared instead of deleting accounting history.

This also prevents `raw_fifo_reverse_backfill` cleanup from deleting an historical journal after a compensating append-only event has been posted.

## Production transactional smoke test

An existing sale with historical FIFO adjustment was tested inside a transaction:

1. +1.23 FIFO delta;
2. -1.23 FIFO delta.

Verified before rollback:

- original historical reconciliation journal lines were unchanged;
- two different FIFO events were created;
- two different POSTED journals were created;
- both journals referenced the same sale;
- each journal was balanced;
- incremental COGS was +1.23 then -1.23;
- net COGS effect of the round trip was zero;
- summary exact_delta/posted_delta/journal pointer returned exactly to its original state.

After rollback:

- residual new events: 0;
- the one historical reconciliation journal remained.

## Mutation registry

`_fifo_adjust_sale_cogs_delta(uuid,numeric)` is now inactive in the direct journal mutation registry.

The helper no longer appears in `private.journal_mutation_surface`.

## Security

`private.fifo_reconciliation_events`:

- authenticated: no access;
- service_role: SELECT only.

`private.post_fifo_sale_cogs_event(...)`:

- private schema;
- SECURITY DEFINER;
- explicit search_path;
- no anon/authenticated execute.

## CI guard

Tests require:

- FIFO sale helper absent from direct journal mutation surface;
- zero unclassified journal mutators;
- event table remains private/read-only;
- event helper remains private and hardened;
- every persisted SALE_COGS event links to one POSTED journal;
- event journals remain balanced;
- source_event_id remains unique;
- FIFO COGS references remain explicitly excluded from the ordinary one-reference/one-journal uniqueness rule.

## Next step

Phase 5F should convert:

- orphan-sale COGS reconciliation;
- stock valuation reconciliation;

to the same append-only event model.

After that the mutable FIFO reconciliation category disappears entirely from the journal mutation registry.
