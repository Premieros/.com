import type { Permission } from '@/lib/permissions';
import { APP_ROUTES as routes, type AppRoute } from './routes';

type SectionLink = {
  route: AppRoute;
  permission?: Permission;
  relatedPaths?: readonly AppRoute[];
  label: readonly [ar: string, en: string];
};

type WorkspaceSection = {
  anchor: AppRoute;
  links: SectionLink[];
};

export const workspaceSections: WorkspaceSection[] = [
  {
    anchor: routes.products,
    links: [
      { route: routes.products, label: ['المنتجات', 'Products'] },
      { route: routes.categories, permission: 'categories.view', label: ['التصنيفات', 'Categories'] },
      { route: routes.pricing, permission: 'products.view', label: ['الأسعار', 'Pricing'] },
      { route: routes.productModifiers, permission: 'products.modifiers.manage', relatedPaths: [routes.productModifierOptions], label: ['الإضافات', 'Modifiers'] },
      { route: routes.rawMaterials, label: ['الخامات', 'Raw materials'] },
      { route: routes.inventoryUnits, label: ['المصنّعات', 'Manufactured units'] },
      { route: routes.production, label: ['الإنتاج', 'Production'] },
    ],
  },
  {
    anchor: routes.sales,
    links: [
      { route: routes.sales, label: ['الفواتير', 'Invoices'] },
      { route: routes.floorPlan, permission: 'floor_plan.view', label: ['الطلبات النشطة', 'Active orders'] },
      { route: routes.delivery, label: ['التوصيل', 'Delivery'] },
      { route: routes.kitchenDisplay, label: ['المطبخ', 'Kitchen'] },
    ],
  },
  {
    anchor: routes.inventoryCenter,
    links: [
      { route: routes.inventoryCenter, label: ['نظرة عامة', 'Overview'] },
      { route: routes.stockBalances, permission: 'inventory.view', relatedPaths: [routes.inventory], label: ['الأرصدة', 'Balances'] },
      { route: routes.warehouses, permission: 'warehouses.view', label: ['المستودعات', 'Warehouses'] },
      { route: routes.inventoryLedger, permission: 'inventory.ledger.view', label: ['الحركات', 'Movements'] },
      { route: routes.transfers, permission: 'inventory.view', label: ['التحويلات', 'Transfers'] },
      { route: routes.stockCounts, label: ['الجرد', 'Stock counts'] },
      { route: routes.inventoryBatches, permission: 'inventory.view', label: ['التشغيلات', 'Batches'] },
      { route: routes.lowStockAlerts, permission: 'inventory.view', label: ['تنبيهات النقص', 'Low stock'] },
      { route: routes.stockValuation, permission: 'inventory.ledger.view', label: ['تقييم المخزون', 'Valuation'] },
      { route: routes.wasteCenter, permission: 'waste.view', label: ['الهالك', 'Waste'] },
    ],
  },
  {
    anchor: routes.procurementCenter,
    links: [
      { route: routes.procurementCenter, label: ['نظرة عامة', 'Overview'] },
      { route: routes.purchases, permission: 'purchases.view', label: ['الفواتير', 'Purchase invoices'] },
      { route: routes.purchaseRequests, permission: 'purchases.requests', label: ['الطلبات', 'Requests'] },
      { route: routes.rfqs, permission: 'purchases.rfq', label: ['عروض الأسعار', 'Quotations'] },
      { route: routes.receiving, permission: 'purchases.receiving', label: ['الاستلام', 'Receiving'] },
      { route: routes.suppliers, permission: 'suppliers.view', label: ['الموردون', 'Suppliers'] },
    ],
  },
  {
    anchor: routes.customers,
    links: [
      { route: routes.customers, label: ['العملاء', 'Customers'] },
      { route: routes.businessRecords, label: ['سجلات النشاط', 'Business records'] },
    ],
  },
  {
    anchor: routes.financeCenter,
    links: [
      { route: routes.financeCenter, label: ['نظرة عامة', 'Overview'] },
      { route: routes.treasury, permission: 'accounts.view', label: ['الخزينة', 'Treasury'] },
      { route: routes.expenses, permission: 'expenses.view', label: ['المصروفات', 'Expenses'] },
      { route: routes.shifts, permission: 'shifts.view', label: ['الورديات', 'Shifts'] },
      { route: routes.accounts, permission: 'accounts.view', label: ['الحسابات', 'Accounts'] },
      { route: routes.openingBalances, label: ['الأرصدة الافتتاحية', 'Opening balances'] },
      { route: routes.financialReports, permission: 'reports.financial', label: ['التقارير المالية', 'Financial reports'] },
    ],
  },
  {
    anchor: routes.reports,
    links: [
      { route: routes.reports, label: ['نظرة عامة', 'Overview'] },
      { route: routes.consumptionReport, permission: 'reports.view', label: ['الاستهلاك', 'Consumption'] },
      { route: routes.monthReview, permission: 'reports.view', label: ['مراجعة الشهر', 'Month review'] },
      { route: routes.periodDocuments, permission: 'reports.view', label: ['مستندات الفترة', 'Period documents'] },
    ],
  },
  {
    anchor: routes.administrationCenter,
    links: [
      { route: routes.administrationCenter, label: ['نظرة عامة', 'Overview'] },
      { route: routes.branches, permission: 'branches.manage', label: ['الفروع', 'Branches'] },
      { route: routes.users, permission: 'users.view', label: ['المستخدمون', 'Users'] },
      { route: routes.permissions, permission: 'roles.permissions.manage', label: ['الصلاحيات', 'Permissions'] },
      { route: routes.approvals, permission: 'approvals.review', label: ['الموافقات', 'Approvals'] },
      { route: routes.auditLog, permission: 'audit.view', label: ['سجل العمليات', 'Audit log'] },
      { route: routes.settings, permission: 'settings.manage', label: ['الإعدادات', 'Settings'] },
      { route: routes.integrations, label: ['التكاملات', 'Integrations'] },
    ],
  },
];

export function workspaceSectionForPath(path: string) {
  let match: { section: WorkspaceSection; route: AppRoute; length: number } | undefined;
  for (const section of workspaceSections) {
    for (const { route, relatedPaths = [] } of section.links) {
      for (const candidate of [route, ...relatedPaths]) {
        if ((path === candidate || path.startsWith(`${candidate}/`)) && candidate.length > (match?.length ?? 0)) {
          match = { section, route, length: candidate.length };
        }
      }
    }
  }
  return match;
}
