# Post legacy FIFO deletion: inventory readiness policy (2026-11-18)

The old `raw_fifo_debts` and dependent settlement/rebase records were explicitly deleted from production. The readiness audit must not infer that the absence of debt rows makes remaining negative stock a new orphaned FIFO debt problem.

## Read-only verification (project hvqlkapynjfjikqithvd)
- 0 FIFO debt rows.
- 533 raw-material balance rows; 146 negative balances.
- 0 mismatches between the aggregate raw-material batch quantity and `raw_material_inventory.quantity` among those 533 rows (tolerance 0.0001).
- 146 negative inventory balances also have negative aggregate batch balances.
- 6,424 individual negative raw-material batch records.

## Classification
- **BLOCKER**: raw inventory vs aggregate batch inconsistency, or negative balance whose aggregate batches are not negative.
- **REVIEW**: negative balance, individual negative batches, or newly observed unsettled FIFO debt.
- **Never** make an absent legacy debt record itself a blocker.
- **Unverified**: physical count, historical oversold batches, costing, warehouse-level reconciliation, return/replenishment correctness, and whether existing operations create fresh debt. Any previously known security, auth, backup and cashier gates remain independent.

The audit produces aggregated counts and does not write to production. This policy must not be used to zero, revalue or silently hide negative inventory, and it is not a blanket go-live approval.

Review `_raw_remove_fifo` and `_raw_fifo_settle_receipt` against a disposable database before modifying stock behavior. A future incoming receipt must not be incorrectly allocated against a deleted historical debt; simultaneously it must not leave the negative physical batch and aggregate balance inconsistent.
