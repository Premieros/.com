# Phase 4E — Cost Variance Reporting

## Purpose

Expose Costing V2 variance safely in the existing Costing Center without creating a second reporting surface or moving financial calculations into React.

## Production migration

`20261009135011_phase4e_cost_variance_summary`

## Summary RPC

`public.get_cost_variance_summary_v2(branch, from, to)`

The RPC requires:

- authenticated user;
- branch access;
- `reports.costing` permission.

Anonymous execution is revoked.

The function is SECURITY DEFINER with explicit `search_path`.

## Comparable scope

Actual-vs-Theoretical metrics include only sale rows where:

- Actual COGS exists;
- Theoretical Cost exists;
- theoretical coverage status is `COMPLETE`.

Incomplete rows are retained in detail APIs but are excluded from aggregate comparisons.

This prevents partial or missing recipe data from silently changing Food Cost KPIs.

## Coverage metrics

The summary reports both:

- comparable sale count / all sales;
- comparable net sales / total net sales.

The UI displays coverage prominently because comparable revenue can differ materially from total revenue even when most invoices have complete line coverage.

## Sale variance

For comparable sales:

```
Actual vs Theoretical =
sum(Actual COGS) - sum(Theoretical Cost)
```

Positive variance means realized cost is above the comparison basis.

The summary also reports:

- Actual Food Cost %
- Theoretical Food Cost %
- Actual vs Standard Cost when Standard Cost coverage exists.

Historical basis remains explicit:

- `IMMUTABLE_SALE_SNAPSHOT_V1`
- `CURRENT_RECIPE_REFERENCE_NOT_HISTORICAL`
- `MIXED_SNAPSHOT_AND_CURRENT_REFERENCE`
- `INCOMPLETE`

The reporting UI does not hide this distinction.

## Purchase price variance

Purchase comparison is based on the normalized base-unit receipt cost from the inventory ledger, not the originally entered purchase UOM.

Reference basis:

- most recent earlier normalized purchase cost for the same branch/raw material.

Summary:

```
Purchase Price Variance =
sum(Actual normalized cost - Prior purchase reference)
  * received base quantity
```

Rows without a prior reference or normalized ledger receipt remain visible in detail but do not create fabricated variance.

## Snapshot health

The summary surfaces:

- immutable snapshot sales;
- legacy current-reference sales;
- snapshot capture failures;
- missing snapshot without failure.

Any silent missing snapshot remains an invariant failure.

## UI integration

Costing Center now includes:

`Cost Variance / انحرافات التكلفة`

The tab requires an explicit branch selection because inventory, COGS, Standard Cost and purchase references are branch-scoped.

It displays:

1. comparable coverage;
2. Actual Food Cost;
3. Theoretical Food Cost;
4. Actual − Theoretical variance;
5. Purchase Price Variance;
6. snapshot health;
7. sale-level variance details;
8. purchase-level variance details.

The detail tables currently load up to 500 rows for usability, while the summary covers the entire selected period.

## Data-quality warnings

The UI explicitly warns when:

- theoretical sales are incomplete;
- purchase groups lack normalized ledger cost.

These rows are not silently treated as zero.

## Calculation ownership

Financial calculations remain in PostgreSQL.

React only:

- requests the summary/details;
- displays basis/status;
- formats values;
- computes presentation-only coverage percentages from already returned counts/totals.

No authoritative COGS, theoretical cost, purchase cost, or variance formula lives in the UI.

## Production arithmetic verification

For every branch with comparable sales:

```
sum(row variance)
=
sum(actual COGS) - sum(theoretical cost)
```

Verified delta at Phase 4E rollout:

`0.000000`

for each active branch.

## Security

`get_cost_variance_summary_v2`:

- anon EXECUTE: revoked;
- authenticated EXECUTE: allowed;
- branch authorization: required;
- `reports.costing`: required;
- explicit search_path: required.

The underlying snapshot and variance views remain private.

## CI guard

Architecture V2 integration tests now require:

- branch-level aggregate variance arithmetic to reconcile within numeric tolerance;
- no comparable row has a null row variance;
- summary RPC is not executable by anon;
- summary RPC is executable by authenticated;
- summary RPC has explicit search_path.

## Next step

After Phase 4E is stable, move to Accounting V2 Phase 5A:

- inspect current journal lifecycle;
- introduce Fiscal Period baseline;
- define immutable POSTED / REVERSED semantics;
- preserve current business posting functions until reconciliation and rollback paths are proven.
