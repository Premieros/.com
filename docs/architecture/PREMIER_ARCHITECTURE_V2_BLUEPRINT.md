# Premier Architecture V2 Blueprint

> Status: DESIGN ONLY — no production schema or runtime behavior changed by this document.
>
> Canonical repository: `Premieros/.com`
>
> Canonical Supabase project: `hvqlkapynjfjikqithvd`
>
> Scope: Target architecture for multi-branch restaurant ERP, inventory, costing, accounting, procurement, and future AI agents.

---

## 1. Goal

Premier should evolve from a feature-rich restaurant POS into a coherent ERP platform without a rewrite.

The target architecture must:

1. preserve current production behavior while migration is incremental;
2. keep PostgreSQL/Supabase as the transactional system of record;
3. establish one canonical model for items, inventory, costing, accounting and procurement;
4. distinguish operational documents from financial documents;
5. make every important mutation idempotent, auditable and transactionally safe;
6. provide stable business commands/events before AI agents are given mutation capabilities;
7. reduce the public database/RPC surface and move internal helpers behind a private boundary.

---

## 2. Non-goals

This blueprint does **not** authorize:

- destructive migrations;
- rewriting historical production data;
- deleting legacy tables/functions before usage proof;
- changing current POS behavior;
- replacing Supabase;
- introducing a second parallel V2 runtime;
- modifying another repository or project.

All implementation is forward-only and migration-by-migration.

---

## 3. Current architectural strengths to preserve

The current system already has valuable foundations:

- PostgreSQL/Supabase transactional backend;
- RLS enabled across public tables;
- branch/warehouse isolation;
- double-entry accounting;
- FIFO raw-material costing;
- business-day and shift concepts;
- idempotent sale processing;
- KDS and kitchen inventory effects;
- waste and stock-count accounting;
- recursive product composition costing;
- offline POS infrastructure;
- permission-first routing;
- organization business profiles.

Architecture V2 should consolidate these capabilities, not replace them.

---

## 4. Canonical domain boundaries

The target backend domains are:

```
Identity & Organization
Catalog & Item Master
Pricing
Inventory
Recipes / BOM / Production
Sales & POS
Kitchen / Fulfillment
Procurement
Treasury & Payments
Accounting
Reporting & Analytics
Approvals & Audit
Platform / Integration
AI Tools
```

Each domain owns its rules and exposes stable commands/read models.

UI code must not own financial or inventory truth.

---

## 5. Canonical Item Master

### 5.1 Problem

Current catalog concepts are spread across:

- products
- raw_materials
- inventory_units
- product_units
- units / measurement_units
- recipes
- product_unit_links
- inventory_unit_recipes
- inventory_unit_recipe_units

This is functional but difficult to scale to many branches because master data is often branch-bound.

### 5.2 Target model

```
items
  id
  organization_id
  code
  sku
  barcode
  name
  name_en
  item_type
  stock_behavior
  sellable
  purchasable
  producible
  base_uom_id
  active

item_sites
  item_id
  branch_id
  preferred_warehouse_id
  active
  min_stock
  max_stock
  reorder_point
  lead_time_days

item_uoms
  item_id
  uom_id
  conversion_to_base
  barcode
  sell_price
  purchase_enabled
  sale_enabled

item_prices
  item_id
  branch_id
  price_list_id
  amount
  currency_id
  effective_from
  effective_to
```

### 5.3 Item types

Canonical types:

```
RAW_MATERIAL
SEMI_FINISHED
FINISHED_GOOD
RETAIL_ITEM
PACKAGING
SERVICE
NON_STOCK
```

A semi-finished item is the future canonical equivalent of the current manufactured inventory-unit concept.

### 5.4 Migration rule

Do not remove current product/raw/inventory-unit tables first.

Phase 1 introduces a compatibility/canonical mapping layer. Existing IDs remain valid until every caller has migrated.

---

## 6. Units of Measure

All inventory truth must use one base UOM per item.

Example:

```
Flour
Base UOM = gram

1 kg   = 1000 g
1 sack = 25000 g
```

Every stock movement should retain both:

```
entered_quantity
entered_uom_id
conversion_factor
base_quantity
```

All valuation, FIFO and balances operate on `base_quantity`.

Avoid free-text unit names as financial/inventory truth.

---

## 7. Canonical Inventory Model

### 7.1 Source of truth

The inventory ledger is the immutable source of truth.

Balances and availability are projections/cache.

```
inventory_movements
  id
  organization_id
  branch_id
  warehouse_id
  item_id
  lot_id
  movement_type
  base_quantity
  unit_cost
  total_cost
  source_type
  source_id
  correlation_id
  occurred_at
  created_by
```

### 7.2 Movement types

```
OPENING
PURCHASE_RECEIPT
PURCHASE_RETURN
SALE_CONSUMPTION
SALE_REVERSAL
PRODUCTION_ISSUE
PRODUCTION_RECEIPT
TRANSFER_OUT
TRANSFER_IN
WASTE
COUNT_GAIN
COUNT_LOSS
ADJUSTMENT
CUSTOMER_RETURN
SUPPLIER_RETURN
```

### 7.3 Balance projection

```
inventory_balances
  branch_id
  warehouse_id
  item_id
  lot_id
  quantity
  inventory_value
  updated_at
```

This table is derived, never an independent truth.

### 7.4 Warehouse rule

Every inventory movement must have an explicit warehouse.

No cross-branch or implicit fallback warehouse.

---

## 8. Lots, batches, expiry and negative stock

A canonical lot model should hold:

```
inventory_lots
  item_id
  warehouse_id
  lot_number
  production_date
  expiry_date
  received_at
  source_id
```

Negative stock remains a business policy, but debt/backfill machinery must remain internal implementation detail and not leak into UI contracts.

---

## 9. Costing V2

Premier should treat "cost" as separate concepts.

### 9.1 Actual Cost

Actual FIFO/lot consumption cost.

Used for:

- COGS;
- inventory valuation;
- posted accounting;
- actual profitability.

### 9.2 Theoretical Cost

Recipe/BOM cost using current reference ingredient costs.

Used for:

- menu engineering;
- pricing;
- expected food cost;
- operational variance.

### 9.3 Standard Cost

Management-controlled cost frozen for an effective period.

Used for:

- planning;
- budgeting;
- price decisions;
- standard-vs-actual variance.

### 9.4 Required terminology

Never allow one `cost_price` field to ambiguously represent all three.

Target read model:

```
item_costs
  item_id
  branch_id
  actual_cost
  theoretical_cost
  standard_cost
  standard_effective_from
  calculated_at
```

Historical posted transactions always preserve their original cost snapshots.

---

## 10. Yield and recipe/BOM model

The future BOM should support:

```
bom_headers
  output_item_id
  branch_id nullable
  version
  output_quantity
  effective_from
  effective_to
  status

bom_lines
  bom_id
  component_item_id
  base_quantity
  waste_percent
  yield_percent
  sequence
```

Yield concepts should distinguish:

- trim loss;
- cook loss;
- recipe waste;
- output yield.

The same recursive BOM engine should support both sellable and semi-finished items.

---

## 11. Restaurant cost variance

Premier should provide a first-class variance model:

```
Theoretical consumption
vs
Actual consumption
```

Variance causes:

- waste;
- over-portioning;
- production yield loss;
- stock-count variance;
- purchase price variance;
- recipe variance;
- unexplained shrinkage.

Primary management KPIs:

```
Actual Food Cost %
Theoretical Food Cost %
Food Cost Variance %
Gross Margin
Contribution Margin
Waste %
```

---

## 12. Sales and operational orders

Keep the current distinction:

```
Order = operational document
Sale  = posted commercial/financial snapshot
```

Flow:

```
Order
  -> Kitchen / Fulfillment
  -> Settlement
  -> Sale
  -> Inventory effects
  -> Accounting posting
```

A posted sale must not change when catalog prices, recipes or taxes are edited later.

Required snapshots include:

- line description;
- price;
- discounts;
- modifiers;
- taxes;
- UOM/conversion;
- recipe/cost basis where required for audit.

---

## 13. Money and rounding policy

Create a central money policy.

Recommended default precision:

```
money              2
quantity           6
unit cost          6
tax calculation    4-6 internal, rounded by policy
exchange rate      8
```

The database is the final authority for:

- subtotal;
- discounts;
- taxes;
- totals;
- tender allocation;
- change;
- COGS.

JavaScript may preview calculations but cannot be the posting authority.

---

## 14. Tax model

Target:

```
tax_codes
tax_rates
tax_jurisdictions
item_tax_profiles
document_tax_lines
line_tax_lines
```

Support:

- inclusive / exclusive;
- zero-rated;
- exempt;
- multiple rates;
- effective dates;
- branch/jurisdiction overrides.

Tax must be calculated per line then reconciled to document totals under one documented rounding policy.

---

## 15. Procurement V2

Canonical purchasing flow:

```
Purchase Request
  -> RFQ / Supplier Quotations
  -> Purchase Order
  -> Goods Receipt
  -> Supplier Invoice
  -> Payment
```

These are separate business documents.

### 15.1 Three-way match

Compare:

```
Purchase Order
Goods Receipt
Supplier Invoice
```

Detect:

- quantity variance;
- price variance;
- invoice variance.

### 15.2 Landed Cost

Support allocation of:

- freight;
- customs;
- insurance;
- handling;
- other import costs.

Allocation bases:

- value;
- quantity;
- weight;
- volume;
- manual.

Inventory actual cost must include allocated landed cost when policy requires it.

---

## 16. Accounts Payable / Receivable

Payments should not be permanently tied to exactly one invoice.

Target:

```
payments
payment_allocations
```

A payment can allocate to multiple documents and a document can receive multiple payments.

Support:

- partial payment;
- advance payment;
- credit note;
- unapplied cash;
- aging;
- outstanding balance.

---

## 17. Accounting V2

### 17.1 Organization-level Chart of Accounts

The Chart of Accounts should be organization-level master data.

Branch becomes an accounting dimension, not a duplicated account tree.

Journal dimensions:

```
account_id
branch_id
cost_center_id
department_id
customer_id
supplier_id
project_id optional
```

### 17.2 Immutable journal posting

Journal lifecycle:

```
DRAFT -> POSTED -> REVERSED
```

Posted entries are immutable.

Corrections use reversal + replacement, never destructive editing.

Required fields:

```
posting_status
posted_at
posted_by
period_id
source_event_id
correlation_id
reversal_of
```

### 17.3 Fiscal periods

Introduce:

```
fiscal_years
accounting_periods
```

Statuses:

```
OPEN
SOFT_CLOSED
CLOSED
```

Closed periods reject ordinary backdated transactions.

Privileged adjustments use explicit adjustment workflows.

---

## 18. Business Day

Operational reporting should use a first-class business-day identity rather than `date(created_at)`.

Every operational transaction should be attributable to:

```
organization
branch
business_day
shift (when applicable)
```

This preserves one restaurant day across midnight.

---

## 19. Treasury

Treasury should distinguish:

- cash drawer;
- petty cash;
- bank account;
- card clearing account;
- delivery clearing;
- customer/supplier settlement.

Every tender movement should reconcile to:

- a payment event;
- a treasury transaction;
- accounting lines;
- shift/business-day totals.

---

## 20. Database API boundary

### 20.1 Target principle

The browser should call a small stable public business API.

Internal helpers belong in a non-exposed schema.

```
public / api-facing
  process_sale
  create_order
  send_to_kitchen
  receive_purchase
  approve_stock_count
  approve_waste
  transfer_inventory
  post_payment

private
  fifo helpers
  posting helpers
  recipe expansion
  valuation helpers
  permission helpers
  reconciliation helpers
```

### 20.2 SECURITY DEFINER

SECURITY DEFINER should be exceptional, not the default.

Every such function must have:

- explicit `search_path`;
- explicit grants;
- internal authorization where relevant;
- no accidental PUBLIC execute;
- tests.

---

## 21. RLS strategy

Keep RLS as defense in depth.

All exposed tables remain protected.

Policy rules:

- organization/branch ownership predicates;
- indexes on policy columns;
- `USING` + `WITH CHECK` for UPDATE;
- avoid duplicate permissive policies;
- use security-invoker views when exposed;
- keep authorization data out of user-editable metadata.

---

## 22. Commands and transactions

Client mutation code should express business intent, not row-by-row database state.

Examples:

```
CompleteSaleCommand
ReceivePurchaseCommand
ApproveStockCountCommand
TransferInventoryCommand
PostSupplierPaymentCommand
ProduceItemCommand
```

Each command is:

1. authorized;
2. validated;
3. executed transactionally;
4. idempotent when retryable;
5. audited;
6. correlated;
7. verified by invariant tests.

---

## 23. Domain Events and Outbox

Introduce a durable event/outbox model before AI automation.

```
domain_events
  id
  organization_id
  branch_id
  event_type
  aggregate_type
  aggregate_id
  payload
  actor_id
  correlation_id
  occurred_at

outbox
  event_id
  destination
  status
  attempts
  next_attempt_at
```

Example:

```
SALE_COMPLETED
  -> inventory projection
  -> accounting posting
  -> analytics
  -> loyalty
  -> integrations
  -> AI observation
```

Critical accounting/inventory truth must remain transactionally consistent; events are for decoupled secondary effects unless an operation explicitly uses an atomic posting pipeline.

---

## 24. Correlation and audit

Every cross-domain transaction should carry `correlation_id`.

Audit records should capture:

```
actor
action
entity_type
entity_id
before
after
reason
organization
branch
device/session where appropriate
correlation_id
occurred_at
```

Reason should be mandatory for high-risk operations:

- void;
- refund;
- price override;
- stock adjustment;
- backdated posting;
- manual journal;
- approval override.

---

## 25. Frontend target structure

Do not create another permanent `v2` application.

Target structure:

```
src/
  app/
    routing/
    providers/

  modules/
    catalog/
      domain/
      application/
      infrastructure/
      ui/

    inventory/
    costing/
    sales/
    pos/
    procurement/
    accounting/
    reporting/
    admin/

  shared/
    ui/
    hooks/
    utils/
    types/

  infrastructure/
    supabase/
    offline/
    printing/
    telemetry/
```

### 25.1 Responsibility rules

- Page components orchestrate only.
- Business calculations live in domain/application code.
- Supabase calls live in infrastructure/API adapters.
- Shared UI has no business-specific rules.
- One domain should not reach directly into another domain's tables from UI code.

---

## 26. Routing

Replace the growing route god-file with a route registry.

Example:

```ts
{
  path,
  module,
  permission,
  layout,
  lazyComponent
}
```

The same registry should drive:

- router;
- menu visibility;
- prefetch;
- module availability;
- permission metadata.

---

## 27. i18n

Split translations by locale and domain:

```
locales/
  ar/
    common
    pos
    inventory
    accounting
  en/
    ...
```

Load domain translations lazily.

---

## 28. Testing strategy

### 28.1 Invariant tests

Must cover:

```
sum(debit) = sum(credit)

inventory_after =
inventory_before + movements

refunded_quantity <= sold_quantity

fifo_consumed_quantity = requested_quantity

fifo_cost =
sum(batch_quantity * batch_unit_cost)

payment_allocations <= payment_amount
```

### 28.2 Workflow tests

Critical workflows:

- dine-in sale;
- takeaway sale;
- split payment;
- refund;
- void;
- offline replay;
- purchase receipt;
- supplier invoice;
- stock count;
- waste;
- transfer;
- production;
- period close.

### 28.3 Property-based testing

Generate randomized transaction sequences and assert accounting/inventory invariants.

---

## 29. AI architecture

AI agents must never receive raw unrestricted mutation access to business tables.

Target:

```
AI
 -> Tool
 -> Business Command
 -> Authorization
 -> Validation
 -> Approval when needed
 -> Transaction
 -> Verification
 -> Audit/Event
```

Read tools:

- get_sales_summary
- get_food_cost_variance
- get_stock_position
- get_supplier_balance
- get_cash_variance

Mutation tools should begin as proposals:

- propose_purchase_order
- propose_stock_transfer
- propose_price_change
- propose_recipe_change
- propose_stock_adjustment

Approval converts a proposal into a canonical command.

---

## 30. Migration strategy

### Phase 0 — Freeze and map

No behavior change.

Deliverables:

- active/legacy table map;
- public/private RPC inventory;
- canonical write-path matrix;
- accounting/inventory invariant suite.

### Phase 1 — API and security consolidation

- classify every public function;
- revoke accidental helper access;
- move internal helpers behind private schema boundaries;
- consolidate duplicate RLS policy groups;
- maintain compatibility wrappers.

### Phase 2 — Canonical UOM and Item mapping

- introduce organization-level item identity;
- map current products/raw-materials/inventory-units;
- introduce item-site configuration;
- do not switch writers yet.

### Phase 3 — Inventory canonicalization

- formalize ledger movement contract;
- introduce canonical balance projection;
- enforce explicit warehouse and base UOM;
- dual-read reconciliation before cutover.

### Phase 4 — Costing V2

- actual cost;
- theoretical cost;
- standard cost;
- yield;
- variance reporting.

### Phase 5 — Accounting V2

- organization COA;
- dimensions;
- fiscal periods;
- immutable posting;
- reversal contracts.

### Phase 6 — Procurement V2

- PO;
- GRN;
- supplier invoice;
- three-way match;
- landed cost;
- AP allocation.

### Phase 7 — Frontend modularization

- split giant pages;
- unify API/repository boundary;
- route registry;
- modular i18n;
- remove stale parallel V2 paths.

### Phase 8 — Commands and Events

- stable command API;
- correlation IDs;
- domain events;
- outbox;
- telemetry.

### Phase 9 — AI tools

Only after commands, permissions, audit and invariants are stable.

---

## 31. Cutover rules

Every migration must use:

```
Add
 -> Backfill
 -> Dual read / compare
 -> Switch reads
 -> Switch writes
 -> Observe
 -> Remove legacy later
```

Never:

```
drop old model
 -> hope the new one works
```

No legacy table/function is removed until:

1. no production caller remains;
2. reconciliation is green;
3. tests cover replacement behavior;
4. rollback path is documented.

---

## 32. Immediate next implementation milestone

The first implementation milestone after this document is approved is **not** a destructive item migration.

It is:

### P-A: Canonical Model Mapping & Safety Baseline

Deliverables:

1. current-table -> target-domain mapping;
2. active writer/read-path inventory;
3. public RPC classification: API / internal / legacy;
4. SECURITY DEFINER hardening plan;
5. Item/UOM compatibility model;
6. inventory/accounting invariants added to tests;
7. zero behavior change.

Only after P-A is green should schema additions for canonical Item/UOM begin.

---

## 33. Decision log

Initial decisions:

- PostgreSQL/Supabase remains the transactional core.
- Current production IDs remain stable during migration.
- Item Master becomes organization-level; branch settings move to site configuration.
- Inventory ledger becomes canonical truth.
- Actual/Theoretical/Standard cost are independent.
- Chart of Accounts becomes organization-level; branch becomes a dimension.
- Posted accounting is immutable.
- Purchase Order, Receipt and Supplier Invoice become separate documents.
- Public RPC surface shrinks; internal helpers move behind private boundaries.
- AI works through stable business tools/commands, not raw table mutation.
