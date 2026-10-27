import { lazy, Suspense, type ComponentType } from 'react';
import { APP_ROUTES } from '@/core/navigation/routes';
import { PageLoadFallback } from '@/components/PageProgressLoader';

// Shared lazy-loaded page registry for inline center tabs. Uses the existing
// canonical page components; does not duplicate screens, queries or data.
const screens: Record<string, ComponentType> = {
  [APP_ROUTES.floorPlan]: lazy(() => import('@/features/pos/pages/ActiveOrdersPage').then(m => ({ default: m.ActiveOrdersPage }))),
  [APP_ROUTES.products]: lazy(() => import('@/features/catalog/pages/ProductsPage').then(m => ({ default: m.ProductsPage }))),
  [APP_ROUTES.pricing]: lazy(() => import('@/features/catalog/pages/PricingPage').then(m => ({ default: m.PricingPage }))),
  [APP_ROUTES.productModifiers]: lazy(() => import('@/features/catalog/pages/ProductModifiersPage').then(m => ({ default: m.ProductModifiersPage }))),
  [APP_ROUTES.productModifierOptions]: lazy(() => import('@/features/catalog/pages/ProductModifierOptionsPage').then(m => ({ default: m.ProductModifierOptionsPage }))),
  [APP_ROUTES.categories]: lazy(() => import('@/features/catalog/pages/CategoriesPage').then(m => ({ default: m.CategoriesPage }))),
  [APP_ROUTES.inventoryUnits]: lazy(() => import('@/features/catalog/pages/InventoryUnitsPage').then(m => ({ default: m.InventoryUnitsPage }))),
  [APP_ROUTES.wasteCenter]: lazy(() => import('@/features/inventory/pages/WasteCenterPage').then(m => ({ default: m.WasteCenterPage }))),
  [APP_ROUTES.kitchenDisplay]: lazy(() => import('@/features/inventory/pages/KitchenDisplayPage').then(m => ({ default: m.KitchenDisplayPage }))),
  [APP_ROUTES.kitchenStations]: lazy(() => import('@/features/catalog/pages/KitchenStationsPage').then(m => ({ default: m.KitchenStationsPage }))),
  [APP_ROUTES.stockBalances]: lazy(() => import('@/features/inventory/pages/StockBalancesPage').then(m => ({ default: m.StockBalancesPage }))),
  [APP_ROUTES.inventory]: lazy(() => import('@/features/inventory/pages/InventoryPage').then(m => ({ default: m.InventoryPage }))),
  [APP_ROUTES.warehouses]: lazy(() => import('@/features/inventory/pages/WarehousesPage').then(m => ({ default: m.WarehousesPage }))),
  [APP_ROUTES.rawMaterials]: lazy(() => import('@/features/manufacturing/pages/RawMaterialsPage').then(m => ({ default: m.RawMaterialsPage }))),
  [APP_ROUTES.production]: lazy(() => import('@/features/manufacturing/pages/ProductionOrdersPage').then(m => ({ default: m.ProductionOrdersPage }))),
  [APP_ROUTES.transfers]: lazy(() => import('@/features/inventory/pages/TransfersPage').then(m => ({ default: m.TransfersPage }))),
  [APP_ROUTES.inventoryLedger]: lazy(() => import('@/features/inventory/pages/InventoryLedgerPage').then(m => ({ default: m.InventoryLedgerPage }))),
  [APP_ROUTES.stockCounts]: lazy(() => import('@/features/inventory/pages/StockCountsPage').then(m => ({ default: m.StockCountsPage }))),
  [APP_ROUTES.inventoryBatches]: lazy(() => import('@/features/inventory/pages/InventoryBatchesPage').then(m => ({ default: m.InventoryBatchesPage }))),
  [APP_ROUTES.stockValuation]: lazy(() => import('@/features/inventory/pages/StockValuationPage').then(m => ({ default: m.StockValuationPage }))),
  [APP_ROUTES.lowStockAlerts]: lazy(() => import('@/features/inventory/pages/LowStockAlertsPage').then(m => ({ default: m.LowStockAlertsPage }))),
  [APP_ROUTES.costingCenter]: lazy(() => import('@/features/costing/pages/CostingCenterPage').then(m => ({ default: m.CostingCenterPage }))),
  [APP_ROUTES.branches]: lazy(() => import('@/features/admin/pages/BranchesPage').then(m => ({ default: m.BranchesPage }))),
  [APP_ROUTES.purchases]: lazy(() => import('@/features/trade/pages/PurchasesPage').then(m => ({ default: m.PurchasesPage }))),
  [APP_ROUTES.purchaseRequests]: lazy(() => import('@/features/trade/pages/PurchaseRequestsPage').then(m => ({ default: m.PurchaseRequestsPage }))),
  [APP_ROUTES.rfqs]: lazy(() => import('@/features/trade/pages/RfqsPage').then(m => ({ default: m.RfqsPage }))),
  [APP_ROUTES.receiving]: lazy(() => import('@/features/trade/pages/ReceivingPage').then(m => ({ default: m.ReceivingPage }))),
  [APP_ROUTES.customers]: lazy(() => import('@/features/parties/pages/CustomersPage').then(m => ({ default: m.CustomersPage }))),
  [APP_ROUTES.businessRecords]: lazy(() => import('@/features/operations/pages/BusinessRecordsPage').then(m => ({ default: m.BusinessRecordsPage }))),
  [APP_ROUTES.suppliers]: lazy(() => import('@/features/parties/pages/SuppliersPage').then(m => ({ default: m.SuppliersPage }))),
  [APP_ROUTES.expenses]: lazy(() => import('@/features/trade/pages/ExpensesPage').then(m => ({ default: m.ExpensesPage }))),
  [APP_ROUTES.sales]: lazy(() => import('@/features/trade/pages/SalesPage').then(m => ({ default: m.SalesPage }))),
  [APP_ROUTES.shifts]: lazy(() => import('@/features/trade/pages/ShiftsPage').then(m => ({ default: m.ShiftsPage }))),
  [APP_ROUTES.reports]: lazy(() => import('@/features/reporting/pages/ReportsCenterPage').then(m => ({ default: m.ReportsCenterPage }))),
  [APP_ROUTES.financialReports]: lazy(() => import('@/features/reporting/pages/ReportsCenterPage').then(m => ({ default: m.ReportsCenterPage }))),
  [APP_ROUTES.accounts]: lazy(() => import('@/features/accounting/pages/AccountsPage').then(m => ({ default: m.AccountsPage }))),
  [APP_ROUTES.openingBalances]: lazy(() => import('@/features/accounting/pages/OpeningBalancesPage').then(m => ({ default: m.OpeningBalancesPage }))),
  [APP_ROUTES.employeeReceivables]: lazy(() => import('@/features/accounting/pages/EmployeeReceivablesPage').then(m => ({ default: m.EmployeeReceivablesPage }))),
  [APP_ROUTES.payments]: lazy(() => import('@/features/accounting/pages/PaymentsPage').then(m => ({ default: m.PaymentsPage }))),
  [APP_ROUTES.journal]: lazy(() => import('@/features/accounting/pages/JournalPage').then(m => ({ default: m.JournalPage }))),
  [APP_ROUTES.treasury]: lazy(() => import('@/features/accounting/pages/TreasuryPage').then(m => ({ default: m.TreasuryPage }))),
  [APP_ROUTES.reconciliation]: lazy(() => import('@/features/accounting/pages/ReconciliationPage').then(m => ({ default: m.ReconciliationPage }))),
  [APP_ROUTES.users]: lazy(() => import('@/features/admin/pages/UsersPage').then(m => ({ default: m.UsersPage }))),
  [APP_ROUTES.permissions]: lazy(() => import('@/features/admin/pages/PermissionsPage').then(m => ({ default: m.PermissionsPage }))),
  [APP_ROUTES.approvals]: lazy(() => import('@/features/admin/pages/ApprovalCenterPage').then(m => ({ default: m.ApprovalCenterPage }))),
  [APP_ROUTES.auditLog]: lazy(() => import('@/features/reporting/pages/AuditLogPage').then(m => ({ default: m.AuditLogPage }))),
  [APP_ROUTES.settings]: lazy(() => import('@/features/admin/pages/SettingsControlCenterPage').then(m => ({ default: m.SettingsControlCenterPage }))),
  [APP_ROUTES.systemHealth]: lazy(() => import('@/features/admin/pages/SystemHealthPage').then(m => ({ default: m.SystemHealthPage }))),
  [APP_ROUTES.importExport]: lazy(() => import('@/features/import-export/pages/ImportExportCenterPage').then(m => ({ default: m.ImportExportCenterPage }))),
};

export function CenterPageContent({ route }: { route: string }) {
  const Page = screens[route];
  if (!Page) return null;
  return <Suspense fallback={<PageLoadFallback />}><Page /></Suspense>;
}
