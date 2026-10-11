# Phase 5G — Purchase Correction Journal Dates at Insert Time

## Purpose

Remove the final direct journal mutation from `update_purchase_invoice(...)` while preserving the existing requirement that a corrected purchase invoice remains on the original accounting/document date.

## Production migration

`20261011065554_phase5g_purchase_correction_insert_time_journal_dates`

## Previous behavior

Purchase correction already used the correct high-level workflow:

1. reverse the completed purchase;
2. retain the old purchase as an audit revision;
3. create a replacement purchase in the same transaction.

However, the replacement and reversal journal entries were first created at the correction timestamp and then mutated afterward:

- `journal_entries.created_at`
- `journal_entries.entry_date`
- `journal_entry_lines.created_at`

That made `update_purchase_invoice(...)` a direct journal mutator and prevented owner-level journal immutability.

## New behavior

Journal dates are assigned **before INSERT**.

Private trigger functions:

- `private.apply_journal_timestamp_override()`
- `private.apply_journal_line_timestamp_override()`

Triggers:

- `trg_00_journal_timestamp_override`
- `trg_00_journal_line_timestamp_override`

The `00` prefix intentionally causes the journal date override trigger to run before the normal posting-metadata trigger.

## Transaction-local override

`update_purchase_invoice(...)` resolves:

- original document `created_at`;
- original journal `entry_date`.

It then sets transaction-local PostgreSQL settings:

- `app.journal_created_at_override`
- `app.journal_entry_date_override`

while it executes:

- `process_purchase_return(...)`;
- `process_purchase(...)`.

The journal and journal lines therefore receive the original timestamps at creation.

After replacement creation, the previous setting values are restored immediately.

The settings are local to the current transaction.

## Period assignment

Because the entry-date override runs before `trg_assign_journal_posting_metadata`, the replacement/reversal journal obtains its `period_id` from the correct original accounting date.

The normal Accounting V2 period-lock logic remains in force.

A correction cannot silently write into a non-postable period.

## Non-journal historical timestamps

The existing purchase-correction behavior still preserves original timestamps on:

- replacement purchase;
- purchase items;
- inventory batches;
- raw-material batches;
- inventory ledger rows.

These are operational/history rows and are outside the journal immutability boundary addressed by this phase.

## Journal mutation removed

The following post-insert operations were removed from `update_purchase_invoice(...)`:

- UPDATE `journal_entry_lines.created_at`;
- UPDATE `journal_entries.created_at`;
- UPDATE `journal_entries.entry_date`.

The function no longer appears in `private.journal_mutation_surface`.

Its registry classification is inactive.

## Security

Both timestamp override helpers:

- live in `private`;
- are SECURITY DEFINER;
- use explicit search_path;
- cannot be executed by anon/authenticated.

`update_purchase_invoice(...)` preserves its public RPC signature and existing authorization behavior.

## Production transactional smoke test

A completed cash purchase was corrected to the **same values** inside a transaction:

- Purchase: `Johna's-00198`
- Original timestamp: `2026-09-28 14:50:50.842017+00`
- Original accounting date: `2026-09-28`
- Total: `160.20`

Verified before rollback:

- correction succeeded;
- response returned `journal_dates_assigned_at_insert=true`;
- replacement purchase retained original created_at;
- replacement purchase journal was born with original created_at;
- purchase-return journal was born with original created_at;
- both journals had entry_date `2026-09-28`;
- all journal lines were born with original created_at;
- period_id resolved to September 2026;
- both journals remained POSTED;
- transaction-local override settings were restored;
- `update_purchase_invoice(...)` was absent from journal mutation surface.

After rollback:

- original purchase remained completed;
- original invoice number remained unchanged;
- residual test audit rows: 0.

## Mutation surface result

After Phase 5G:

- direct journal mutators: 6;
- unclassified: 0;
- `update_purchase_invoice(...)`: 0 direct journal mutations.

## CI guard

Integration tests now require:

- purchase correction absent from mutation surface;
- zero unclassified journal mutators;
- no active registry classification for purchase correction;
- exactly one entry override trigger;
- exactly one line override trigger;
- both trigger functions private and SECURITY DEFINER;
- explicit search_path on both trigger functions;
- no anon/authenticated EXECUTE on either helper;
- update-purchase RPC unavailable to anon and available to authenticated;
- update-purchase RPC keeps explicit search_path.

## Next step

Phase 5H should review the six remaining mutation paths:

- same-transaction sale split finalization;
- same-transaction refund finalization;
- controlled journal reversal;
- historical credit-purchase repair;
- historical FIFO backfill reversal;
- explicit admin destructive purge.

Owner-level immutable guards should only be introduced after these paths are either removed, explicitly scoped, or provided a safe internal finalization/bypass contract.
