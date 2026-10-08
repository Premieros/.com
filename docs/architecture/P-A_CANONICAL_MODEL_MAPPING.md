# P-A — Canonical Model Mapping & Safety Baseline

> Architecture V2 Phase P-A
>
> Status: baseline / zero production behavior change
>
> Production reference inspected: `hvqlkapynjfjikqithvd`
>
> Purpose: classify today's physical model before any V2 schema work.

## 1. Rules

- Existing production IDs remain stable.
- "Target domain" is a destination concept, not authorization to migrate now.
- `CANONICAL` means actively part of today's runtime truth.
- `PROJECTION` means derived/read-model/cache that must not become independent truth.
- `INTERNAL` means implementation/audit/settlement machinery.
- `LEGACY` means retained for compatibility and requires caller proof before removal.
- `PLATFORM` means SaaS/platform administration rather than restaurant ERP core.
- No table is dropped in P-A.

## 2. Organization / identity / access

| Current table | Current role | Target domain | P-A class | V2 direction |
|---|---|---|---|---|
| organizations | tenant master | Organization | CANONICAL | keep; organization becomes master-data owner |
| branches | operational site | Organization | CANONICAL | keep; site/branch dimension |
| warehouses | stock location | Inventory | CANONICAL | keep; explicit location on every movement |
| users | application profile | Identity | CANONICAL | keep |
| roles | RBAC definitions | Identity | CANONICAL | keep, normalize permission contracts |
| user_branch_access | site access | Identity | CANONICAL | keep |
| organization_members | tenant membership | Identity | CANONICAL | keep |
| branch_settings | branch overrides | Configuration | CANONICAL | keep; explicit inheritance |
| settings | company defaults | Configuration | CANONICAL | keep |
| system_settings | platform settings | Platform | PLATFORM | isolate from ERP domain |
| login_as_log | impersonation audit | Audit | INTERNAL | keep immutable |
| work_authorizations | guarded work | Security | CANONICAL | keep |
| work_authorization_* | authorization policy/events/bootstrap | Security | INTERNAL | keep behind service boundary |
| approval_policies | approval configuration | Approvals | CANONICAL | keep |
| approval_requests | approval workflow | Approvals | CANONICAL | keep |

## 3. Catalog / Item Master

| Current table | Current role | Target V2 concept | P-A class | V2 direction |
|---|---|---|---|---|
| products | sellable/finished item per branch | items + item_sites | CANONICAL | map to organization item identity + branch site config |
| raw_materials | purchased/raw item per branch | items + item_sites | CANONICAL | map to RAW_MATERIAL item |
| inventory_units | semi-finished/prep item | items + BOM | CANONICAL | map to SEMI_FINISHED item |
| categories | product grouping | item_categories | CANONICAL | organization/site scope review |
| product_units | sale UOM | item_uoms | CANONICAL | convert free-text UOM usage to IDs |
| measurement_units | measurement master | uoms | CANONICAL | preferred canonical UOM master |
| units | older/generic unit master | uoms | LEGACY/REVIEW | prove callers; converge on one UOM master |
| product_unit_links | product -> semi-finished component | BOM lines | CANONICAL | migrate into recursive BOM |
| product_components | legacy components | BOM lines | LEGACY | no new writes; remove only after caller proof |
| recipes | sellable product recipe header | BOM header | CANONICAL | map to versioned BOM |
| recipe_items | direct raw components | BOM lines | CANONICAL | map to item components |
| inventory_unit_recipes | prep-unit raw components | BOM lines | CANONICAL | unify with recipe_items |
| inventory_unit_recipe_units | prep-unit nested components | BOM lines | CANONICAL | unify recursive BOM |
| product_modifier_groups | modifier definition | Catalog | CANONICAL | keep |
| product_modifier_options | modifier choices | Catalog | CANONICAL | keep |
| product_modifier_group_products | assignment | Catalog | CANONICAL | keep |
| product_modifier_inventory_effects | modifier stock recipe | BOM/Consumption | CANONICAL | normalize as component effect |
| product_cost_history | stored product cost history | Costing | PROJECTION/REVIEW | replace ambiguous cost_price history with cost-type history |
| raw_material_price_events | raw pricing observations | Costing | CANONICAL | keep as reference-cost event stream |

## 4. Inventory

| Current table | Current role | P-A class | V2 direction |
|---|---|---|---|
| inventory_ledger | cross-item movement ledger | CANONICAL | future immutable stock-movement source of truth |
| raw_material_batches | FIFO lots | CANONICAL | map to canonical inventory_lots |
| raw_material_inventory | raw balance/avg cost | PROJECTION | derived balance, not independent truth |
| inventory | finished-product balance | PROJECTION | derived balance, not independent truth |
| inventory_batches | product batches | LEGACY/REVIEW | converge into canonical lots |
| inventory_movements | older product movement layer | LEGACY/REVIEW | prove no active writers |
| raw_material_movements | older raw movement layer | LEGACY/REVIEW | prove no active writers |
| stock_transactions | older stock transaction layer | LEGACY/REVIEW | prove no active writers |
| inventory_unit_batches | semi-finished lots | CANONICAL | map to canonical lots |
| inventory_unit_entries | semi-finished ledger | CANONICAL/TRANSITIONAL | converge into common movement ledger |
| inventory_unit_entry_reversals | reversal trace | INTERNAL | preserve audit lineage |
| product_stock_debts | negative-stock debt | INTERNAL | keep implementation-private |
| inventory_unit_stock_debts | negative prep-stock debt | INTERNAL | keep implementation-private |
| raw_fifo_debts | raw negative FIFO debt | INTERNAL | keep implementation-private |
| raw_fifo_settlements | FIFO debt settlement | INTERNAL | keep implementation-private |
| raw_fifo_* | FIFO repair/backfill/rebase/COGS machinery | INTERNAL | never expose as business API |
| raw_opening_cost_repair_* | historical repair | INTERNAL | freeze after reconciliation |
| stock_counts | physical count document | CANONICAL | keep |
| stock_count_items | count lines | CANONICAL | future item_id/base UOM |
| warehouse_transfers | transfer document | CANONICAL | keep |
| warehouse_transfer_items | transfer lines | CANONICAL | future item_id/base UOM |
| waste_categories | waste master | CANONICAL | keep |
| waste_entries | waste document/lines | CANONICAL | normalize item identity |
| order_inventory_consumptions | order consumption trace | INTERNAL | preserve correlation, converge read model |
| sale_item_inventory_effects | sale inventory trace | INTERNAL | preserve audit/cost lineage |
| order_kitchen_inventory_effects | kitchen consumption trace | INTERNAL | preserve audit/cost lineage |
| order_kitchen_inventory_events | kitchen inventory events | INTERNAL | preserve idempotency/event lineage |

## 5. Production / recipes

| Current table | Current role | P-A class | V2 direction |
|---|---|---|---|
| production_orders | manufacturing document | CANONICAL | future item/BOM version references |
| production_waste | production variance/waste | CANONICAL | keep |
| inventory_unit_productions | prep production history | TRANSITIONAL | converge on production_orders |
| auto_sale_production_reversals | automatic reversal trace | INTERNAL | keep audit-only |

## 6. Sales / POS / Kitchen

| Current table | Current role | P-A class | V2 direction |
|---|---|---|---|
| orders | operational order | CANONICAL | keep operational, mutable until settlement |
| order_items | operational lines | CANONICAL | keep; snapshot modifiers/UOM |
| sales | posted commercial snapshot | CANONICAL | immutable-after-posting direction |
| sale_items | posted sale lines | CANONICAL | immutable snapshot |
| sale_payments | tender allocation to sale | CANONICAL/TRANSITIONAL | future generic payment + allocations |
| dining_areas | floor-plan area | CANONICAL | keep |
| dining_tables | service table | CANONICAL | keep |
| kitchen_stations | KDS routing | CANONICAL | keep |
| user_kitchen_station_assignments | KDS access/routing | CANONICAL | keep |
| order_kitchen_sends | incremental send trace | INTERNAL | keep for idempotency/audit |
| order_kitchen_voids | sent-item void trace | INTERNAL | keep |
| order_kitchen_served_quantities | served baseline | INTERNAL | keep |
| sale_print_events | fiscal/print trace | INTERNAL | keep |
| cloud_print_jobs | integration job | PLATFORM/INTEGRATION | keep outside sales truth |
| cloud_print_wake_state | print agent state | PLATFORM/INTEGRATION | keep |

## 7. Procurement / suppliers

| Current table | Current role | P-A class | V2 direction |
|---|---|---|---|
| suppliers | supplier master | CANONICAL | organization-level party master candidate |
| purchase_requests | requisition | CANONICAL | keep |
| purchase_request_items | requisition lines | CANONICAL | normalize item identity |
| rfqs | request for quotation | CANONICAL | keep |
| rfq_items | RFQ lines | CANONICAL | keep |
| supplier_quotations | supplier quote | CANONICAL | keep |
| supplier_quotation_items | quote lines | CANONICAL | keep |
| purchases | currently invoice/order hybrid | CANONICAL/TRANSITIONAL | split PO vs supplier invoice semantics |
| purchase_items | purchase lines | CANONICAL/TRANSITIONAL | future item_id/base UOM |
| purchase_receipts | goods receipt | CANONICAL | make independent GRN document |
| purchase_receipt_items | receipt lines | CANONICAL | quantity/lot/UOM truth |
| supplier_payments | supplier settlement | CANONICAL/TRANSITIONAL | future payment + allocations |

## 8. Customers / AR

| Current table | Current role | P-A class | V2 direction |
|---|---|---|---|
| customers | customer master | CANONICAL | organization-level party master candidate |
| customer_payments | customer settlement | CANONICAL/TRANSITIONAL | generic payment + allocation |
| business_records | generic records | REVIEW | define bounded ownership before expansion |

## 9. Accounting / treasury

| Current table | Current role | P-A class | V2 direction |
|---|---|---|---|
| chart_of_accounts | branch-scoped COA | CANONICAL/TRANSITIONAL | organization-level COA |
| account_mappings | semantic posting map | CANONICAL | evolve to org default + branch override |
| journal_entries | journal header | CANONICAL | add lifecycle/period/correlation |
| journal_entry_lines | double-entry lines | CANONICAL | add accounting dimensions |
| treasury_accounts | cash/bank/clearing | CANONICAL | keep, normalize organization/site scope |
| treasury_transactions | treasury movements | CANONICAL | keep |
| bank_reconciliations | reconciliation header | CANONICAL | keep |
| bank_statement_lines | reconciliation lines | CANONICAL | keep |
| expenses | expense document | CANONICAL | immutable posting/reversal direction |
| expense_routing_rules | expense->account mapping | CANONICAL | keep |
| employee_receivable_entries | employee receivable subledger | CANONICAL | keep if HR/finance scope retained |
| shift_operations | cashier cash movements | CANONICAL | keep |
| shifts | cashier shift | CANONICAL | keep |
| daily_closes | business-day close | CANONICAL | keep |
| business_day_state | operational business-day pointer | CANONICAL | formalize business_day identity |

## 10. SaaS platform / subscriptions

These are platform-domain tables and should not leak into restaurant ERP domain logic:

`plans`, `plan_prices`, `plan_features`, `features`,
`subscriptions`, `subscription_events`, `subscription_payments`,
`subscription_settings`, `subscription_plans`, `branch_subscriptions`,
`branch_feature_overrides`, `organization_feature_overrides`,
`support_conversations`, `support_messages`.

Class: **PLATFORM**.

## 11. Audit / metadata / technical

| Table | P-A class | Direction |
|---|---|---|
| audit_log | CANONICAL | evolve to uniform correlation/before/after/reason contract |
| document_sequences | CANONICAL | central numbering |
| schema_migrations | INTERNAL | migration metadata |
| raw_fifo_backfill_* | INTERNAL | historical repair machinery |
| raw_fifo_debt_rebase_* | INTERNAL | historical repair machinery |
| raw_fifo_*_adjustments | INTERNAL | valuation repair/audit |
| work_authorization_branch_bootstrap | INTERNAL | security bootstrap |

## 12. First canonicalization order

1. UOM identity and conversion contract.
2. Organization item identity + branch/site configuration mapping.
3. Inventory movement vocabulary and warehouse/base-UOM invariants.
4. Actual/Theoretical/Standard cost vocabulary.
5. Organization COA + accounting dimensions design.
6. Procurement document semantics.
7. Payment allocation model.

No cutover is authorized by this document.
