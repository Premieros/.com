# Phase 5D — Append-Only Payment Reclassification

## Purpose

Stop changing account assignments inside already-posted sale journals when a sale payment method is corrected.

The original sale journal is now immutable from this workflow. Accounting correction is represented by a new reclassification journal in the current OPEN period.

## Production migration

`20261011064018_phase5d_append_only_payment_reclassification`

## Previous behavior

`change_sale_payment_method(...)` previously located the original sale journal and changed the collection line's `account_id`.

Example:

```
Original posted sale
Debit Cash 410.40
...
```

Changing payment method from cash to card could mutate that historical line to Bank.

That destroys the original accounting fact and makes later audit/reconciliation harder.

## New behavior

The original sale journal is never edited.

When the accounting bucket changes:

```
cash -> card/transfer

New reclassification journal:
Debit Bank 410.40
Credit Cash 410.40
```

For the reverse direction:

```
card/transfer -> cash

Debit Cash
Credit Bank
```

The correction is dated when the correction is made and must post into an OPEN accounting period.

## Same-account payment methods

Card and transfer both currently resolve to the bank accounting bucket.

Changing:

```
card <-> transfer
```

records the payment-method change event but creates no redundant zero-effect accounting journal.

## Unsupported current methods

The append-only correction command accepts existing sale methods:

- cash
- card
- transfer

It deliberately rejects current `split` or `credit` sales with:

`CURRENT_PAYMENT_METHOD_NOT_RECLASSIFIABLE`

Those require dedicated settlement/receivables workflows rather than guessing one source account.

## Change-event storage

Private table:

`private.sale_payment_method_changes`

Stores:

- sale
- branch
- old method
- new method
- amount
- optional reclassification journal
- reason
- actor
- timestamp

The table is private:

- authenticated: no direct access
- service_role: SELECT only
- writes occur only through the privileged command

## Public command

Existing RPC signature is preserved:

`change_sale_payment_method(sale_id,new_method,reason)`

Authorization and approval behavior remain compatible.

The response now additionally includes:

- `change_id`
- `reclassification_journal_id`
- `append_only_accounting=true`

## Journal mutation registry

`change_sale_payment_method(uuid,text,text)` is now inactive in the direct mutation registry.

After Phase 5D:

- direct journal mutators: 10
- unclassified: 0
- POSTED_RECLASSIFICATION mutators: 0

## Production transactional smoke test

A real cash sale with paid amount 410.40 was changed to card inside a database transaction.

Verified before rollback:

- command succeeded;
- append_only_accounting=true;
- original sale journal lines were byte/logically unchanged;
- a private change event was created;
- a new POSTED reclassification journal was created;
- journal was balanced at 410.40 debit / 410.40 credit;
- Bank debit = 410.40;
- Cash credit = 410.40;
- reclassification period was OPEN;
- sale payment method changed to card.

After ROLLBACK:

- residual change events: 0;
- residual reclassification journals: 0;
- sale payment method returned to cash.

## CI guard

Integration tests require:

- the payment-method RPC no longer appears in the direct journal mutation surface;
- no POSTED_RECLASSIFICATION mutator remains active;
- private change-event storage is inaccessible to authenticated clients;
- service_role cannot mutate change-event history;
- RPC is unavailable to anon;
- RPC retains explicit search_path;
- every persisted reclassification journal links to exactly one change event;
- every reclassification journal is balanced.

## Next step

Phase 5E should convert mutable FIFO reconciliation accumulator journals to append-only adjustment journals.

The remaining owner-level immutability blockers are then:

- same-transaction sale/refund finalization;
- purchase correction timestamp finalization;
- historical/backfill repair functions;
- explicit admin destructive purge.
