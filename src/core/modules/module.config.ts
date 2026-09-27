import { APP_ROUTES, type AppRoute } from '@/core/navigation/routes';

export const ORGANIZATION_MODULES = {
  pos: { ar: 'نقطة البيع', en: 'Point of Sale' },
  catalog: { ar: 'المنتجات والمكونات', en: 'Catalog & Components' },
  inventory: { ar: 'المخزون', en: 'Inventory' },
  purchases: { ar: 'المشتريات', en: 'Purchasing' },
  customers: { ar: 'العملاء', en: 'Customers' },
  suppliers: { ar: 'الموردون', en: 'Suppliers' },
  expenses: { ar: 'المصروفات', en: 'Expenses' },
  shift_management: { ar: 'الورديات', en: 'Shifts' },
  accounting: { ar: 'الحسابات والخزينة', en: 'Accounting & Treasury' },
  costing: { ar: 'التكاليف', en: 'Costing' },
  reports: { ar: 'التقارير', en: 'Reports' },
  advanced_reports: { ar: 'التقارير المالية والمتقدمة', en: 'Advanced Reports' },
  branch_management: { ar: 'إدارة الفروع', en: 'Branch Management' },
  employees: { ar: 'المستخدمون', en: 'Users' },
  advanced_permissions: { ar: 'الصلاحيات المتقدمة', en: 'Advanced Permissions' },
  approvals: { ar: 'الموافقات', en: 'Approvals' },
  audit_logs: { ar: 'سجل العمليات', en: 'Audit Log' },
  data_exchange: { ar: 'الاستيراد والتصدير', en: 'Import / Export' },
  kds: { ar: 'شاشة المطبخ', en: 'Kitchen Display' },
} as const;

export type OrganizationModuleKey = keyof typeof ORGANIZATION_MODULES;

export const ORGANIZATION_MODULE_KEYS = Object.keys(
  ORGANIZATION_MODULES,
) as OrganizationModuleKey[];

const ROUTE_MODULES: Partial<Record<AppRoute, OrganizationModuleKey>> = {
  [APP_ROUTES.pos]: 'pos',
  [APP_ROUTES.delivery]: 'pos',
  [APP_ROUTES.driveThru]: 'pos',
  [APP_ROUTES.floorPlan]: 'pos',
  [APP_ROUTES.operationsCenter]: 'pos',

  [APP_ROUTES.products]: 'catalog',
  [APP_ROUTES.pricing]: 'catalog',
  [APP_ROUTES.productModifiers]: 'catalog',
  [APP_ROUTES.categories]: 'catalog',

  [APP_ROUTES.inventoryCenter]: 'inventory',
  [APP_ROUTES.inventory]: 'inventory',
  [APP_ROUTES.warehouses]: 'inventory',
  [APP_ROUTES.rawMaterials]: 'inventory',
  [APP_ROUTES.recipes]: 'inventory',
  [APP_ROUTES.transfers]: 'inventory',
  [APP_ROUTES.inventoryLedger]: 'inventory',
  [APP_ROUTES.stockCounts]: 'inventory',
  [APP_ROUTES.inventoryBatches]: 'inventory',
  [APP_ROUTES.stockValuation]: 'inventory',
  [APP_ROUTES.lowStockAlerts]: 'inventory',
  [APP_ROUTES.inventoryUnits]: 'inventory',
  [APP_ROUTES.wasteCenter]: 'inventory',

  [APP_ROUTES.procurementCenter]: 'purchases',
  [APP_ROUTES.purchases]: 'purchases',
  [APP_ROUTES.purchaseRequests]: 'purchases',
  [APP_ROUTES.rfqs]: 'purchases',
  [APP_ROUTES.receiving]: 'purchases',

  [APP_ROUTES.customers]: 'customers',
  [APP_ROUTES.suppliers]: 'suppliers',
  [APP_ROUTES.expenses]: 'expenses',
  [APP_ROUTES.shifts]: 'shift_management',

  [APP_ROUTES.accounts]: 'accounting',
  [APP_ROUTES.employeeReceivables]: 'accounting',
  [APP_ROUTES.payments]: 'accounting',
  [APP_ROUTES.journal]: 'accounting',
  [APP_ROUTES.treasury]: 'accounting',
  [APP_ROUTES.reconciliation]: 'accounting',
  [APP_ROUTES.accounting]: 'accounting',

  [APP_ROUTES.costingCenter]: 'costing',
  [APP_ROUTES.reports]: 'reports',
  [APP_ROUTES.financialReports]: 'advanced_reports',
  [APP_ROUTES.sales]: 'pos',

  [APP_ROUTES.branches]: 'branch_management',
  [APP_ROUTES.users]: 'employees',
  [APP_ROUTES.employees]: 'employees',
  [APP_ROUTES.permissions]: 'advanced_permissions',
  [APP_ROUTES.approvals]: 'approvals',
  [APP_ROUTES.auditLog]: 'audit_logs',
  [APP_ROUTES.importExport]: 'data_exchange',

  [APP_ROUTES.kitchenDisplay]: 'kds',
  [APP_ROUTES.kitchenStations]: 'kds',
};

const SORTED_ROUTE_RULES = Object.entries(ROUTE_MODULES)
  .filter((entry): entry is [AppRoute, OrganizationModuleKey] => Boolean(entry[1]))
  .sort(([a], [b]) => b.length - a.length);

export function moduleForPath(pathname: string): OrganizationModuleKey | null {
  for (const [route, moduleKey] of SORTED_ROUTE_RULES) {
    if (pathname === route || pathname.startsWith(`${route}/`)) return moduleKey;
  }
  return null;
}

export function moduleForRoute(route: AppRoute): OrganizationModuleKey | null {
  return ROUTE_MODULES[route] ?? null;
}
