# Phase 5B — Period Lock & Journal Reversal

## Purpose

Strengthen Accounting V2 without breaking existing business posting RPCs.

Phase 5B closes direct journal mutation from API roles, introduces period posting locks, and adds a controlled reversal command.

## Production migration

`20261011063245_phase5b_period_lock_and_journal_reversal`

## Direct journal mutation boundary

Authenticated and service-role API clients no longer have direct:

- INSERT
- UPDATE
- DELETE
- TRUNCATE

on:

- `journal_entries`
- `journal_entry_lines`

Existing SELECT access remains unchanged.

Business posting continues through existing SECURITY DEFINER RPCs owned by the database.

The obsolete INSERT/UPDATE/DELETE RLS policies for journal tables were removed because table-level grants now enforce the command boundary.

## Period posting lock

Private helper:

`private.assert_accounting_period_postable(branch,date)`

Allowed:

- OPEN

Rejected:

- SOFT_CLOSED
- CLOSED

`private.assign_journal_posting_metadata()` now calls this helper whenever a journal is inserted or its branch/date changes.

This means legacy posting functions continue to work unchanged while automatically respecting period state.

## Period status command

Public RPC:

`set_accounting_period_status(period_id,status,reason)`

Requirements:

- authenticated user;
- `accounting.reconciliation.manage`;
- organization access;
- non-empty reason.

Transitions:

- OPEN -> SOFT_CLOSED
- OPEN -> CLOSED
- SOFT_CLOSED -> OPEN
- SOFT_CLOSED -> CLOSED
- CLOSED is final through the ordinary command

A CLOSED period cannot be reopened with this RPC.

Every state change is audited.

## Journal reversal command

Public RPC:

`reverse_journal_entry(entry_id,reason,reversal_date)`

Requirements:

- authenticated user;
- `accounting.reconciliation.manage`;
- branch access;
- source journal must be POSTED and balanced;
- reason required;
- reversal date cannot precede original date;
- reversal period must be OPEN.

Behavior:

1. locks the source journal;
2. prevents duplicate reversals;
3. creates a new POSTED journal;
4. copies every line with debit/credit swapped;
5. preserves customer/supplier dimensions;
6. preserves the original correlation_id;
7. sets `reversal_of` on the new journal;
8. marks the original journal as REVERSED;
9. writes an audit record.

A unique partial index guarantees at most one reversal per source journal.

## Accounting semantics

A REVERSED source journal remains part of the historical ledger.

The reversal journal offsets it financially.

Reports must include both POSTED and REVERSED ledger history when calculating financial balances.

Do not interpret REVERSED as "delete/exclude the original row".

## Production transactional smoke tests

### Reversal

A real POSTED journal was reversed inside a transaction and rolled back.

Verified before rollback:

- source changed to REVERSED;
- reversal changed to POSTED;
- reversal_of pointed to the source;
- debit/credit were swapped exactly;
- correlation_id was preserved;
- no persistent rows remained after rollback.

### Period lock

A real OPEN period was changed to SOFT_CLOSED inside a transaction.

A reversal targeting that period was rejected with:

`ACCOUNTING_PERIOD_SOFT_CLOSED`

The transaction was rolled back afterward.

## Compatibility note

Some internal historical/repair workflows still mutate journal rows after initial insertion, including selected FIFO reconciliation, split-payment finalization, and historical correction routines.

Phase 5B therefore does **not** add an owner-level immutable trigger yet.

Those paths run inside privileged database functions and remain operational.

Phase 5C will classify/refactor them before database-level POSTED immutability is enforced.

## CI guard

Integration tests now require:

- journal tables remain read-only to authenticated/service_role mutation;
- reversal RPC unavailable to anon;
- period-status RPC unavailable to anon;
- both public commands retain explicit search_path;
- period assertion helper remains private;
- no duplicate reversal_of links;
- no invalid reversal links;
- all reversal journals remain balanced.

## Next step

Phase 5C — Internal Journal Mutation Elimination:

1. classify every database function that updates/deletes journal rows after posting;
2. separate same-transaction finalization from historical mutation;
3. replace post-hoc mutation with DRAFT -> POSTED or adjustment/reversal flows;
4. remove deletion of posted reconciliation journals;
5. add owner-level immutable guards only after all active internal paths are compatible.
