# Phase 4B — Standard Cost Command & Safe Read APIs

## Purpose

Introduce a controlled write path for effective-dated Standard Cost and expose Costing V2 through permission-checked RPCs.

The browser still has no direct INSERT/UPDATE/DELETE privilege on `item_standard_costs`.

## Production migration

`20261009092803_phase4b_standard_cost_command`

## Write command

`public.set_item_standard_cost(...)`

Inputs:

- item ID
- branch ID
- standard cost
- mandatory reason
- optional effective-from timestamp

Authorization:

- authenticated user required
- branch access required
- `reports.costing` required
- `products.edit` required
- service_role/postgres may execute for controlled system work

The command never overwrites history in-place.

When a new Standard Cost begins:

1. any covering previous period is closed at the new effective timestamp;
2. the next future period, if any, becomes the new row's `effective_to`;
3. a new row is inserted;
4. an `audit_log` record is written with reason, item, amount and effective dates.

An existing row with the exact same `effective_from` is rejected.

## Overlap protection

Trigger:

`trg_guard_item_standard_cost_overlap`

Function:

`private.guard_item_standard_cost_overlap()`

Any INSERT/UPDATE that would create overlapping Standard Cost periods for the same item + branch is rejected with:

`STANDARD_COST_PERIOD_OVERLAP`

This protects the invariant even when privileged code writes directly.

The trigger function:

- is SECURITY DEFINER
- has explicit search_path
- is private
- is not executable by anon/authenticated

## Read APIs

### get_item_costing_v2(branch)

Requires:

- authenticated user
- branch access
- `reports.costing`

Returns the canonical Costing V2 row set for the branch:

- inventory/reference cost
- costing reference cost
- theoretical cost
- standard cost
- standard effective dates
- theoretical basis/status

### get_item_standard_cost_history(item, branch)

Requires:

- authenticated user
- branch access
- `reports.costing`

Returns the full Standard Cost timeline ordered newest first.

## Frontend API

`src/api/domains/costing.ts` now exposes:

- `getItemCostingV2`
- `getItemStandardCostHistory`
- `setItemStandardCost`

No production screen is forced to use the write command yet.

## Production smoke test

A fully transactional smoke test was executed and rolled back.

Verified:

- first Standard Cost period created;
- second effective period automatically closed the first;
- second period became active;
- two audit records were created;
- direct overlapping insert was rejected by the trigger;
- rollback left zero Standard Cost test rows;
- rollback left zero audit test rows.

## RPC exposure

Verified:

- anon cannot execute set/read/history APIs;
- authenticated can execute the supported APIs;
- private overlap guard is not executable by browser roles;
- all SECURITY DEFINER APIs have explicit search_path.

## Safety decisions

Phase 4B does not:

- change actual FIFO consumption;
- change posted COGS;
- update product or inventory-unit stored cost;
- change menu prices;
- auto-create Standard Costs;
- rewrite historical Standard Costs.

## Next step

Phase 4C should introduce cost-variance read models:

- Actual/realized COGS vs theoretical cost;
- theoretical vs Standard Cost;
- purchase/reference cost variance;

without changing posting or valuation rules.
