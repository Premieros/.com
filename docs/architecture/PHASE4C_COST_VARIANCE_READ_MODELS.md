# Phase 4C — Cost Variance Read Models

## Purpose

Add read-only Costing V2 variance models without changing FIFO, posting, valuation, sale prices, or inventory writers.

The goal is to separate:

- realized Actual COGS;
- current Theoretical Cost;
- effective-dated Standard Cost;
- purchase cost variance against prior normalized purchase reference.

## Production migration

`20261009131940_phase4c_cost_variance_read_models`

## Sale cost variance

Private view:

`private.canonical_sale_cost_variance`

One row per non-archived, non-cancelled/non-returned sale.

### Actual COGS

The read model uses the same priority already used by the production costing summary:

1. posted journal COGS;
2. settled kitchen snapshot COGS;
3. legacy sale ledger fallback;
4. MISSING.

This avoids inventing a second Actual COGS definition.

Baseline:

- sales: 1,242
- actual COGS available: 1,241
- JOURNAL_POSTED: 1,220
- KITCHEN_SNAPSHOT: 21
- LEGACY_LEDGER: 0
- MISSING: 1

### Theoretical Cost

Theoretical sale cost is calculated from the current canonical item theoretical cost multiplied by net sold quantity.

Important:

```
theoretical_basis = CURRENT_RECIPE_REFERENCE_NOT_HISTORICAL
```

This is deliberately explicit.

Current recipe/reference cost is useful for management comparison, but it is **not** presented as the recipe cost that existed at the historical sale timestamp.

A future phase must capture immutable theoretical snapshots at posting time if true historical theoretical variance is required.

### Modifier safety

Sale items with modifier snapshots are not silently valued using the base-product recipe alone.

They receive:

`MODIFIER_UNMODELED`

and do not produce a completed Actual-vs-Theoretical variance.

Baseline:

- complete theoretical coverage: 1,235 sales
- modifier-unmodeled: 5 sales
- valid Actual-vs-Theoretical variance rows: 1,234

### Standard Cost

Standard Cost is resolved by sale timestamp from `item_standard_costs`.

Variance is produced only when every net line has an effective Standard Cost.

Current production has no configured Standard Cost history yet, so Standard Cost variance is intentionally unavailable rather than defaulted to zero.

## Purchase cost variance

Private view:

`private.canonical_purchase_cost_variance`

One row per purchase + raw-material group.

### Actual purchase cost

Actual purchase cost is based on normalized inventory ledger receipts:

```
actual_base_unit_cost =
sum(inventory_ledger.total_cost)
/
sum(inventory_ledger.quantity)
```

This is used instead of blindly comparing `purchase_items.unit_cost`, because entered purchase UOM may differ from the base inventory UOM.

### Historical reference

The reference cost is the most recent earlier positive normalized purchase ledger cost for the same:

- raw material;
- branch.

Reference basis:

`PRIOR_PURCHASE_REFERENCE`

This is a historical reference, not today's current cost.

### Purchase baseline

- purchase/raw-material groups: 520
- normalized Actual Cost available: 508
- missing normalized ledger link: 12
- prior purchase reference available: 321
- valid reference variance rows: 310
- unmapped canonical items: 0
- negative actual costs: 0
- negative received quantities: 0

The 12 missing ledger groups are retained as explicit `MISSING_LEDGER` rows. They are not backfilled with guessed costs.

## Variance semantics

### Sale

```
Actual vs Theoretical =
Realized COGS - Current Theoretical Cost
```

```
Actual vs Standard =
Realized COGS - Effective Standard Cost
```

```
Theoretical vs Standard =
Current Theoretical Cost - Effective Standard Cost
```

Positive variance means actual/current-theoretical cost is above its comparison basis.

### Purchase

```
Purchase Price Variance per base unit =
Actual normalized purchase cost - Prior normalized purchase reference
```

```
Total Purchase Price Variance =
Unit variance * received base quantity
```

## Security

Both views remain in the `private` schema.

Access:

- anon: none
- authenticated browser clients: none
- postgres/service_role: SELECT

No new SECURITY DEFINER browser API is introduced in Phase 4C.

## Safety decisions

Phase 4C does **not**:

- modify posted COGS;
- change FIFO;
- rewrite inventory batches;
- change journal entries;
- modify product or raw-material costs;
- create Standard Costs;
- backfill missing purchase ledger rows;
- pretend current theoretical cost is a historical snapshot;
- value modifier-bearing sales with an incomplete base-product recipe.

## CI guard

The Architecture V2 integration baseline now requires:

- one variance row per eligible sale;
- no negative Actual or Theoretical costs;
- variance only when its required inputs are present;
- modifier-unmodeled rows remain explicit;
- theoretical basis remains explicitly non-historical;
- one purchase variance row per purchase/raw-material group;
- no unmapped purchase item;
- no negative normalized purchase cost/quantity;
- browser roles cannot read either private variance view.

## Next step

Phase 4D should add permission-checked read APIs for Cost Variance and introduce **forward-looking theoretical cost snapshots at sale posting time** so future Actual-vs-Theoretical variance becomes historically exact rather than based on the current recipe.
