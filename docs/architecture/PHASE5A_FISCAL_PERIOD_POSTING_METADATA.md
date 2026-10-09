# Phase 5A — Fiscal Period & Posting Metadata Baseline

## Purpose

Introduce fiscal-period identity and explicit journal posting metadata without changing the existing accounting write paths.

Phase 5A is additive. It does **not** yet enforce immutable posted journals or closed-period blocking because several legacy reconciliation workflows still update or delete journal rows.

## Production migration

`20261009140019_phase5a_fiscal_period_posting_metadata`

## New accounting periods

`public.accounting_periods`

Monthly organization-level periods with:

- organization_id
- period_start / period_end
- name
- status: OPEN / SOFT_CLOSED / CLOSED
- closed_at / closed_by

Only SELECT is granted to authenticated clients.

Browser INSERT/UPDATE/DELETE is not allowed.

## Journal metadata

`public.journal_entries` now includes:

- period_id
- posting_status
- posted_at
- posted_by
- reversal_of
- correlation_id
- source_event_id

Existing entries were backfilled as POSTED.

## Automatic period assignment

Private trigger:

`private.assign_journal_posting_metadata()`

runs before journal INSERT or changes to branch/date.

It:

- resolves the organization through branch;
- ensures the corresponding monthly period exists;
- assigns period_id;
- initializes POSTED metadata on INSERT;
- creates a correlation_id when absent.

The helper is private, SECURITY DEFINER and has explicit search_path.

## Backfill result

Production baseline after migration:

- journal entries: 2,247
- periods: 4
- missing period: 0
- missing posted_at: 0
- missing correlation_id: 0
- organization/period mismatch: 0
- entry date outside period: 0
- unbalanced journals: 0
- non-POSTED historical journals: 0

## Future-period smoke test

A future monthly period was created through the private period resolver inside a rolled-back subtransaction.

Verified:

- period was created successfully;
- rollback left zero residual period rows.

## Canonical lifecycle view

`private.canonical_journal_lifecycle`

Combines:

- journal identity;
- organization / branch;
- accounting period;
- posting status;
- posting metadata;
- reversal/correlation links;
- debit/credit totals;
- balance invariant.

The view remains private.

## Important legacy exceptions

Phase 5A does **not** claim journals are immutable yet.

Existing production functions still mutate previously-created accounting rows in limited workflows, including examples such as:

- FIFO COGS reconciliation;
- FIFO stock-variance reconciliation;
- payment-method changes;
- historical purchase correction/replacement;
- legacy credit-purchase reconciliation.

These must be migrated to reversal/adjustment semantics before a hard immutability guard is safe.

## Current direct RLS state

Existing journal RLS still contains UPDATE policies for authenticated users.

Phase 5A does not remove them yet because mutation callers must be fully migrated and regression-tested first.

## Next step

Phase 5B should:

1. classify every remaining journal UPDATE/DELETE path;
2. convert business corrections to reversal + replacement where practical;
3. isolate temporary reconciliation exceptions;
4. add a closed-period guard;
5. revoke direct browser UPDATE/DELETE on posted journals;
6. only then enforce immutable POSTED entries.
