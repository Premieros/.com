# Smouha raw-material FIFO discrepancy — evidence checkpoint, 2026-10-13

**STATUS: UNRESOLVED / READ-ONLY PROVENANCE INVESTIGATION. NO PRODUCTION CORRECTION AUTHORIZED BY THIS DOCUMENT.**

Project `hvqlkapynjfjikqithvd`, branch `فرع نادي سموحة` (`19c3fd23-d784-455b-8840-f4f2ac619651`), raw material `جرجير ربطه` (`03d6381d-b2f9-489e-b536-dc2b88c5767b`). Warehouse observed: `04348dcc-d24c-4b77-99e5-5c6e29551eec`.

## Facts reconfirmed from the production database (read-only)

| Item | Observed quantity |
| --- | ---: |
| Operational raw material inventory | **-1.6500** |
| Sum of raw material batch quantities | **-1.3500** |
| Batch less operational stock | **+0.3000** |
| Outstanding 2026-09-15 sale FIFO debt | 0.3500 |
| Outstanding 2026-09-27 kitchen-send FIFO debt | 1.0000 |
| Total open FIFO debts | **1.3500** |

The batch quantity agrees numerically with negative open FIFO debt, but the operational inventory is an additional 0.3000 lower. This is **not evidence of an authorized stock adjustment**.

The original purchase `bd102e26-370e-4cc1-a357-9e5e25702781` was recorded as `Johna's-00103`, later renamed `Johna's-00103-REV-bd102e26`, status `returned`; its affected raw item is 0.3000 at unit cost 60 and `returned_quantity=0.3000`.

The replacement `3cece2d0-1c09-40fd-a512-eb37e27a97dc` is also a 0.3000 receipt at unit cost 60, remains `completed`, and uses invoice number `Johna's-00103`. Both purchases retain the same `created_at` on the raw ledger row; do **not** use that timestamp to infer the actual correction execution date.

The stock ledger shows two **positive** raw receipt rows, ledger IDs **8710** (original) and **24089** (replacement), each quantity 0.3000 and raw ledger cost 18.00. The scoped raw-material ledger contains **no corresponding purchase-return removal entry**. Source batches for both receipts currently show zero remaining quantity.

The Sept 15 sale FIFO debt (`source_ledger_id=3621`) originally required 2.0000 and is marked settled for 1.6500. Its settlement rows include **0.3000 × 60 = 18.00** linked to original receipt ledger 8710 (recorded on Sept 21), and another **0.3000 × 60 = 18.00** linked to replacement receipt ledger 24089 (recorded on Sept 27). Both settlements are marked `applied`. These are distinct receipt references, **not proof on their own of a duplicated journal posting**. They raise a specific question about whether the original, subsequently returned receipt should have remained eligible to settle consumption.

Journal evidence: two posted purchase journals with the original and replacement UUIDs, **884.00 debits/credits each**, plus a posted `purchase_return` journal for `Johna's-00103`, **884.00 debits/credits**, whose `reference_id` is NULL. Its invoice-number correlation is suggestive but cannot replace verified relational provenance. Therefore the apparent **18.00 raw-item FIFO cost** cannot be interpreted automatically as an 18.00 journal correction: the historic return, debt settlement, COGS and valuation must be reconciled by source-event and entry-line lineage.

## Risk hypothesis (not a proven root cause)

The earlier fail-open `process_purchase_return` could return a JSON error after imperfect stock depletion while purchase correction proceeded; the system's newer fail-closed guard (remote migration `20261012134314`) prevents the analogous future partial FIFO return. The current evidence is consistent with a missed/unpaired stock reversal, but historical event logs do **not yet** establish that precise execution path.

## Required gates before ANY historical repair

1. Reconcile each original/replacement receipt batch and FIFO settlement against the original sale and kitchen-send cost evidence, stock before/after, journal lines and any immutable audit event.
2. Prove whether a return stock-removal ledger entry is genuinely missing, or exists under an indirect cross-reference not covered by the scoped raw-material ledger.
3. Determine the correct economic cost impact separately from the 0.3000 physical quantity difference; evaluate whether an already posted return journal offsets the original purchase financially.
4. Draft **a preview-only, idempotent, explicitly scoped** correction plan with before/after state, dry-run rejection checks, and rollback/compensating journal policy. Obtain a finance reviewer sign-off on source documents and period controls.
5. Apply any reviewed correction only as an append-only, authorized transaction, never a manual SQL overwrite of raw inventory, batches, debt totals or ledger lines. Verify all 16 blocking ERP invariants and exception counts afterward.

## Full nine-delta review scope (read-only cross-check)

The branch/material operational-vs-batch audit returned **nine** mismatched pairs at this checkpoint, but `private.canonical_inventory_review_cases` contains **eight** classified, manual-only cases. Those existing cases are not the same as the ninth, unclassified Smouha arugula case:

| Class / branch and material | Operational | Batch | Batch minus operational | Existing review reason |
| --- | ---: | ---: | ---: | --- |
| Smouha — عيش توست براون | 51.0000 | 99.0000 | +48.0000 | `TRANSACTION_BASELINE_DRIFT` |
| Cleopatra — دقيق 5 نجوم | 50.0000 | 79.4000 | +29.4000 | `HISTORICAL_OPENING_REBASE` |
| Cleopatra — مسطرده جالون | 4.0000 | 10.7200 | +6.7200 | `HISTORICAL_OPENING_REBASE` |
| Cleopatra — جمبرى جامبو ك | 3.0000 | 6.5500 | +3.5500 | `HISTORICAL_OPENING_REBASE` |
| Cleopatra — سلامى | -0.0600 | 3.4150 | +3.4750 | `UNTRACKED_NEGATIVE_STOCK_PATH` |
| Cleopatra — زيت شورتنج | 50.0000 | 53.0000 | +3.0000 | `HISTORICAL_OPENING_REBASE` |
| Cleopatra — صلصه ك | 6.0000 | 8.2000 | +2.2000 | `HISTORICAL_OPENING_REBASE` |
| Smouha — جرجير ربطه | -1.6500 | -1.3500 | +0.3000 | Unclassified; this investigation |
| Cleopatra — ورشيستر صوص | 4.0000 | 4.2800 | +0.2800 | `HISTORICAL_OPENING_REBASE` |

All eight existing records have `requires_human_review=true` and `repair_policy=NO_AUTOMATIC_REPAIR`. The 48.0000 transaction drift deserves its **own** item/period provenance review; the 3.4750 negative-balance case deserves an independent negative-stock-path investigation. Do not add deltas from different materials or units together as one warehouse stock quantity, and do not classify the ninth item automatically based on another item's history.

## Replayable evidence

Run `scripts/audit/smouha-raw-fifo-lineage-readonly.sql` to reproduce the scoped SELECT-only material, purchase, ledger, settlement and journal provenance. Existing production cross-domain audit is `scripts/audit/erp-cross-domain-readonly.sql`.

No test purchases, inventory updates, journal entries, debt migrations, or other data mutations were performed as part of this investigation. The existing **8 quarantined review cases** and **9 operational-versus-batch quantity differences** remain separate review tasks; do not treat them as all caused by this one scenario.
