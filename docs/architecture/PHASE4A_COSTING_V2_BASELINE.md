# Phase 4A — Costing V2 Baseline

## Purpose

Separate the different meanings of "cost" before any pricing, accounting, or inventory logic is changed.

Premier now treats cost as distinct concepts rather than overloading `cost_price`.

## Production migration

`20261009092021_phase4a_costing_v2_baseline`

## Cost concepts

### Inventory / operational cost

This is the currently stored inventory/reference cost available from the operational stock model.

Examples:

- raw materials: `raw_material_inventory.avg_cost`
- semi-finished items: current `inventory_units.cost_price` where available
- ready products: current stored product cost where available

This field is **not** treated as realized historical COGS.

Realized actual COGS remains transaction-level and comes from the inventory/FIFO consumption path used when the transaction was posted.

### Theoretical cost

Expected cost according to the current recipe/BOM and reference ingredient costs.

Sources:

- raw material -> `_raw_cost_for_costing`
- semi-finished item -> recursive `_inventory_unit_recipe_cost`
- manufactured finished good -> recursive `_product_recipe_cost`
- ready product -> stored reference cost where applicable

Used for:

- menu engineering
- expected food cost
- price planning
- theoretical-vs-actual variance

It must not overwrite posted transaction costs.

### Standard cost

A management-approved effective-dated cost.

New table:

`public.item_standard_costs`

Standard cost is never auto-populated from theoretical or inventory cost.

It is intended for:

- planning
- budgeting
- management variance
- price decisions
- period-based standard-cost policies

## Canonical costing read model

`private.canonical_item_costs`

One row per canonical item + branch with:

- inventory_cost
- costing_reference_cost
- theoretical_cost
- standard_cost
- standard effective dates
- theoretical cost basis
- theoretical cost status

The view is private and is not a browser API.

## Production baseline

Canonical catalog rows: **1,345**

Canonical cost rows: **1,345**

Duplicate item/branch cost rows: **0**

Negative theoretical costs: **0**

### Finished goods

- total: 508
- theoretical cost available: 506
- missing theoretical inputs: 2
- inventory/stored cost treated as actual: 0
- standard cost: 0

### Raw materials

- total: 803
- operational inventory avg cost available: 349
- current costing reference/theoretical cost available: 522
- missing current costing input: 281
- standard cost: 0

### Semi-finished items

- total: 34
- stored operational cost available: 10
- recursive theoretical cost available: 33
- missing theoretical input: 1
- standard cost: 0

The missing-cost counts are data-completeness signals, not schema failures.

## Security

`item_standard_costs`:

- RLS enabled
- authenticated: SELECT only within accessible branches/organization
- no browser INSERT/UPDATE/DELETE
- service role: managed access

`private.canonical_item_costs`:

- anon: no access
- authenticated: no direct access
- postgres/service_role: SELECT

A controlled command must be introduced before users are allowed to set a standard cost.

## Safety decisions

Phase 4A does **not**:

- modify FIFO consumption
- modify posted COGS
- change journal posting
- update `products.cost_price`
- update `inventory_units.cost_price`
- set any standard cost automatically
- change sale prices
- replace existing costing RPCs

## CI guard

The Architecture V2 integration suite now requires:

- canonical cost row count = canonical catalog row count
- no duplicate item/branch cost rows
- no negative theoretical cost
- RLS on standard-cost table
- authenticated standard-cost access remains read-only
- private costing view remains inaccessible to anon/authenticated

## Next step

Phase 4B should introduce an explicit, permission-checked command for setting effective-dated Standard Cost and a safe read API for Costing V2.

The command must preserve history rather than overwriting prior periods.
