# Phase 5A — Fiscal Period & Posting Metadata Baseline

## Purpose

Establish the Accounting V2 metadata baseline without changing existing business posting commands.

This phase records the production migration already applied as:

`20261009140019_phase5a_fiscal_period_posting_metadata`

## Accounting periods

New table:

`public.accounting_periods`

Scope:

- organization-level;
- one row per calendar month;
- period start/end;
- status: OPEN / SOFT_CLOSED / CLOSED;
- close actor/timestamp metadata.

Authenticated users have SELECT-only access subject to organization RLS.

## Journal posting metadata

`journal_entries` now includes:

- period_id
- posting_status
- posted_at
- posted_by
- reversal_of
- correlation_id
- source_event_id

Allowed posting statuses:

- DRAFT
- POSTED
- REVERSED

## Automatic metadata assignment

Private trigger function:

`private.assign_journal_posting_metadata()`

Trigger:

`trg_assign_journal_posting_metadata`

Behavior:

- assigns the correct organization accounting period from branch + entry_date;
- creates the monthly accounting period lazily if it does not exist;
- defaults new entries to POSTED;
- captures posted_at / posted_by;
- assigns correlation_id.

The trigger is SECURITY DEFINER, has explicit search_path, lives in the private schema, and is not executable by anon/authenticated roles.

## Backfill result

Production baseline after Phase 5A:

- journals: 2,247
- journals without period: 0
- POSTED journals without posted_at: 0
- POSTED journals without correlation_id: 0
- invalid period/organization/date links: 0

All historical journals remain POSTED.

No historical journal value or journal line amount was rewritten.

## Important limitation

Phase 5A is metadata only.

It does **not yet** enforce:

- immutable POSTED journals;
- immutable POSTED journal lines;
- period close posting lock;
- reversal-only correction.

Those are Phase 5B responsibilities.

## CI guard

Integration tests require:

- every journal has period_id;
- every POSTED journal has posted_at and correlation_id;
- period organization/date matches the journal branch/date;
- accounting_periods keeps RLS;
- authenticated access to accounting_periods is SELECT-only;
- one private hardened metadata trigger remains attached.

## Next step

Phase 5B — Posted Journal Immutability & Period Lock:

1. block UPDATE/DELETE of POSTED entries and lines;
2. block ordinary posting into SOFT_CLOSED/CLOSED periods;
3. provide a controlled reversal command;
4. preserve all existing business posting RPCs;
5. test reversal arithmetic and immutable history.
