# WBS-00 route inventory — 2026-10-29

Baseline: `ab0900b342a4ddc16dd41052d18142d052b23106`. This is a lexical source inventory, not proof of deployed schema or runtime behavior. The main audit explains the domain mapping and WAN classification. The route table lists calls written directly in the page file; shared hooks, services, API wrappers, auth and other providers are indexed separately below. Blank cells do not mean offline support. Imports through API barrels are deliberately not expanded into every unrelated API domain. Generated route-matrix.json includes module closures as upper bounds; a listed dependency may be conditional or unused on a particular user action. Computed calls and SQL-trigger effects require manual review.

| Route / expression | Screen / redirect | Guard | Page-local relation literals | Page-local RPC literals |
|---|---|---|---|---|
| /login | [LoginPage](../../src/features/auth/pages/LoginPage.tsx) | see route guard | — | — |
| /register | [RegisterPage](../../src/features/auth/pages/RegisterPage.tsx) | see route guard | — | register_trial_tenant |
| /v2 | [V2GatewayPage](../../src/v2/pages/V2GatewayPage.tsx) | see route guard | — | — |
| /v2/pos | → /pos | pos.view | — | — |
| /v2/shifts | → /shifts | shifts.view | — | — |
| /dashboard | [DashboardPage](../../src/features/dashboard/pages/DashboardEnhancedPage.tsx) | dashboard.view | — | — |
| /operations | [OperationsCenterPage](../../src/features/operations/pages/OperationsCenterPage.tsx) | dashboard.view | — | — |
| /inventory-center | [InventoryCenterPage](../../src/features/inventory/pages/InventoryCenterPage.tsx) | inventory.view | — | — |
| /procurement-center | [ProcurementCenterPage](../../src/features/trade/pages/ProcurementCenterPage.tsx) | purchases.view | — | — |
| /people | [PeopleCenterPage](../../src/features/parties/pages/PeopleCenterPage.tsx) | ["customers.view", "suppliers.view"] | — | — |
| /finance | [FinanceCenterPage](../../src/features/accounting/pages/FinanceCenterPage.tsx) | ["accounts.view", "expenses.view", "sales.view", "shifts.view", "reports.view", "reports.financial", "reports.costing"] | — | — |
| /administration | [AdministrationCenterPage](../../src/features/admin/pages/AdministrationCenterPage.tsx) | ["branches.manage", "users.view", "roles.permissions.manage", "approvals.review", "audit.view", "settings.manage"] | — | — |
| /manufacturing-center | → /inventory-units | see route guard | — | — |
| /pos | [PosWorkspacePage](../../src/features/pos/pages/PosWorkspacePage.tsx) | pos.view | v_current_stock_position, product_unit_links, customers, categories, dining_areas, products | — |
| /pos/:orderId | [PosWorkspacePage](../../src/features/pos/pages/PosWorkspacePage.tsx) | pos.view | v_current_stock_position, product_unit_links, customers, categories, dining_areas, products | — |
| /delivery | → /pos | pos.view | — | — |
| /drive-thru | → /pos | pos.view | — | — |
| /floor-plan | [ActiveOrdersPage](../../src/features/pos/pages/ActiveOrdersPage.tsx) | floor_plan.view | dining_areas, products, dining_tables | — |
| /kitchen | → /kitchen-display | pos.kds_view | — | — |
| /tables | → /floor-plan | floor_plan.view | — | — |
| /products | [ProductsPage](../../src/features/catalog/pages/ProductsPage.tsx) | products.view | inventory, warehouses, categories, product_units, product_components, raw_materials, product_unit_links, inventory_units, products | — |
| /pricing | [PricingPage](../../src/features/catalog/pages/PricingPage.tsx) | products.view | raw_materials, inventory_units, products | — |
| /products/setup | [ProductSetupWizardPage](../../src/features/catalog/pages/ProductSetupWizardPage.tsx) | products.create | categories, inventory_units, raw_materials, products | — |
| /product-modifiers | [ProductModifiersPage](../../src/features/catalog/pages/ProductModifiersPage.tsx) | products.modifiers.manage | products, categories | — |
| /product-modifier-options | [ProductModifierOptionsPage](../../src/features/catalog/pages/ProductModifierOptionsPage.tsx) | products.modifiers.manage | — | — |
| /categories | [CategoriesPage](../../src/features/catalog/pages/CategoriesPage.tsx) | categories.view | categories | — |
| /components | → /products | see route guard | — | — |
| /inventory-units | [InventoryUnitsPage](../../src/features/catalog/pages/InventoryUnitsPage.tsx) | raw_materials.view | inventory_units, raw_materials, inventory_unit_recipes | — |
| /waste-center | [WasteCenterPage](../../src/features/inventory/pages/WasteCenterPage.tsx) | waste.view | products, waste_entries, inventory_units, warehouses, waste_categories | create_waste_entry, approve_waste, get_waste_report |
| /kitchen-display | [KitchenDisplayPage](../../src/features/inventory/pages/KitchenDisplayPage.tsx) | pos.kds_view | — | get_my_kitchen_stations, get_kitchen_queue |
| /kitchen-stations | [KitchenStationsPage](../../src/features/catalog/pages/KitchenStationsPage.tsx) | settings.manage | — | — |
| /stock-balances | [StockBalancesPage](../../src/features/inventory/pages/StockBalancesPage.tsx) | inventory.view | — | — |
| /inventory | [InventoryPage](../../src/features/inventory/pages/InventoryPage.tsx) | inventory.view | — | — |
| /warehouses | [WarehousesPage](../../src/features/inventory/pages/WarehousesPage.tsx) | warehouses.view | warehouses | — |
| /raw-materials | [RawMaterialsPage](../../src/features/manufacturing/pages/RawMaterialsPage.tsx) | raw_materials.view | raw_material_inventory, raw_material_batches, measurement_units, branches, raw_materials | — |
| /recipes | → /products | see route guard | — | — |
| /production | [ProductionOrdersPage](../../src/features/manufacturing/pages/ProductionOrdersPage.tsx) | production.view | inventory_units, warehouses, inventory_unit_productions | produce_inventory_unit |
| /production/units | → /inventory-units | see route guard | — | — |
| /transfers | [TransfersPage](../../src/features/inventory/pages/TransfersPage.tsx) | inventory.view | warehouses, raw_materials, branches, raw_material_warehouse_inventory | — |
| /inventory-ledger | [InventoryLedgerPage](../../src/features/inventory/pages/InventoryLedgerPage.tsx) | inventory.ledger.view | branches | search_inventory_ledger |
| /stock-counts | [StockCountsPage](../../src/features/inventory/pages/StockCountsPage.tsx) | inventory.view | branches, warehouses, products, raw_materials | — |
| /inventory-batches | [InventoryBatchesPage](../../src/features/inventory/pages/InventoryBatchesPage.tsx) | inventory.view | — | — |
| /stock-valuation | [StockValuationPage](../../src/features/inventory/pages/StockValuationPage.tsx) | inventory.ledger.view | branches, warehouses | get_stock_valuation |
| /low-stock-alerts | [LowStockAlertsPage](../../src/features/inventory/pages/LowStockAlertsPage.tsx) | inventory.view | branches, warehouses, suppliers, raw_material_inventory, products | — |
| /costing | [CostingCenterPage](../../src/features/costing/pages/CostingCenterPage.tsx) | reports.costing | branches, suppliers, raw_materials, measurement_units | — |
| /branches | [BranchesPage](../../src/features/admin/pages/BranchesPage.tsx) | branches.manage | branches | — |
| /purchases | [PurchasesPage](../../src/features/trade/pages/PurchasesPage.tsx) | purchases.view | suppliers, products, raw_materials, warehouses, measurement_units, purchase_items | — |
| /purchases/requests | [PurchaseRequestsPage](../../src/features/trade/pages/PurchaseRequestsPage.tsx) | purchases.requests | suppliers, products, raw_materials, purchase_request_items | — |
| /purchases/rfqs | [RfqsPage](../../src/features/trade/pages/RfqsPage.tsx) | purchases.rfq | suppliers, products, raw_materials, purchase_requests | — |
| /purchases/receiving | [ReceivingPage](../../src/features/trade/pages/ReceivingPage.tsx) | purchases.receiving | — | — |
| /customers | [CustomersPage](../../src/features/parties/pages/CustomersPage.tsx) | customers.view | customers | — |
| /business-records | [BusinessRecordsPage](../../src/features/operations/pages/BusinessRecordsPage.tsx) | ["customers.view", "suppliers.view", "products.view"] | business_records, customers, suppliers, products | — |
| /suppliers | [SuppliersPage](../../src/features/parties/pages/SuppliersPage.tsx) | suppliers.view | suppliers | — |
| /expenses | [ExpensesPage](../../src/features/trade/pages/ExpensesPage.tsx) | expenses.view | chart_of_accounts, treasury_accounts | — |
| /sales | [SalesPage](../../src/features/trade/pages/SalesPage.tsx) | sales.view | customers, sale_payments, settings, branch_settings, sales | request_manager_approval, change_sale_payment_method |
| /shifts | [ShiftsPage](../../src/features/trade/pages/ShiftsPage.tsx) | shifts.view | users | — |
| /reports | [ReportsCenterPage](../../src/features/reporting/pages/ReportsCenterPage.tsx) | ["reports.view", "reports.financial"] | — | — |
| /financial-reports | [ReportsCenterPage](../../src/features/reporting/pages/ReportsCenterPage.tsx) | reports.financial | — | — |
| /accounting | → /financial-reports | reports.financial | — | — |
| /accounts | [AccountsPage](../../src/features/accounting/pages/AccountsPage.tsx) | accounts.view | chart_of_accounts | — |
| /opening-balances | [OpeningBalancesPage](../../src/features/accounting/pages/OpeningBalancesPage.tsx) | accounts.view | — | — |
| /employee-receivables | [EmployeeReceivablesPage](../../src/features/accounting/pages/EmployeeReceivablesPage.tsx) | accounts.view | customers | get_employee_receivable_balances, receive_employee_receivable_payment |
| /payments | [PaymentsPage](../../src/features/accounting/pages/PaymentsPage.tsx) | accounts.view | sales, purchases | — |
| /journal | [JournalPage](../../src/features/accounting/pages/JournalPage.tsx) | accounts.view | chart_of_accounts | — |
| /treasury | [TreasuryPage](../../src/features/accounting/pages/TreasuryPage.tsx) | accounts.view | — | — |
| /reconciliation | [ReconciliationPage](../../src/features/accounting/pages/ReconciliationPage.tsx) | accounts.view | treasury_accounts | — |
| /users | [UsersPage](../../src/features/admin/pages/UsersPage.tsx) | users.view | users | get_user_branch_access, set_user_branch_access |
| /permissions | [PermissionsPage](../../src/features/admin/pages/PermissionsPage.tsx) | roles.permissions.manage | — | — |
| /employees | → /users | users.view | — | — |
| /approvals | [ApprovalCenterPage](../../src/features/admin/pages/ApprovalCenterPage.tsx) | approvals.review | approval_policies, users | get_operational_approval_queue, decide_operational_approval |
| /audit-log | [AuditLogPage](../../src/features/reporting/pages/AuditLogPage.tsx) | audit.view | — | — |
| /settings | [SettingsControlCenterPage](../../src/features/admin/pages/SettingsControlCenterPage.tsx) | settings.manage | users | — |
| /super-admin | [SuperAdminConsolePage](../../src/features/admin/pages/SuperAdminConsolePage.tsx) | see route guard | system_settings, audit_logs, users, audit_log, branches, organizations, organization_members | — |
| /settings/basic | → /settings | settings.manage | — | — |
| /system-health | [SystemHealthPage](../../src/features/admin/pages/SystemHealthPage.tsx) | settings.manage | — | — |
| /import-export | [ImportExportCenterPage](../../src/features/import-export/pages/ImportExportCenterPage.tsx) | settings.manage | products, categories, raw_materials, suppliers, customers, warehouses, branches, users | — |
| * | router/redirect | see route guard | — | — |

## Direct call inventory

### [src/api/domains/accounting.ts](../../src/api/domains/accounting.ts)

| Line | Kind | Name |
|---|---|---|
| 106 | rpc-literal | get_erp_agent_readiness_context_v2 |
| 109 | rpc-literal | get_organization_account_sync_workbench_v2 |
| 112 | rpc-literal | request_organization_account_sync_v2 |
| 115 | rpc-literal | decide_organization_account_sync_v2 |
| 130 | rpc-literal | post_shift_expense |
| 133 | rpc-literal | reverse_shift_expense |
| 148 | rpc-literal | edit_shift_expense |
| 162 | rpc-literal | get_expense_routing_rules |
| 172 | rpc-literal | upsert_expense_routing_rule |
| 174 | rpc-literal | get_trial_balance |
| 175 | rpc-literal | preview_opening_balances |
| 176 | rpc-literal | seed_opening_balances |
| 177 | rpc-literal | get_journals |
| 178 | rpc-literal | post_manual_journal |
| 185 | rpc-literal | reverse_journal_entry |
| 188 | rpc-literal | set_accounting_period_status |
| 190 | rpc-literal | get_ar_aging |
| 191 | rpc-literal | get_ap_aging |
| 192 | rpc-literal | get_supplier_statement |
| 193 | rpc-literal | link_employee_credit_account |
| 194 | rpc-literal | get_employee_credit_balances |
| 195 | rpc-literal | receive_payment |
| 196 | rpc-literal | receive_employee_credit_payment |
| 197 | rpc-literal | pay_supplier |
| 198 | rpc-literal | pay_supplier_from_treasury |
| 199 | rpc-literal | get_treasury_balances |
| 200 | rpc-literal | get_accessible_treasury_accounts |
| 238 | rpc-literal | get_branch_treasury_day_close_reconciliation |
| 239 | rpc-literal | process_transfer |
| 240 | rpc-literal | process_treasury_transfer_v2 |
| 241 | rpc-literal | process_treasury_deposit |
| 242 | rpc-literal | process_treasury_withdrawal |
| 243 | rpc-literal | get_bank_reconciliation |
| 244 | rpc-literal | create_bank_reconciliation |
| 245 | rpc-literal | add_statement_line |
| 246 | rpc-literal | match_bank_line |
| 247 | rpc-literal | complete_bank_reconciliation |

### [src/api/domains/admin.ts](../../src/api/domains/admin.ts)

| Line | Kind | Name |
|---|---|---|
| 6 | rpc-literal | create_user |
| 7 | rpc-literal | update_user_password |
| 8 | rpc-literal | delete_user |
| 9 | rpc-literal | get_login_email |
| 10 | rpc-literal | record_login_failure |
| 11 | rpc-literal | record_login_success |
| 12 | rpc-literal | seed_demo_data |
| 13 | rpc-literal | delete_demo_data |
| 14 | rpc-literal | admin_data_delete_section |
| 15 | rpc-literal | admin_data_seed_all |
| 16 | rpc-literal | can_create_new_user |
| 17 | rpc-literal | toggle_user_creation_setting |
| 18 | rpc-literal | get_financial_visibility_settings |
| 19 | rpc-literal | update_financial_visibility_settings |
| 20 | rpc-literal | bootstrap_initial_super_admin |
| 21 | rpc-literal | get_super_admin_tenant_stats |
| 36 | rpc-literal | super_admin_create_organization_from_profile |
| 37 | rpc-literal | toggle_organization_status |
| 42 | rpc-literal | super_admin_preview_organization_deletion |
| 47 | rpc-literal | super_admin_queue_organization_deletion |
| 48 | rpc-literal | super_admin_organization_deletion_status |
| 49 | rpc-literal | get_organization_module_catalog |
| 50 | rpc-literal | super_admin_set_organization_module |
| 51 | rpc-literal | get_system_health_snapshot |
| 66 | rpc-literal | subscription_settings_get |
| 79 | rpc-literal | subscription_settings_update |
| 86 | rpc-literal | super_admin_change_subscription |

### [src/api/domains/branches.ts](../../src/api/domains/branches.ts)

| Line | Kind | Name |
|---|---|---|
| 13 | rpc-literal | create_organization_branch |
| 24 | rpc-literal | update_branch |
| 28 | rpc-literal | deactivate_branch |
| 32 | rpc-literal | delete_branch_cascade |

### [src/api/domains/catalog.ts](../../src/api/domains/catalog.ts)

| Line | Kind | Name |
|---|---|---|
| 192 | relation-literal | canonical_item_catalog |
| 203 | relation-literal | canonical_item_reconciliation |
| 214 | relation-literal | inventory_units |
| 225 | relation-literal | recipes |
| 238 | relation-literal | recipe_items |
| 273 | relation-literal | recipes |
| 309 | relation-literal | recipes |
| 322 | relation-literal | recipe_items |
| 334 | relation-literal | product_unit_links |
| 344 | relation-literal | product_unit_links |
| 351 | relation-literal | product_unit_links |
| 357 | relation-literal | product_unit_links |
| 374 | relation-literal | kitchen_stations |
| 380 | relation-literal | kitchen_stations |
| 386 | relation-literal | kitchen_stations |
| 392 | relation-literal | kitchen_stations |
| 145 | rpc-literal | replace_product_units |
| 146 | rpc-literal | create_raw_material |
| 147 | rpc-literal | create_product |
| 149 | rpc-literal | get_product_operational_composition |
| 152 | rpc-literal | get_product_live_costs |
| 154 | rpc-literal | get_kitchen_order_context |
| 156 | rpc-literal | complete_stale_kitchen_orders |
| 165 | rpc-literal | get_kitchen_completed_history |
| 167 | rpc-literal | get_product_modifiers |
| 169 | rpc-literal | get_product_modifiers_admin |
| 171 | rpc-literal | save_product_modifiers |
| 173 | rpc-literal | list_modifier_groups_admin |
| 176 | rpc-literal | save_modifier_group |
| 184 | rpc-literal | archive_modifier_group |
| 286 | rpc-literal | delete_recipe_controlled |
| 294 | rpc-literal | update_recipe_with_items |
| 326 | rpc-literal | delete_recipe_controlled |
| 365 | rpc-literal | produce_inventory_unit |
| 397 | rpc-literal | get_kitchen_station_assignments |
| 401 | rpc-literal | get_kitchen_station_editor_context |
| 405 | rpc-literal | save_kitchen_station_assignments |
| 414 | rpc-literal | set_kitchen_status |

### [src/api/domains/costing.ts](../../src/api/domains/costing.ts)

| Line | Kind | Name |
|---|---|---|
| 144 | rpc-literal | get_item_costing_v2 |
| 154 | rpc-literal | get_sale_cost_variance_v2 |
| 170 | rpc-literal | get_purchase_cost_variance_v2 |
| 180 | rpc-literal | get_costing_snapshot_health_v2 |
| 188 | rpc-literal | get_cost_variance_summary_v2 |
| 195 | rpc-literal | get_item_standard_cost_history |
| 211 | rpc-literal | set_item_standard_cost |
| 213 | rpc-literal | get_costing_overview |
| 214 | rpc-literal | get_product_costing_detail |
| 215 | rpc-literal | get_cost_history |
| 216 | rpc-literal | get_supplier_price_impact |
| 217 | rpc-literal | get_order_margin |
| 218 | rpc-literal | get_costing_sales_summary |
| 219 | rpc-literal | get_raw_material_cost_valuation_overview |
| 220 | rpc-literal | get_raw_material_cost_history |
| 221 | rpc-literal | get_raw_consumption_cost_breakdown |
| 222 | rpc-literal | set_raw_material_price |

### [src/api/domains/floorPlan.ts](../../src/api/domains/floorPlan.ts)

| Line | Kind | Name |
|---|---|---|
| 11 | rpc-literal | floor_plan_create_area |
| 14 | rpc-literal | floor_plan_rename_area |
| 17 | rpc-literal | floor_plan_delete_area |
| 48 | rpc-literal | create_service_order |
| 56 | rpc-literal | create_order |
| 60 | rpc-literal | set_order_status |
| 91 | rpc-literal | update_service_order |
| 96 | rpc-literal | update_order |
| 107 | rpc-literal | floor_plan_add_table |
| 118 | rpc-literal | floor_plan_update_table |
| 125 | rpc-literal | floor_plan_set_main_area_table_count |
| 132 | rpc-literal | set_table_status |
| 136 | rpc-literal | detach_order |
| 150 | rpc-literal | transfer_order_operator |

### [src/api/domains/inventory.ts](../../src/api/domains/inventory.ts)

| Line | Kind | Name |
|---|---|---|
| 13 | rpc-literal | adjust_stock |
| 14 | rpc-literal | adjust_raw_stock |
| 15 | rpc-literal | create_warehouse_transfer |
| 16 | rpc-literal | approve_warehouse_transfer |
| 17 | rpc-literal | reject_warehouse_transfer |
| 18 | rpc-literal | create_stock_count |
| 19 | rpc-literal | add_stock_count_item |
| 20 | rpc-literal | update_stock_count_item |
| 21 | rpc-literal | remove_stock_count_item |
| 22 | rpc-literal | submit_stock_count |
| 23 | rpc-literal | approve_stock_count |
| 24 | rpc-literal | reject_stock_count |
| 25 | rpc-literal | apply_stock_count |
| 26 | rpc-literal | add_inventory_batch |
| 27 | rpc-literal | get_low_stock_alerts |
| 28 | rpc-literal | get_low_stock_summary |
| 29 | rpc-literal | get_stock_valuation |
| 30 | rpc-literal | get_stock_valuation_summary |
| 31 | rpc-literal | get_expiring_batches |

### [src/api/domains/pos.ts](../../src/api/domains/pos.ts)

| Line | Kind | Name |
|---|---|---|
| 35 | relation-literal | shifts |
| 27 | rpc-literal | get_active_shift |
| 63 | rpc-literal | send_to_kitchen |
| 64 | rpc-literal | next_sale_document_number |
| 66 | rpc-literal | transfer_order_item_to_table |
| 69 | rpc-literal | transfer_order_items_to_table |
| 72 | rpc-literal | perform_pos_order_action |
| 76 | rpc-literal | list_pos_order_transfer_targets |
| 79 | rpc-literal | enqueue_cloud_open_order_print |
| 104 | rpc-literal | process_sale |
| 130 | rpc-literal | process_sale_idempotent |
| 141 | rpc-literal | request_manual_payment_approval |
| 154 | rpc-literal | manual_payment_approval_status |
| 180 | rpc-literal | process_sale_manual_payment |
| 189 | rpc-literal | reconcile_offline_sale |
| 214 | rpc-literal | process_sale_split_idempotent |
| 240 | rpc-literal | process_sale_split |

### [src/api/domains/procurement.ts](../../src/api/domains/procurement.ts)

| Line | Kind | Name |
|---|---|---|
| 6 | rpc-literal | create_purchase_request |
| 7 | rpc-literal | update_purchase_request_status |
| 8 | rpc-literal | create_rfq |
| 9 | rpc-literal | update_rfq_status |
| 10 | rpc-literal | record_supplier_quotation |
| 11 | rpc-literal | select_supplier_quotation |
| 12 | rpc-literal | get_rfq_comparison |
| 13 | rpc-literal | create_purchase_order |
| 14 | rpc-literal | update_purchase_order_status |
| 15 | rpc-literal | receive_purchase_order |
| 16 | rpc-literal | get_purchase_backorders |
| 17 | rpc-literal | get_purchase_receipts |
| 18 | rpc-literal | get_supplier_evaluation |

### [src/api/domains/reporting.ts](../../src/api/domains/reporting.ts)

| Line | Kind | Name |
|---|---|---|
| 6 | rpc-literal | get_trial_balance |
| 7 | rpc-literal | get_trial_balance_summary |
| 8 | rpc-literal | get_general_ledger |
| 9 | rpc-literal | get_income_statement |
| 10 | rpc-literal | get_balance_sheet |
| 11 | rpc-literal | get_ar_aging |
| 12 | rpc-literal | get_ap_aging |
| 13 | rpc-literal | get_aging_summary |
| 14 | rpc-literal | get_cash_flow |
| 15 | rpc-literal | get_party_statement |
| 16 | rpc-literal | get_treasury_account_statement |
| 17 | rpc-literal | get_inventory_item_statement |
| 18 | rpc-literal | get_sales_by_payment_report |
| 19 | rpc-literal | get_financial_reconciliation_report |
| 20 | rpc-literal | get_dashboard_sales_snapshot |
| 22 | rpc-literal | get_day_closing_range_report |
| 23 | rpc-literal | get_raw_material_consumption_report |
| 24 | rpc-literal | get_current_raw_material_valuation |
| 25 | rpc-literal | get_raw_material_financial_report |
| 26 | rpc-literal | get_sales_component_reconciliation_report |

### [src/api/domains/shifts.ts](../../src/api/domains/shifts.ts)

| Line | Kind | Name |
|---|---|---|
| 12 | rpc-literal | open_shift |
| 16 | rpc-literal | close_shift |
| 20 | rpc-literal | day_close |
| 24 | rpc-literal | get_shift_closing_report |
| 28 | rpc-literal | get_shift_sale_tenders |
| 32 | rpc-literal | enqueue_cloud_report_print |
| 37 | rpc-literal | get_day_closing_report |
| 41 | rpc-literal | get_current_business_day |
| 45 | rpc-literal | try_auto_close_branch_shift |
| 49 | rpc-literal | close_shift_with_open_orders |
| 53 | rpc-literal | force_close_shift |
| 57 | rpc-literal | authorize_open_drawer |

### [src/api/domains/support.ts](../../src/api/domains/support.ts)

| Line | Kind | Name |
|---|---|---|
| 41 | rpc-literal | support_open_conversation |
| 44 | rpc-literal | support_list_my_conversations |
| 47 | rpc-literal | support_list_all_conversations |
| 50 | rpc-literal | support_get_messages |
| 53 | rpc-literal | support_send_message |
| 56 | rpc-literal | support_set_conversation_status |

### [src/api/domains/trade.ts](../../src/api/domains/trade.ts)

| Line | Kind | Name |
|---|---|---|
| 6 | rpc-literal | next_purchase_document_number |
| 9 | rpc-literal | process_purchase |
| 13 | rpc-literal | update_purchase_invoice |
| 15 | rpc-literal | delete_purchase_invoice |
| 16 | rpc-literal | process_purchase_return |
| 17 | rpc-literal | process_refund |
| 18 | rpc-literal | archive_returned_sale |

### [src/components/ApprovalInbox.tsx](../../src/components/ApprovalInbox.tsx)

| Line | Kind | Name |
|---|---|---|
| 171 | relation-literal | approval_requests |
| 179 | relation-literal | cloud_print_jobs |
| 193 | relation-literal | users |
| 235 | rpc-literal | decide_manager_approval |

### [src/components/BranchScopeSelector.tsx](../../src/components/BranchScopeSelector.tsx)

| Line | Kind | Name |
|---|---|---|
| 23 | relation-literal | organizations |

### [src/context/AuthContext.tsx](../../src/context/AuthContext.tsx)

| Line | Kind | Name |
|---|---|---|
| 46 | relation-literal | users |
| 61 | auth-method | signOut |
| 104 | auth-method | refreshSession |
| 117 | auth-method | signOut |
| 132 | auth-method | getSession |
| 140 | auth-method | onAuthStateChange |
| 168 | auth-method | getSession |
| 177 | auth-method | refreshSession |
| 188 | auth-method | signOut |
| 205 | auth-method | signInWithPassword |
| 230 | auth-method | signInWithPassword |
| 240 | auth-method | signOut |
| 245 | auth-method | getSession |
| 251 | auth-method | refreshSession |
| 263 | auth-method | signOut |
| 198 | api-call | admin.recordLoginSuccess |
| 208 | api-call | admin.recordLoginFailure |
| 220 | api-call | admin.getLoginEmail |
| 232 | api-call | admin.recordLoginFailure |

### [src/context/OfflineContext.tsx](../../src/context/OfflineContext.tsx)

| Line | Kind | Name |
|---|---|---|
| 160 | auth-method | getSession |

### [src/context/RolesContext.tsx](../../src/context/RolesContext.tsx)

| Line | Kind | Name |
|---|---|---|
| 59 | relation-literal | roles |
| 161 | relation-literal | roles |
| 162 | relation-literal | roles |
| 181 | relation-literal | roles |
| 205 | relation-literal | users |
| 210 | relation-literal | roles |

### [src/context/SettingsContext.tsx](../../src/context/SettingsContext.tsx)

| Line | Kind | Name |
|---|---|---|
| 80 | relation-literal | settings |
| 81 | relation-literal | branch_settings |
| 243 | relation-literal | settings |
| 277 | relation-literal | branch_settings |
| 278 | relation-literal | branch_settings |
| 172 | rpc-literal | try_auto_close_branch_shift |

### [src/core/modules/OrganizationModulesContext.tsx](../../src/core/modules/OrganizationModulesContext.tsx)

| Line | Kind | Name |
|---|---|---|
| 185 | relation-literal | organizations |
| 181 | rpc-literal | get_organization_module_catalog |
| 190 | rpc-literal | subscription_status |

### [src/core/offline/syncEngine.ts](../../src/core/offline/syncEngine.ts)

| Line | Kind | Name |
|---|---|---|
| 184 | auth-method | getSession |

### [src/core/repositories/CustomerRepository.ts](../../src/core/repositories/CustomerRepository.ts)

| Line | Kind | Name |
|---|---|---|
| 12 | relation-literal | customers |
| 50 | relation-literal | customers |

### [src/core/repositories/ProductRepository.ts](../../src/core/repositories/ProductRepository.ts)

| Line | Kind | Name |
|---|---|---|
| 99 | relation-literal | products |
| 113 | relation-literal | categories |

### [src/core/repositories/warehouseSnapshotRefresh.ts](../../src/core/repositories/warehouseSnapshotRefresh.ts)

| Line | Kind | Name |
|---|---|---|
| 106 | relation-literal | inventory |

### [src/core/security/SessionProfileGuard.tsx](../../src/core/security/SessionProfileGuard.tsx)

| Line | Kind | Name |
|---|---|---|
| 79 | relation-literal | users |
| 89 | auth-method | refreshSession |

### [src/features/accounting/components/EmployeeCreditPanel.tsx](../../src/features/accounting/components/EmployeeCreditPanel.tsx)

| Line | Kind | Name |
|---|---|---|
| 59 | relation-literal | users |
| 60 | relation-literal | customers |
| 45 | api-call | accounting.getEmployeeCreditBalances |
| 69 | api-call | accounting.linkEmployeeCreditAccount |
| 83 | api-call | accounting.receiveEmployeeCreditPayment |

### [src/features/accounting/pages/AccountsPage.tsx](../../src/features/accounting/pages/AccountsPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 102 | relation-literal | chart_of_accounts |
| 106 | relation-literal | chart_of_accounts |
| 117 | relation-literal | chart_of_accounts |
| 55 | relation-via-pagination | chart_of_accounts |
| 70 | api-call | accounting.getTrialBalance |

### [src/features/accounting/pages/EmployeeReceivableDetailPage.tsx](../../src/features/accounting/pages/EmployeeReceivableDetailPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 76 | relation-literal | customers |
| 95 | rpc-literal | get_employee_receivable_balances |
| 99 | rpc-literal | get_party_statement |

### [src/features/accounting/pages/EmployeeReceivablesPage.tsx](../../src/features/accounting/pages/EmployeeReceivablesPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 82 | relation-literal | customers |
| 140 | relation-literal | customers |
| 87 | rpc-literal | get_employee_receivable_balances |
| 170 | rpc-literal | receive_employee_receivable_payment |

### [src/features/accounting/pages/FinancialReportsPage.tsx](../../src/features/accounting/pages/FinancialReportsPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 114 | relation-literal | chart_of_accounts |
| 127 | relation-literal | treasury_accounts |
| 143 | relation-literal | warehouses |
| 157 | relation-literal | customers |
| 170 | relation-literal | suppliers |
| 212 | api-call | reporting.getTrialBalance |
| 240 | api-call | reporting.getGeneralLedger |
| 249 | api-call | reporting.getTreasuryAccountStatement |
| 258 | api-call | reporting.getInventoryItemStatement |
| 269 | api-call | reporting.getIncomeStatement |
| 283 | api-call | reporting.getBalanceSheet |
| 297 | api-call | reporting.getArAging |
| 303 | api-call | reporting.getApAging |
| 309 | api-call | reporting.getAgingSummary |
| 331 | api-call | reporting.getCashFlow |
| 336 | api-call | reporting.getPartyStatement |

### [src/features/accounting/pages/JournalPage.tsx](../../src/features/accounting/pages/JournalPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 114 | relation-literal | chart_of_accounts |
| 92 | api-call | accounting.getJournals |
| 174 | api-call | accounting.postManualJournal |

### [src/features/accounting/pages/OpeningBalancesPage.tsx](../../src/features/accounting/pages/OpeningBalancesPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 51 | api-call | accounting.previewOpeningBalances |
| 70 | api-call | accounting.seedOpeningBalances |

### [src/features/accounting/pages/PaymentsPage.tsx](../../src/features/accounting/pages/PaymentsPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 125 | relation-literal | sales |
| 155 | relation-literal | purchases |
| 44 | relation-via-pagination | customer_payments |
| 53 | relation-via-pagination | supplier_payments |
| 83 | api-call | accounting.getArAging |
| 89 | api-call | accounting.getApAging |
| 106 | api-call | accounting.getAccessibleTreasuryAccounts |
| 173 | api-call | accounting.receivePayment |
| 201 | api-call | accounting.paySupplierFromTreasury |
| 226 | api-call | accounting.getAccessibleTreasuryAccounts |

### [src/features/accounting/pages/ReconciliationPage.tsx](../../src/features/accounting/pages/ReconciliationPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 67 | relation-literal | treasury_accounts |
| 45 | relation-via-pagination | bank_reconciliations |
| 79 | api-call | accounting.getBankReconciliation |
| 92 | api-call | accounting.createBankReconciliation |
| 113 | api-call | accounting.addStatementLine |
| 134 | api-call | accounting.matchBankLine |
| 149 | api-call | accounting.completeBankReconciliation |

### [src/features/accounting/pages/TreasuryPage.tsx](../../src/features/accounting/pages/TreasuryPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 112 | relation-via-pagination | treasury_transactions |
| 137 | api-call | accounting.getAccessibleTreasuryAccounts |
| 138 | api-call | accounting.getBranchTreasuryDayCloseReconciliation |
| 201 | api-call | accounting.processTreasuryTransferV2 |
| 209 | api-call | accounting.processTreasuryDeposit |
| 217 | api-call | accounting.processTreasuryWithdrawal |

### [src/features/admin/pages/ApprovalCenterPage.tsx](../../src/features/admin/pages/ApprovalCenterPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 195 | relation-literal | approval_policies |
| 196 | relation-literal | users |
| 208 | relation-literal | approval_policies |
| 223 | relation-literal | approval_policies |
| 228 | relation-literal | approval_policies |
| 59 | rpc-literal | get_operational_approval_queue |
| 80 | rpc-literal | decide_operational_approval |

### [src/features/admin/pages/BranchesPage.tsx](../../src/features/admin/pages/BranchesPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 43 | relation-literal | branches |
| 27 | relation-via-pagination | branches |

### [src/features/admin/pages/SettingsControlCenterPage.tsx](../../src/features/admin/pages/SettingsControlCenterPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 97 | relation-literal | users |

### [src/features/admin/pages/SubscriptionManagementTab.tsx](../../src/features/admin/pages/SubscriptionManagementTab.tsx)

| Line | Kind | Name |
|---|---|---|
| 127 | relation-literal | organizations |
| 128 | relation-literal | plans |
| 129 | relation-literal | plan_prices |
| 130 | relation-literal | subscriptions |
| 269 | relation-literal | plan_prices |

### [src/features/admin/pages/SuperAdminConsolePage.tsx](../../src/features/admin/pages/SuperAdminConsolePage.tsx)

| Line | Kind | Name |
|---|---|---|
| 168 | relation-literal | system_settings |
| 176 | relation-literal | audit_logs |
| 264 | relation-literal | users |
| 265 | relation-literal | audit_log |
| 266 | relation-literal | branches |
| 267 | relation-literal | organizations |
| 268 | relation-literal | organization_members |
| 474 | relation-literal | users |
| 507 | relation-literal | users |
| 527 | relation-literal | system_settings |
| 517 | auth-method | getUser |

### [src/features/admin/pages/UsersPage.tsx](../../src/features/admin/pages/UsersPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 170 | relation-literal | users |
| 76 | rpc-literal | get_user_branch_access |
| 130 | rpc-literal | set_user_branch_access |
| 189 | rpc-literal | set_user_branch_access |
| 44 | relation-via-pagination | users |
| 106 | api-call | admin.createUser |
| 175 | api-call | admin.updateUserPassword |
| 215 | api-call | admin.deleteUser |

### [src/features/admin/work-authorization/supabaseWorkAuthorizationProvider.ts](../../src/features/admin/work-authorization/supabaseWorkAuthorizationProvider.ts)

| Line | Kind | Name |
|---|---|---|
| 47 | rpc-via-wrapper-feature-gated | get_work_authorization_snapshot |
| 54 | rpc-via-wrapper-feature-gated | get_my_work_authorization_state |
| 61 | rpc-via-wrapper-feature-gated | request_work_authorization |
| 68 | rpc-via-wrapper-feature-gated | decide_work_authorization |
| 80 | rpc-via-wrapper-feature-gated | decide_work_authorization |
| 92 | rpc-via-wrapper-feature-gated | revoke_work_authorization |
| 103 | rpc-via-wrapper-feature-gated | set_work_authorization_requirement |
| 115 | auth-method | getSession |

### [src/features/auth/pages/RegisterPage.tsx](../../src/features/auth/pages/RegisterPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 50 | rpc-literal | register_trial_tenant |

### [src/features/catalog/pages/CategoriesPage.tsx](../../src/features/catalog/pages/CategoriesPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 50 | relation-literal | categories |
| 54 | relation-literal | categories |
| 65 | relation-literal | categories |
| 76 | relation-literal | categories |
| 29 | relation-via-pagination | categories |

### [src/features/catalog/pages/InventoryUnitsPage.tsx](../../src/features/catalog/pages/InventoryUnitsPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 113 | relation-literal | inventory_units |
| 117 | relation-literal | inventory_units |
| 132 | relation-literal | raw_materials |
| 138 | relation-literal | inventory_unit_recipes |
| 157 | relation-literal | inventory_unit_recipes |
| 160 | relation-literal | inventory_unit_recipes |
| 174 | relation-literal | inventory_units |
| 178 | relation-literal | inventory_units |
| 66 | relation-via-pagination | inventory_units |

### [src/features/catalog/pages/PricingPage.tsx](../../src/features/catalog/pages/PricingPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 106 | relation-literal | raw_materials |
| 113 | relation-literal | inventory_units |
| 121 | relation-literal | products |
| 212 | relation-literal | inventory_units |
| 242 | relation-literal | products |

### [src/features/catalog/pages/ProductModifierOptionsPage.tsx](../../src/features/catalog/pages/ProductModifierOptionsPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 54 | api-call | catalog.listInventoryUnits |
| 55 | api-call | catalog.listModifierGroupsAdmin |

### [src/features/catalog/pages/ProductModifiersPage.tsx](../../src/features/catalog/pages/ProductModifiersPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 138 | relation-literal | products |
| 139 | relation-literal | categories |
| 140 | api-call | catalog.listModifierGroupsAdmin |
| 141 | api-call | catalog.listInventoryUnits |
| 291 | api-call | catalog.saveModifierGroup |
| 316 | api-call | catalog.archiveModifierGroup |

### [src/features/catalog/pages/ProductSetupWizardPage.tsx](../../src/features/catalog/pages/ProductSetupWizardPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 112 | relation-literal | categories |
| 114 | relation-literal | inventory_units |
| 117 | relation-literal | raw_materials |
| 233 | relation-literal | products |
| 260 | relation-literal | products |
| 212 | api-call | catalog.createProduct |
| 239 | api-call | catalog.saveProductDirectRawComponents |

### [src/features/catalog/pages/ProductsPage.tsx](../../src/features/catalog/pages/ProductsPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 134 | relation-literal | inventory |
| 136 | relation-literal | warehouses |
| 153 | relation-literal | categories |
| 176 | relation-literal | product_units |
| 178 | relation-literal | product_components |
| 225 | relation-literal | raw_materials |
| 247 | relation-literal | product_unit_links |
| 250 | relation-literal | inventory_units |
| 286 | relation-literal | products |
| 349 | relation-literal | product_components |
| 352 | relation-literal | product_components |
| 403 | relation-literal | products |
| 407 | relation-literal | products |
| 438 | relation-literal | products |
| 65 | relation-via-pagination | products |
| 118 | api-call | catalog.getProductLiveCosts |
| 189 | api-call | catalog.getProductOperationalComposition |
| 224 | api-call | catalog.getProductDirectRawComponents |
| 289 | api-call | catalog.replaceProductUnits |
| 293 | api-call | catalog.createProduct |
| 322 | api-call | catalog.setProductUnitLinks |
| 324 | api-call | catalog.saveProductDirectRawComponents |

### [src/features/costing/pages/CostingCenterPage.tsx](../../src/features/costing/pages/CostingCenterPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 62 | relation-literal | branches |
| 70 | relation-literal | suppliers |
| 79 | relation-literal | raw_materials |
| 80 | relation-literal | measurement_units |
| 102 | api-call | costing.getOverview |
| 103 | api-call | costing.getSalesSummary |
| 104 | api-call | costing.getRawMaterialCostOverview |
| 128 | api-call | costing.getOrderMargin |
| 138 | api-call | costing.getSupplierPriceImpact |
| 147 | api-call | costing.getRawMaterialCostOverview |
| 174 | api-call | costing.getCostVarianceSummaryV2 |
| 179 | api-call | costing.getSaleCostVarianceV2 |
| 186 | api-call | costing.getPurchaseCostVarianceV2 |
| 213 | api-call | costing.getRawMaterialCostHistory |
| 239 | api-call | costing.getProductDetail |
| 434 | api-call | costing.getProductDetail |

### [src/features/dashboard/components/DashboardStandbyBar.tsx](../../src/features/dashboard/components/DashboardStandbyBar.tsx)

| Line | Kind | Name |
|---|---|---|
| 247 | relation-literal | audit_log |

### [src/features/dashboard/pages/DashboardDataPage.tsx](../../src/features/dashboard/pages/DashboardDataPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 286 | relation-literal | sales |
| 287 | relation-literal | sales |
| 315 | relation-literal | sale_items |
| 343 | relation-literal | raw_materials |
| 344 | relation-literal | raw_material_inventory |
| 345 | relation-literal | inventory_units |
| 346 | relation-literal | inventory_unit_batches |
| 394 | relation-literal | orders |
| 405 | relation-literal | purchases |
| 413 | relation-literal | expenses |
| 422 | relation-literal | business_records |

### [src/features/dashboard/pages/DashboardExecutiveInsightsV2.tsx](../../src/features/dashboard/pages/DashboardExecutiveInsightsV2.tsx)

| Line | Kind | Name |
|---|---|---|
| 59 | relation-literal | sales |
| 60 | relation-literal | inventory |
| 69 | relation-literal | sale_payments |

### [src/features/dashboard/pages/VisualDashboardPage.tsx](../../src/features/dashboard/pages/VisualDashboardPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 132 | relation-literal | sales |
| 133 | relation-literal | sales |
| 134 | relation-literal | inventory |
| 143 | relation-literal | sale_items |
| 201 | relation-literal | sales |
| 202 | relation-literal | inventory |
| 148 | rpc-literal | get_waste_report |

### [src/features/dashboard/services/dashboardPayments.ts](../../src/features/dashboard/services/dashboardPayments.ts)

| Line | Kind | Name |
|---|---|---|
| 99 | relation-literal | sale_payments |

### [src/features/import-export/export-service.ts](../../src/features/import-export/export-service.ts)

| Line | Kind | Name |
|---|---|---|
| 84 | relation-literal | products |
| 111 | relation-literal | categories |
| 123 | relation-literal | raw_materials |
| 144 | relation-literal | recipe_items |
| 160 | relation-literal | suppliers |
| 176 | relation-literal | customers |
| 192 | relation-literal | purchase_items |

### [src/features/import-export/import-executor.ts](../../src/features/import-export/import-executor.ts)

| Line | Kind | Name |
|---|---|---|
| 114 | relation-literal | categories |
| 146 | relation-literal | products |
| 249 | relation-literal | categories |
| 256 | relation-literal | categories |
| 290 | relation-literal | measurement_units |
| 337 | relation-literal | raw_materials |
| 487 | relation-literal | products |
| 496 | relation-literal | product_units |
| 613 | relation-literal | purchases |
| 633 | relation-literal | purchase_items |
| 640 | relation-literal | inventory_movements |
| 650 | relation-literal | inventory_movements |
| 724 | relation-literal | inventory_movements |
| 806 | relation-literal | inventory_movements |
| 816 | relation-literal | inventory_movements |
| 886 | relation-literal | suppliers |
| 893 | relation-literal | suppliers |
| 962 | relation-literal | customers |
| 969 | relation-literal | customers |
| 1031 | relation-literal | expenses |
| 1104 | relation-literal | users |
| 1117 | relation-literal | users |
| 164 | rpc-literal | create_product |
| 347 | rpc-literal | create_raw_material |
| 428 | api-call | catalog.saveProductDirectRawComponents |

### [src/features/import-export/pages/ImportExportCenterPage.tsx](../../src/features/import-export/pages/ImportExportCenterPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 99 | relation-literal | products |
| 100 | relation-literal | categories |
| 101 | relation-literal | raw_materials |
| 102 | relation-literal | suppliers |
| 103 | relation-literal | customers |
| 104 | relation-literal | warehouses |
| 105 | relation-literal | branches |
| 106 | relation-literal | users |

### [src/features/inventory/components/RawMaterialBranchStockPanel.tsx](../../src/features/inventory/components/RawMaterialBranchStockPanel.tsx)

| Line | Kind | Name |
|---|---|---|
| 85 | relation-literal | raw_materials |
| 91 | relation-literal | warehouses |
| 97 | relation-literal | raw_material_warehouse_inventory |

### [src/features/inventory/pages/InventoryBatchesPage.tsx](../../src/features/inventory/pages/InventoryBatchesPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 37 | relation-via-pagination | raw_material_batches |

### [src/features/inventory/pages/InventoryLedgerPage.tsx](../../src/features/inventory/pages/InventoryLedgerPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 81 | relation-literal | branches |
| 99 | rpc-literal | search_inventory_ledger |
| 169 | rpc-literal | search_inventory_ledger |

### [src/features/inventory/pages/KitchenDisplayPage.tsx](../../src/features/inventory/pages/KitchenDisplayPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 72 | rpc-literal | get_my_kitchen_stations |
| 99 | rpc-literal | get_kitchen_queue |

### [src/features/inventory/pages/LowStockAlertsPage.tsx](../../src/features/inventory/pages/LowStockAlertsPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 65 | relation-literal | branches |
| 66 | relation-literal | warehouses |
| 67 | relation-literal | suppliers |
| 118 | relation-literal | raw_material_inventory |
| 126 | relation-literal | products |
| 78 | api-call | inventory.getLowStockAlerts |
| 79 | api-call | inventory.getLowStockSummary |
| 116 | api-call | inventory.getLowStockAlerts |
| 184 | api-call | procurement.createPurchaseRequest |

### [src/features/inventory/pages/StockCountsPage.tsx](../../src/features/inventory/pages/StockCountsPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 86 | relation-literal | branches |
| 87 | relation-literal | warehouses |
| 88 | relation-literal | products |
| 89 | relation-literal | raw_materials |
| 41 | relation-via-pagination | stock_counts |
| 145 | api-call | inventory.createStockCount |
| 170 | api-call | inventory.updateStockCountItem |
| 172 | api-call | inventory.addStockCountItem |
| 176 | api-call | inventory.removeStockCountItem |
| 187 | api-call | inventory.submitStockCount |
| 188 | api-call | inventory.approveStockCount |
| 189 | api-call | inventory.rejectStockCount |
| 190 | api-call | inventory.applyStockCount |

### [src/features/inventory/pages/StockValuationPage.tsx](../../src/features/inventory/pages/StockValuationPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 33 | relation-literal | branches |
| 34 | relation-literal | warehouses |
| 43 | rpc-literal | get_stock_valuation |

### [src/features/inventory/pages/TransfersPage.tsx](../../src/features/inventory/pages/TransfersPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 66 | relation-literal | warehouses |
| 67 | relation-literal | raw_materials |
| 68 | relation-literal | branches |
| 143 | relation-literal | raw_material_warehouse_inventory |
| 44 | relation-via-pagination | warehouse_transfers |
| 175 | api-call | inventory.createTransfer |
| 206 | api-call | inventory.approveTransfer |
| 217 | api-call | inventory.rejectTransfer |

### [src/features/inventory/pages/WarehousesPage.tsx](../../src/features/inventory/pages/WarehousesPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 49 | relation-literal | warehouses |
| 53 | relation-literal | warehouses |
| 70 | relation-literal | warehouses |
| 30 | relation-via-pagination | warehouses |

### [src/features/inventory/pages/WasteCenterPage.tsx](../../src/features/inventory/pages/WasteCenterPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 75 | relation-literal | products |
| 82 | relation-literal | waste_entries |
| 87 | relation-literal | inventory_units |
| 88 | relation-literal | warehouses |
| 94 | relation-literal | waste_categories |
| 143 | rpc-literal | create_waste_entry |
| 171 | rpc-literal | approve_waste |
| 295 | rpc-literal | get_waste_report |

### [src/features/manufacturing/pages/ProductionOrdersPage.tsx](../../src/features/manufacturing/pages/ProductionOrdersPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 35 | relation-literal | inventory_units |
| 36 | relation-literal | warehouses |
| 37 | relation-literal | inventory_unit_productions |
| 57 | rpc-literal | produce_inventory_unit |

### [src/features/manufacturing/pages/RawMaterialsPage.tsx](../../src/features/manufacturing/pages/RawMaterialsPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 75 | relation-literal | raw_material_inventory |
| 76 | relation-literal | raw_material_batches |
| 77 | relation-literal | measurement_units |
| 78 | relation-literal | branches |
| 135 | relation-literal | raw_materials |
| 161 | relation-literal | raw_materials |
| 165 | relation-literal | raw_materials |
| 50 | relation-via-pagination | raw_materials |
| 140 | api-call | catalog.createRawMaterial |
| 192 | api-call | inventory.adjustRawStock |

### [src/features/manufacturing/pages/RecipesPage.tsx](../../src/features/manufacturing/pages/RecipesPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 82 | relation-literal | products |
| 84 | relation-literal | branches |
| 90 | relation-literal | measurement_units |
| 112 | relation-literal | raw_materials |
| 113 | relation-literal | raw_material_inventory |
| 114 | relation-literal | inventory_units |
| 150 | relation-literal | product_unit_links |
| 194 | relation-literal | recipe_items |
| 258 | relation-literal | recipes |
| 261 | relation-literal | recipe_items |
| 244 | rpc-literal | update_recipe_with_items |
| 283 | rpc-literal | delete_recipe_controlled |
| 56 | relation-via-pagination | recipes |
| 267 | api-call | catalog.setProductUnitLinks |

### [src/features/operations/pages/BusinessRecordsPage.tsx](../../src/features/operations/pages/BusinessRecordsPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 90 | relation-literal | business_records |
| 98 | relation-literal | customers |
| 103 | relation-literal | suppliers |
| 108 | relation-literal | products |
| 149 | relation-literal | business_records |
| 178 | relation-literal | business_records |

### [src/features/parties/components/SupplierStatementModal.tsx](../../src/features/parties/components/SupplierStatementModal.tsx)

| Line | Kind | Name |
|---|---|---|
| 84 | api-call | accounting.getSupplierStatement |

### [src/features/parties/pages/CustomersPage.tsx](../../src/features/parties/pages/CustomersPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 86 | relation-literal | customers |
| 90 | relation-literal | customers |
| 101 | relation-literal | customers |
| 112 | relation-literal | customers |
| 39 | relation-via-pagination | customers |
| 65 | api-call | accounting.getArAging |

### [src/features/parties/pages/SuppliersPage.tsx](../../src/features/parties/pages/SuppliersPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 92 | relation-literal | suppliers |
| 96 | relation-literal | suppliers |
| 111 | relation-literal | suppliers |
| 41 | relation-via-pagination | suppliers |
| 71 | api-call | accounting.getApAging |
| 120 | api-call | procurement.getSupplierEvaluation |

### [src/features/pos/components/catalog/MobileStationCategories.tsx](../../src/features/pos/components/catalog/MobileStationCategories.tsx)

| Line | Kind | Name |
|---|---|---|
| 70 | relation-literal | categories |
| 68 | rpc-literal | get_my_kitchen_stations |

### [src/features/pos/components/catalog/ProductBrowser.tsx](../../src/features/pos/components/catalog/ProductBrowser.tsx)

| Line | Kind | Name |
|---|---|---|
| 88 | relation-literal | products |
| 115 | relation-literal | products |

### [src/features/pos/components/catalog/ProductConfigModal.tsx](../../src/features/pos/components/catalog/ProductConfigModal.tsx)

| Line | Kind | Name |
|---|---|---|
| 54 | api-call | catalog.getProductModifiers |

### [src/features/pos/components/checkout/CashierDiscountApprovalCard.tsx](../../src/features/pos/components/checkout/CashierDiscountApprovalCard.tsx)

| Line | Kind | Name |
|---|---|---|
| 77 | rpc-literal | request_manager_approval |

### [src/features/pos/components/checkout/ManualPaymentApprovalsModal.tsx](../../src/features/pos/components/checkout/ManualPaymentApprovalsModal.tsx)

| Line | Kind | Name |
|---|---|---|
| 57 | rpc-literal | get_operational_approval_queue |
| 94 | rpc-literal | decide_operational_approval |

### [src/features/pos/components/customers/CustomerQuickModal.tsx](../../src/features/pos/components/customers/CustomerQuickModal.tsx)

| Line | Kind | Name |
|---|---|---|
| 56 | relation-literal | customers |

### [src/features/pos/components/shift/ShiftModal.tsx](../../src/features/pos/components/shift/ShiftModal.tsx)

| Line | Kind | Name |
|---|---|---|
| 100 | rpc-literal | request_manager_approval |
| 127 | api-call | shifts.forceClose |
| 178 | api-call | shifts.authorizeOpenDrawer |
| 217 | api-call | shifts.close |
| 289 | api-call | shifts.closeWithOpenOrders |

### [src/features/pos/components/tables/PosTablesSidebar.tsx](../../src/features/pos/components/tables/PosTablesSidebar.tsx)

| Line | Kind | Name |
|---|---|---|
| 144 | api-call | floorPlan.setMainAreaTableCount |

### [src/features/pos/components/tables/TransferItemModal.tsx](../../src/features/pos/components/tables/TransferItemModal.tsx)

| Line | Kind | Name |
|---|---|---|
| 53 | relation-literal | orders |
| 64 | relation-literal | dining_tables |
| 170 | relation-literal | approval_requests |
| 111 | api-call | pos.performOrderAction |

### [src/features/pos/components/tables/TransferItemsModal.tsx](../../src/features/pos/components/tables/TransferItemsModal.tsx)

| Line | Kind | Name |
|---|---|---|
| 57 | relation-literal | dining_tables |
| 88 | api-call | pos.transferOrderItemsToTable |

### [src/features/pos/components/tables/TransferOrderModal.tsx](../../src/features/pos/components/tables/TransferOrderModal.tsx)

| Line | Kind | Name |
|---|---|---|
| 208 | relation-literal | approval_requests |
| 66 | api-call | pos.listOrderTransferTargets |
| 107 | api-call | floorPlan.transferOrderOperator |
| 147 | api-call | pos.performOrderAction |

### [src/features/pos/hooks/useActiveOrderCount.ts](../../src/features/pos/hooks/useActiveOrderCount.ts)

| Line | Kind | Name |
|---|---|---|
| 25 | relation-literal | orders |
| 38 | relation-literal | order_items |

### [src/features/pos/hooks/useCartAwareAvailability.ts](../../src/features/pos/hooks/useCartAwareAvailability.ts)

| Line | Kind | Name |
|---|---|---|
| 74 | relation-literal | order_items |
| 75 | relation-literal | order_kitchen_sends |
| 95 | rpc-literal | get_pos_cart_product_availability |

### [src/features/pos/hooks/usePosOrder.ts](../../src/features/pos/hooks/usePosOrder.ts)

| Line | Kind | Name |
|---|---|---|
| 128 | relation-literal | orders |
| 196 | rpc-literal | transfer_order_to_table |
| 151 | api-call | floorPlan.updateOrder |

### [src/features/pos/hooks/usePosOrderBase.ts](../../src/features/pos/hooks/usePosOrderBase.ts)

| Line | Kind | Name |
|---|---|---|
| 155 | relation-literal | dining_tables |
| 178 | relation-literal | dining_tables |
| 401 | relation-literal | orders |
| 411 | relation-literal | dining_tables |
| 416 | relation-literal | dining_tables |
| 421 | relation-literal | dining_tables |
| 446 | relation-literal | order_items |
| 514 | relation-literal | order_items |
| 535 | rpc-literal | cancel_sent_order_item_exact |
| 157 | api-call | floorPlan.setTableStatus |
| 322 | api-call | floorPlan.setTableStatus |
| 336 | api-call | floorPlan.detachOrder |
| 343 | api-call | floorPlan.setTableStatus |
| 467 | api-call | pos.transferOrderItemToTable |
| 616 | api-call | floorPlan.updateOrder |
| 637 | api-call | floorPlan.createOrder |
| 675 | api-call | floorPlan.setOrderStatus |

### [src/features/pos/pages/ActiveOrdersPage.tsx](../../src/features/pos/pages/ActiveOrdersPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 89 | relation-literal | dining_areas |
| 110 | relation-literal | products |
| 325 | relation-literal | dining_tables |
| 127 | api-call | pos.listOrderTransferTargets |
| 168 | api-call | floorPlan.transferOrderOperator |
| 195 | api-call | floorPlan.setTableStatus |
| 208 | api-call | floorPlan.setOrderStatus |
| 250 | api-call | floorPlan.renameArea |
| 251 | api-call | floorPlan.createArea |
| 290 | api-call | floorPlan.updateTable |
| 298 | api-call | floorPlan.addTable |
| 342 | api-call | floorPlan.deleteArea |
| 369 | api-call | floorPlan.setMainAreaTableCount |

### [src/features/pos/pages/PosWorkspacePage.tsx](../../src/features/pos/pages/PosWorkspacePage.tsx)

| Line | Kind | Name |
|---|---|---|
| 179 | relation-literal | v_current_stock_position |
| 199 | relation-literal | product_unit_links |
| 410 | relation-literal | customers |
| 411 | relation-literal | categories |
| 412 | relation-literal | dining_areas |
| 414 | relation-literal | products |
| 415 | relation-literal | products |
| 546 | relation-literal | dining_areas |
| 139 | api-call | pos.getActiveShift |
| 631 | api-call | floorPlan.setOrderStatus |

### [src/features/pos/services/cloudPrint.ts](../../src/features/pos/services/cloudPrint.ts)

| Line | Kind | Name |
|---|---|---|
| 171 | relation-literal | cloud_print_jobs |
| 100 | rpc-literal | enqueue_cloud_kitchen_print |
| 142 | rpc-literal | enqueue_cloud_receipt_print |
| 181 | rpc-literal | claim_cloud_print_jobs |
| 188 | rpc-literal | start_cloud_print_job |
| 192 | rpc-literal | complete_cloud_print_job |

### [src/features/pos/services/kitchen.ts](../../src/features/pos/services/kitchen.ts)

| Line | Kind | Name |
|---|---|---|
| 25 | rpc-literal | send_to_kitchen |
| 76 | rpc-literal | reverse_order_kitchen_consumption |

### [src/features/pos/services/localPrintAgent.ts](../../src/features/pos/services/localPrintAgent.ts)

| Line | Kind | Name |
|---|---|---|
| 467 | fetch-target | ${PRINT_AGENT_URL}/health |
| 469 | fetch-target | ${PRINT_AGENT_URL}/config |
| 617 | fetch-target | ${PRINT_AGENT_URL}/printers |
| 661 | fetch-target | ${PRINT_AGENT_URL}/health |
| 669 | fetch-target | ${PRINT_AGENT_URL}/print |
| 723 | fetch-target | ${PRINT_AGENT_URL}/print |
| 771 | fetch-target | ${PRINT_AGENT_URL}/drawer |
| 808 | fetch-target | ${PRINT_AGENT_URL}/health |
| 810 | fetch-target | ${PRINT_AGENT_URL}/config |
| 818 | fetch-target | ${PRINT_AGENT_URL}/print |

### [src/features/pos/services/payment.ts](../../src/features/pos/services/payment.ts)

| Line | Kind | Name |
|---|---|---|
| 510 | relation-literal | orders |
| 523 | relation-literal | warehouses |
| 538 | relation-literal | warehouses |
| 133 | auth-method | getSession |

### [src/features/pos/services/posOrders.ts](../../src/features/pos/services/posOrders.ts)

| Line | Kind | Name |
|---|---|---|
| 37 | relation-literal | dining_tables |
| 38 | relation-literal | orders |
| 68 | relation-literal | order_items |
| 69 | relation-literal | order_kitchen_sends |
| 99 | relation-literal | orders |
| 104 | relation-literal | order_items |
| 110 | relation-literal | products |
| 115 | relation-literal | dining_tables |
| 128 | relation-literal | branches |
| 133 | relation-literal | customers |
| 45 | rpc-literal | get_pos_order_operator_labels |
| 90 | rpc-literal | authorize_pos_order_access |
| 122 | rpc-literal | resolve_my_active_table_order |

### [src/features/pos/services/settlementPreview.ts](../../src/features/pos/services/settlementPreview.ts)

| Line | Kind | Name |
|---|---|---|
| 26 | rpc-literal | get_order_settlement_preview |

### [src/features/pos/utils/printing.ts](../../src/features/pos/utils/printing.ts)

| Line | Kind | Name |
|---|---|---|
| 84 | relation-literal | sales |
| 111 | relation-literal | approval_requests |
| 95 | rpc-literal | authorize_sale_print |
| 138 | rpc-literal | request_manager_approval |
| 165 | rpc-literal | record_sale_print |

### [src/features/reporting/pages/AuditLogPage.tsx](../../src/features/reporting/pages/AuditLogPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 25 | relation-via-pagination | audit_log |

### [src/features/reporting/pages/ReportsPage.tsx](../../src/features/reporting/pages/ReportsPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 648 | relation-literal | v_current_sale_prices |
| 913 | relation-literal | v_current_stock_position |

### [src/features/reporting/services/reportCoreLoaders.ts](../../src/features/reporting/services/reportCoreLoaders.ts)

| Line | Kind | Name |
|---|---|---|
| 28 | relation-literal | sales |
| 47 | relation-literal | purchases |
| 66 | relation-literal | expenses |

### [src/features/reporting/services/reportFilterOptions.ts](../../src/features/reporting/services/reportFilterOptions.ts)

| Line | Kind | Name |
|---|---|---|
| 26 | relation-literal | warehouses |
| 29 | relation-literal | users |
| 32 | relation-literal | customers |
| 35 | relation-literal | suppliers |
| 38 | relation-literal | products |
| 41 | relation-literal | categories |
| 44 | relation-literal | dining_tables |
| 60 | relation-literal | expenses |

### [src/features/reporting/services/reportInventoryLoaders.ts](../../src/features/reporting/services/reportInventoryLoaders.ts)

| Line | Kind | Name |
|---|---|---|
| 25 | relation-literal | sale_items |
| 39 | relation-literal | sale_items |
| 55 | relation-literal | stock_transactions |
| 75 | relation-literal | stock_transactions |
| 89 | relation-literal | products |
| 99 | relation-literal | raw_materials |
| 100 | relation-literal | raw_material_inventory |
| 101 | relation-literal | inventory_units |
| 102 | relation-literal | inventory_unit_batches |
| 133 | relation-literal | waste_entries |
| 152 | relation-literal | raw_material_batches |
| 155 | relation-literal | inventory_unit_batches |

### [src/features/reporting/services/reportSalesLoaders.ts](../../src/features/reporting/services/reportSalesLoaders.ts)

| Line | Kind | Name |
|---|---|---|
| 22 | relation-literal | sales |
| 40 | relation-literal | sales |
| 58 | relation-literal | sales |
| 74 | relation-literal | sales |

### [src/features/trade/pages/ExpensesPage.tsx](../../src/features/trade/pages/ExpensesPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 126 | relation-literal | chart_of_accounts |
| 127 | relation-literal | treasury_accounts |
| 63 | relation-via-pagination | expenses |
| 128 | api-call | pos.getActiveShift |
| 129 | api-call | accounting.getExpenseRoutingRules |
| 192 | api-call | accounting.editShiftExpense |
| 214 | api-call | accounting.postShiftExpense |
| 240 | api-call | accounting.reverseShiftExpense |
| 254 | api-call | accounting.upsertExpenseRoutingRule |
| 267 | api-call | accounting.getExpenseRoutingRules |

### [src/features/trade/pages/PurchaseRequestsPage.tsx](../../src/features/trade/pages/PurchaseRequestsPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 83 | relation-literal | suppliers |
| 84 | relation-literal | products |
| 85 | relation-literal | raw_materials |
| 154 | relation-literal | purchase_request_items |
| 56 | relation-via-pagination | purchase_requests |
| 111 | api-call | procurement.createPurchaseRequest |
| 135 | api-call | procurement.updatePurchaseRequestStatus |
| 144 | api-call | procurement.createRfq |

### [src/features/trade/pages/PurchasesPage.tsx](../../src/features/trade/pages/PurchasesPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 93 | relation-literal | suppliers |
| 94 | relation-literal | products |
| 95 | relation-literal | raw_materials |
| 96 | relation-literal | warehouses |
| 108 | relation-literal | measurement_units |
| 169 | relation-literal | purchase_items |
| 285 | relation-literal | raw_materials |
| 418 | relation-literal | purchase_items |
| 53 | relation-via-pagination | purchases |
| 333 | api-call | trade.updatePurchase |
| 369 | api-call | trade.nextDocumentNumber |
| 379 | api-call | trade.processPurchase |
| 444 | api-call | procurement.updatePurchaseOrderStatus |
| 461 | api-call | procurement.updatePurchaseOrderStatus |
| 466 | api-call | trade.deletePurchase |
| 491 | api-call | trade.processPurchaseReturn |

### [src/features/trade/pages/ReceivingPage.tsx](../../src/features/trade/pages/ReceivingPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 63 | api-call | procurement.getPurchaseBackorders |
| 76 | api-call | procurement.getPurchaseReceipts |
| 90 | api-call | procurement.getSupplierEvaluation |
| 175 | api-call | procurement.receivePurchaseOrder |

### [src/features/trade/pages/RfqsPage.tsx](../../src/features/trade/pages/RfqsPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 101 | relation-literal | suppliers |
| 102 | relation-literal | products |
| 103 | relation-literal | raw_materials |
| 104 | relation-literal | purchase_requests |
| 65 | relation-via-pagination | rfqs |
| 131 | api-call | procurement.createRfq |
| 153 | api-call | procurement.updateRfqStatus |
| 178 | api-call | procurement.recordSupplierQuotation |
| 200 | api-call | procurement.selectSupplierQuotation |
| 210 | api-call | procurement.getRfqComparison |

### [src/features/trade/pages/SalesPage.tsx](../../src/features/trade/pages/SalesPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 102 | relation-literal | customers |
| 142 | relation-literal | sale_payments |
| 170 | relation-literal | settings |
| 171 | relation-literal | branch_settings |
| 480 | relation-literal | sales |
| 397 | rpc-literal | request_manager_approval |
| 444 | rpc-literal | change_sale_payment_method |
| 454 | rpc-literal | request_manager_approval |
| 62 | relation-via-pagination | sales |
| 387 | api-call | trade.processRefund |
| 503 | api-call | trade.archiveReturnedSale |
| 526 | api-call | trade.archiveReturnedSale |

### [src/features/trade/pages/ShiftsPage.tsx](../../src/features/trade/pages/ShiftsPage.tsx)

| Line | Kind | Name |
|---|---|---|
| 111 | relation-literal | users |
| 83 | relation-via-pagination | shifts |
| 125 | api-call | pos.getActiveShift |
| 158 | api-call | shifts.open |
| 180 | api-call | pos.getActiveShift |
| 238 | api-call | shifts.close |
| 273 | api-call | shifts.closeWithOpenOrders |
| 329 | api-call | shifts.getCurrentBusinessDay |
| 354 | api-call | shifts.dayClose |

### [src/features/trade/services/dayClosingReport.ts](../../src/features/trade/services/dayClosingReport.ts)

| Line | Kind | Name |
|---|---|---|
| 67 | rpc-literal | get_day_closing_report |

### [src/features/trade/services/shiftClosingFinancials.ts](../../src/features/trade/services/shiftClosingFinancials.ts)

| Line | Kind | Name |
|---|---|---|
| 170 | relation-literal | sales |
| 189 | relation-literal | purchases |
| 241 | relation-literal | sale_items |
| 369 | relation-literal | shifts |
| 378 | relation-literal | branches |
| 381 | relation-literal | users |
| 384 | relation-literal | shift_operations |
| 402 | relation-literal | sales |
| 52 | rpc-literal | get_shift_closing_report |

### [src/features/trade/services/shiftClosingReport.ts](../../src/features/trade/services/shiftClosingReport.ts)

| Line | Kind | Name |
|---|---|---|
| 132 | relation-literal | shifts |
| 145 | relation-literal | branches |
| 146 | relation-literal | users |
| 154 | relation-literal | sales |
| 227 | relation-literal | recipes |

### [src/hooks/useBranches.ts](../../src/hooks/useBranches.ts)

| Line | Kind | Name |
|---|---|---|
| 19 | relation-literal | branches |

### [src/lib/audit.ts](../../src/lib/audit.ts)

| Line | Kind | Name |
|---|---|---|
| 10 | relation-literal | audit_log |
| 8 | auth-method | getSession |

### [src/lib/comprehensiveDemoSeeder.ts](../../src/lib/comprehensiveDemoSeeder.ts)

| Line | Kind | Name |
|---|---|---|
| 40 | relation-literal | warehouses |
| 51 | relation-literal | warehouses |
| 78 | relation-literal | units |
| 88 | relation-literal | units |
| 114 | relation-literal | categories |
| 125 | relation-literal | categories |
| 160 | relation-literal | raw_materials |
| 170 | relation-literal | raw_materials |
| 190 | relation-literal | raw_material_inventory |
| 202 | relation-literal | raw_material_batches |
| 331 | relation-literal | products |
| 341 | relation-literal | products |
| 365 | relation-literal | inventory |
| 379 | relation-literal | recipes |
| 389 | relation-literal | recipes |
| 408 | relation-literal | recipe_items |
| 416 | relation-literal | recipe_items |
| 441 | relation-literal | dining_areas |
| 451 | relation-literal | dining_areas |
| 465 | relation-literal | dining_tables |
| 474 | relation-literal | dining_tables |
| 497 | relation-literal | customers |
| 505 | relation-literal | customers |
| 525 | relation-literal | suppliers |
| 533 | relation-literal | suppliers |
| 553 | relation-literal | expenses |
| 561 | relation-literal | expenses |

### [src/lib/sales-deduction.ts](../../src/lib/sales-deduction.ts)

| Line | Kind | Name |
|---|---|---|
| 99 | relation-literal | inventory_unit_batches |
| 52 | rpc-literal | deduct_sale_unit_inventory |

## Computed-call review candidates

| Source | Expression |
|---|---|
| src/features/accounting/pages/FinancialReportsPage.tsx:142 | table |
| src/features/admin/work-authorization/supabaseWorkAuthorizationProvider.ts:31 | name, params |
| src/features/catalog/services/productImages.ts:23 | PRODUCT_IMAGES_BUCKET |
| src/features/catalog/services/productImages.ts:29 | PRODUCT_IMAGES_BUCKET |
| src/features/costing/components/CostBreakdownButton.tsx:56 | table |
| src/features/import-export/export-service.ts:222 | tableName |
| src/features/inventory/pages/StockBalancesPage.tsx:16 | table |
| src/hooks/usePaginatedRows.ts:170 | table |
