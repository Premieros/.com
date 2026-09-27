import type { Permission } from '@/lib/permissions';
import type { TranslationKey } from '@/lib/i18n';
import { APP_ROUTES, type AppRoute } from './routes';

export type MenuGroup = 'main' | 'catalog' | 'operations' | 'centers' | 'people' | 'finance' | 'admin';
export type MenuIcon =
  | 'dashboard' | 'pos' | 'products' | 'pricing' | 'productModifiers' | 'categories' | 'components' | 'rawMaterials' | 'recipes' | 'inventory' | 'warehouses' | 'transfers'
  | 'inventoryLedger' | 'stockCounts' | 'inventoryBatches' | 'stockValuation' | 'lowStockAlerts' | 'inventoryUnits' | 'wasteCenter' | 'kitchenDisplay' | 'kitchenStations' | 'costingCenter' | 'branches' | 'purchases' | 'customers' | 'suppliers' | 'expenses'
  | 'accounts' | 'payments' | 'journal' | 'treasury' | 'reconciliation' | 'financialReports' | 'sales' | 'shifts' | 'reports' | 'users' | 'auditLog' | 'settings' | 'superAdmin' | 'importExport';

export interface MenuItemConfig {
  id: string;
  route: AppRoute;
  icon: MenuIcon;
  labelKey: TranslationKey;
  label?: { ar: string; en: string };
  permission?: Permission;
  permissionsAny?: Permission[];
  group: MenuGroup;
  superAdminOnly?: boolean;
  ownerOnly?: boolean;
}

export const MENU_GROUPS: Record<MenuGroup, { ar: string; en: string }> = {
  main: { ar: 'الرئيسية', en: 'Main' }, catalog: { ar: 'الكتالوج والمكونات', en: 'Catalog & Components' }, operations: { ar: 'العمليات', en: 'Operations' }, centers: { ar: 'مراكز الإدارة', en: 'Management Centers' }, people: { ar: 'الأطراف', en: 'People' }, finance: { ar: 'المالية', en: 'Finance' }, admin: { ar: 'الإدارة', en: 'Admin' },
};

export const MENU_ITEMS: MenuItemConfig[] = [
  { id: 'dashboard', route: APP_ROUTES.dashboard, icon: 'dashboard', labelKey: 'dashboard', permission: 'dashboard.view', group: 'main' },
  { id: 'pos', route: APP_ROUTES.pos, icon: 'pos', labelKey: 'pos', permission: 'pos.view', group: 'main' },
  { id: 'kitchen-display', route: APP_ROUTES.kitchenDisplay, icon: 'kitchenDisplay', labelKey: 'kitchenDisplay', permission: 'pos.kds_view', group: 'main' },

  { id: 'operations-center', route: APP_ROUTES.operationsCenter, icon: 'pos', labelKey: 'orders', label: { ar: 'مركز العمليات', en: 'Operations Center' }, permission: 'dashboard.view', group: 'centers' },
  { id: 'inventory-center', route: APP_ROUTES.inventoryCenter, icon: 'inventory', labelKey: 'inventory', label: { ar: 'مركز المخزون', en: 'Inventory Center' }, permission: 'inventory.view', group: 'centers' },
  { id: 'procurement-center', route: APP_ROUTES.procurementCenter, icon: 'purchases', labelKey: 'purchases', label: { ar: 'مركز المشتريات', en: 'Procurement Center' }, permission: 'purchases.view', group: 'centers' },
  { id: 'people-center', route: APP_ROUTES.peopleCenter, icon: 'customers', labelKey: 'customers', label: { ar: 'مركز الأطراف', en: 'People Center' }, permissionsAny: ['customers.view', 'suppliers.view'], group: 'centers' },
  { id: 'finance-center', route: APP_ROUTES.financeCenter, icon: 'accounts', labelKey: 'reports', label: { ar: 'المركز المالي', en: 'Finance Center' }, permissionsAny: ['accounts.view', 'expenses.view', 'sales.view', 'shifts.view', 'reports.view', 'reports.financial', 'reports.costing'], group: 'centers' },
  { id: 'administration-center', route: APP_ROUTES.administrationCenter, icon: 'settings', labelKey: 'settings', label: { ar: 'مركز الإدارة', en: 'Administration Center' }, permissionsAny: ['branches.manage', 'users.view', 'roles.permissions.manage', 'approvals.review', 'audit.view', 'settings.manage'], group: 'centers' },

  { id: 'products', route: APP_ROUTES.products, icon: 'products', labelKey: 'products', permission: 'products.view', group: 'catalog' },
  { id: 'raw-materials', route: APP_ROUTES.rawMaterials, icon: 'rawMaterials', labelKey: 'rawMaterials', permission: 'raw_materials.view', group: 'catalog' },

  { id: 'super-admin', route: APP_ROUTES.superAdmin, icon: 'superAdmin', labelKey: 'superAdmin', permission: 'settings.manage', group: 'admin', superAdminOnly: true },
];
