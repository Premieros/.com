# Phase 5C — Journal Mutation Registry

## Purpose

Make every direct post-creation journal mutation explicit before enforcing database-owner immutability.

## Production migration

`20261011063603_phase5c_journal_mutation_registry`

## Registry

Private table:

`private.journal_mutation_registry`

Classifications:

- SAME_TRANSACTION_FINALIZATION
- TRANSITIONAL_RECONCILIATION
- HISTORICAL_REPAIR
- CONTROLLED_REVERSAL
- ADMIN_DESTRUCTIVE
- POSTED_RECLASSIFICATION

## Mutation surface

Private view:

`private.journal_mutation_surface`

It inspects database functions and flags direct UPDATE/DELETE statements against:

- journal_entries
- journal_entry_lines

Every current mutator must have a registry row.

Current baseline: 11 direct mutators, 0 unclassified.

## Current classification

### Same-transaction finalization

- process_sale_split
- process_refund
- update_purchase_invoice

These modify journals created in the same outer transaction and are not externally observable as partially posted states.

### Transitional reconciliation

- _fifo_adjust_sale_cogs_delta
- _fifo_adjust_orphan_sale_cogs_delta
- _fifo_adjust_stock_variance_delta

These still maintain mutable reconciliation accumulator journals.

Target: append-only reconciliation adjustments.

### Historical repair

- private.reconcile_credit_purchase_bank_history
- raw_fifo_reverse_backfill

Target: retire once historical repair windows are permanently closed.

### Controlled reversal

- reverse_journal_entry

This is the supported Accounting V2 historical correction path.

### Admin destructive

- admin_data_delete_section

This remains isolated from ordinary financial workflows.

### Posted reclassification

- change_sale_payment_method

This currently edits account_id on an already-posted sale journal line.

It is the first active path selected for refactor in Phase 5D.

## Security

The registry and mutation-surface view remain private.

Authenticated browser clients cannot read them.

## CI guard

CI now fails if any direct journal mutator appears without an active registry classification.

This prevents hidden journal mutation from re-entering the system as more functions are added.

## Next step

Phase 5D will convert sale payment-method correction from UPDATE-on-posted-line to an append-only reclassification journal.
