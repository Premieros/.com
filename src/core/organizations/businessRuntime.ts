import { APP_ROUTES, type AppRoute } from '@/core/navigation/routes';
import type { OrganizationModuleKey } from '@/core/modules/module.config';
import {
  BUSINESS_PROFILE_PRESETS,
  type BusinessProfileKey,
} from './businessProfiles';
import {
  BUSINESS_RUNTIME_PROFILES,
  type BusinessFieldDefinition,
  type BusinessRecordTypeDefinition,
} from './businessProfileRuntime';

export type BusinessWorkflowMode =
  | 'restaurant_service'
  | 'manufacturing'
  | 'pharmacy_retail'
  | 'vehicle_sales'
  | 'tourism_bookings'
  | 'retail'
  | 'service_delivery'
  | 'custom';

export type BusinessDashboardSection =
  | 'sales'
  | 'orders'
  | 'inventory'
  | 'purchases'
  | 'expenses'
  | 'finance'
  | 'production'
  | 'business_records';

export interface BusinessTerminology {
  item: { ar: string; en: string };
  customer: { ar: string; en: string };
  supplier: { ar: string; en: string };
  branch: { ar: string; en: string };
  sale: { ar: string; en: string };
  purchase: { ar: string; en: string };
}

export interface BusinessQuickAction {
  id: string;
  route: AppRoute;
  ar: string;
  en: string;
  module?: OrganizationModuleKey;
  capability?: string;
}

export interface StoredBusinessProfile {
  preset_key?: BusinessProfileKey;
  terminology?: {
    item?: string;
    customer?: string;
    supplier?: string;
    branch?: string;
  };
  capabilities?: string[];
  runtime_fields?: BusinessFieldDefinition[];
  record_types?: BusinessRecordTypeDefinition[];
  [key: string]: unknown;
}

export interface BusinessRuntime {
  key: BusinessProfileKey;
  title: { ar: string; en: string };
  description: { ar: string; en: string };
  workflow: BusinessWorkflowMode;
  landingRoute: AppRoute;
  terminology: BusinessTerminology;
  capabilities: ReadonlySet<string>;
  runtimeFields: BusinessFieldDefinition[];
  recordTypes: BusinessRecordTypeDefinition[];
  navigation: {
    order: string[];
    hidden: ReadonlySet<string>;
    menuLabels: Record<string, { ar: string; en: string }>;
    groupLabels: Partial<Record<'main' | 'centers' | 'catalog' | 'admin', { ar: string; en: string }>>;
  };
  dashboard: {
    sections: ReadonlySet<BusinessDashboardSection>;
    quickActions: BusinessQuickAction[];
  };
}

interface RuntimeBlueprint {
  workflow: BusinessWorkflowMode;
  landingRoute?: AppRoute;
  terminology: BusinessTerminology;
  navigation: {
    order: string[];
    hidden?: string[];
    menuLabels?: Record<string, { ar: string; en: string }>;
    groupLabels?: Partial<Record<'main' | 'centers' | 'catalog' | 'admin', { ar: string; en: string }>>;
  };
  dashboard: {
    sections: BusinessDashboardSection[];
    quickActions: BusinessQuickAction[];
  };
}

const T = (ar: string, en: string) => ({ ar, en });

const BLUEPRINTS: Record<BusinessProfileKey, RuntimeBlueprint> = {
  restaurant: {
    workflow: 'restaurant_service',
    terminology: {
      item: T('منتج / طبق', 'Menu item'),
      customer: T('عميل', 'Customer'),
      supplier: T('مورد', 'Supplier'),
      branch: T('فرع', 'Branch'),
      sale: T('طلب / بيع', 'Order / Sale'),
      purchase: T('شراء', 'Purchase'),
    },
    navigation: {
      order: ['dashboard', 'pos', 'kitchen-display', 'operations-center', 'inventory-center', 'procurement-center', 'finance-center', 'people-center', 'administration-center', 'products', 'raw-materials', 'super-admin'],
      menuLabels: {
        pos: T('نقطة البيع', 'Point of Sale'),
        'kitchen-display': T('شاشة المطبخ', 'Kitchen Display'),
        'operations-center': T('الصالة والطلبات', 'Dining & Orders'),
        'inventory-center': T('المخزون والخامات', 'Inventory & Ingredients'),
        products: T('المنيو والمنتجات', 'Menu & Products'),
        'raw-materials': T('الخامات', 'Ingredients'),
      },
      groupLabels: {
        centers: T('مراكز تشغيل المطعم', 'Restaurant Workspaces'),
        catalog: T('المنيو والخامات', 'Menu & Ingredients'),
      },
    },
    dashboard: {
      sections: ['sales', 'orders', 'inventory', 'purchases', 'expenses', 'finance', 'production'],
      quickActions: [
        { id: 'new-order', route: APP_ROUTES.pos, ar: 'طلب جديد', en: 'New Order', module: 'pos' },
        { id: 'floor', route: APP_ROUTES.floorPlan, ar: 'الصالة والطاولات', en: 'Floor & Tables', capability: 'tables' },
        { id: 'kds', route: APP_ROUTES.kitchenDisplay, ar: 'المطبخ', en: 'Kitchen', capability: 'kds' },
        { id: 'purchase', route: APP_ROUTES.purchases, ar: 'شراء خامات', en: 'Buy Ingredients', module: 'purchases' },
      ],
    },
  },
  food_manufacturing: {
    workflow: 'manufacturing',
    terminology: {
      item: T('صنف مصنع', 'Manufactured item'),
      customer: T('عميل', 'Customer'),
      supplier: T('مورد خامات', 'Raw-material supplier'),
      branch: T('موقع / مصنع', 'Site / Factory'),
      sale: T('مبيعات', 'Sales'),
      purchase: T('توريد خامات', 'Raw-material supply'),
    },
    navigation: {
      order: ['dashboard', 'inventory-center', 'procurement-center', 'finance-center', 'people-center', 'operations-center', 'products', 'raw-materials', 'pos', 'administration-center', 'super-admin'],
      menuLabels: {
        pos: T('المبيعات', 'Sales Desk'),
        'operations-center': T('التشغيل والإنتاج', 'Operations & Production'),
        'inventory-center': T('المخزون والإنتاج', 'Inventory & Production'),
        'procurement-center': T('توريد الخامات', 'Raw-material Procurement'),
        products: T('الأصناف المصنعة', 'Manufactured Items'),
        'raw-materials': T('الخامات', 'Raw Materials'),
      },
      groupLabels: {
        centers: T('مراكز المصنع', 'Factory Workspaces'),
        catalog: T('الأصناف والخامات', 'Items & Raw Materials'),
      },
    },
    dashboard: {
      sections: ['sales', 'inventory', 'purchases', 'expenses', 'finance', 'production'],
      quickActions: [
        { id: 'production', route: APP_ROUTES.inventoryUnits, ar: 'الإنتاج والمكونات', en: 'Production & Components', module: 'catalog' },
        { id: 'raw', route: APP_ROUTES.rawMaterials, ar: 'الخامات', en: 'Raw Materials', capability: 'raw_materials' },
        { id: 'purchase', route: APP_ROUTES.purchases, ar: 'توريد جديد', en: 'New Supply', module: 'purchases' },
        { id: 'sales', route: APP_ROUTES.sales, ar: 'المبيعات', en: 'Sales', module: 'pos' },
      ],
    },
  },
  pharmacy: {
    workflow: 'pharmacy_retail',
    terminology: {
      item: T('دواء / صنف', 'Medicine / Item'),
      customer: T('عميل / مريض', 'Customer / Patient'),
      supplier: T('شركة / مورد', 'Company / Supplier'),
      branch: T('صيدلية', 'Pharmacy'),
      sale: T('بيع', 'Sale'),
      purchase: T('توريد أدوية', 'Medicine Supply'),
    },
    navigation: {
      order: ['dashboard', 'pos', 'inventory-center', 'procurement-center', 'products', 'people-center', 'finance-center', 'administration-center', 'super-admin'],
      hidden: ['raw-materials', 'kitchen-display', 'operations-center'],
      menuLabels: {
        pos: T('كاشير الصيدلية', 'Pharmacy POS'),
        'inventory-center': T('مخزون الأدوية', 'Medicine Inventory'),
        'procurement-center': T('الموردون والتوريد', 'Suppliers & Receiving'),
        products: T('الأدوية والأصناف', 'Medicines & Items'),
        'people-center': T('العملاء والموردون', 'Customers & Suppliers'),
      },
      groupLabels: {
        centers: T('تشغيل الصيدلية', 'Pharmacy Operations'),
        catalog: T('الأدوية', 'Medicines'),
      },
    },
    dashboard: {
      sections: ['sales', 'inventory', 'purchases', 'expenses', 'finance'],
      quickActions: [
        { id: 'sale', route: APP_ROUTES.pos, ar: 'بيع جديد', en: 'New Sale', module: 'pos' },
        { id: 'batches', route: APP_ROUTES.inventoryBatches, ar: 'الباتشات والصلاحية', en: 'Batches & Expiry', capability: 'batches' },
        { id: 'low-stock', route: APP_ROUTES.lowStockAlerts, ar: 'النواقص', en: 'Low Stock', capability: 'low_stock' },
        { id: 'receiving', route: APP_ROUTES.receiving, ar: 'استلام توريد', en: 'Receive Supply', capability: 'purchase_receiving' },
      ],
    },
  },
  car_showroom: {
    workflow: 'vehicle_sales',
    terminology: {
      item: T('سيارة', 'Vehicle'),
      customer: T('عميل', 'Customer'),
      supplier: T('مورد / مالك', 'Supplier / Owner'),
      branch: T('معرض', 'Showroom'),
      sale: T('صفقة / بيع', 'Deal / Sale'),
      purchase: T('إضافة / شراء سيارة', 'Vehicle Acquisition'),
    },
    navigation: {
      order: ['dashboard', 'products', 'people-center', 'business-records', 'pos', 'inventory-center', 'finance-center', 'procurement-center', 'administration-center', 'super-admin'],
      hidden: ['raw-materials', 'kitchen-display', 'operations-center'],
      menuLabels: {
        pos: T('مكتب المبيعات', 'Sales Desk'),
        products: T('السيارات', 'Vehicles'),
        'business-records': T('الحجوزات والتسليم', 'Reservations & Handover'),
        'inventory-center': T('مخزون السيارات', 'Vehicle Stock'),
        'people-center': T('العملاء والموردون', 'Customers & Suppliers'),
      },
      groupLabels: {
        centers: T('تشغيل المعرض', 'Showroom Operations'),
        catalog: T('السيارات', 'Vehicles'),
      },
    },
    dashboard: {
      sections: ['sales', 'inventory', 'purchases', 'expenses', 'finance', 'business_records'],
      quickActions: [
        { id: 'vehicle', route: APP_ROUTES.products, ar: 'السيارات', en: 'Vehicles', module: 'catalog' },
        { id: 'reservation', route: APP_ROUTES.businessRecords, ar: 'حجز سيارة', en: 'Vehicle Reservation', capability: 'reservations' },
        { id: 'customer', route: APP_ROUTES.customers, ar: 'العملاء', en: 'Customers', module: 'customers' },
        { id: 'sale', route: APP_ROUTES.pos, ar: 'بيع سيارة', en: 'Vehicle Sale', module: 'pos' },
      ],
    },
  },
  tourism: {
    workflow: 'tourism_bookings',
    terminology: {
      item: T('برنامج / خدمة', 'Package / Service'),
      customer: T('مسافر / عميل', 'Traveler / Customer'),
      supplier: T('مزود خدمة', 'Service Provider'),
      branch: T('مكتب', 'Office'),
      sale: T('حجز / تحصيل', 'Booking / Collection'),
      purchase: T('خدمة مورد', 'Supplier Service'),
    },
    navigation: {
      order: ['dashboard', 'business-records', 'people-center', 'products', 'finance-center', 'procurement-center', 'administration-center', 'super-admin'],
      hidden: ['pos', 'kitchen-display', 'operations-center', 'inventory-center', 'raw-materials'],
      menuLabels: {
        products: T('البرامج والخدمات', 'Packages & Services'),
        'business-records': T('الحجوزات والمسافرون', 'Bookings & Travelers'),
        'people-center': T('المسافرون ومزودو الخدمة', 'Travelers & Providers'),
        'finance-center': T('التحصيل والمدفوعات', 'Collections & Payments'),
        'procurement-center': T('موردو الخدمات', 'Service Providers'),
      },
      groupLabels: {
        main: T('السياحة والحجوزات', 'Travel & Bookings'),
        centers: T('مراكز شركة السياحة', 'Tourism Workspaces'),
        catalog: T('البرامج والخدمات', 'Packages & Services'),
      },
    },
    dashboard: {
      sections: ['sales', 'expenses', 'finance', 'business_records'],
      quickActions: [
        { id: 'booking', route: APP_ROUTES.businessRecords, ar: 'حجز جديد', en: 'New Booking', capability: 'bookings' },
        { id: 'traveler', route: APP_ROUTES.customers, ar: 'المسافرون', en: 'Travelers', module: 'customers' },
        { id: 'packages', route: APP_ROUTES.products, ar: 'البرامج', en: 'Packages', module: 'catalog' },
        { id: 'payments', route: APP_ROUTES.payments, ar: 'التحصيل والمدفوعات', en: 'Collections & Payments', module: 'accounting' },
      ],
    },
  },
  retail: {
    workflow: 'retail',
    terminology: {
      item: T('منتج', 'Product'),
      customer: T('عميل', 'Customer'),
      supplier: T('مورد', 'Supplier'),
      branch: T('متجر', 'Store'),
      sale: T('بيع', 'Sale'),
      purchase: T('شراء', 'Purchase'),
    },
    navigation: {
      order: ['dashboard', 'pos', 'products', 'inventory-center', 'procurement-center', 'people-center', 'finance-center', 'administration-center', 'super-admin'],
      hidden: ['raw-materials', 'kitchen-display', 'operations-center'],
      menuLabels: {
        pos: T('الكاشير', 'Checkout'),
        products: T('المنتجات', 'Products'),
        'inventory-center': T('مخزون المتجر', 'Store Inventory'),
      },
      groupLabels: {
        centers: T('تشغيل المتجر', 'Store Operations'),
      },
    },
    dashboard: {
      sections: ['sales', 'inventory', 'purchases', 'expenses', 'finance'],
      quickActions: [
        { id: 'sale', route: APP_ROUTES.pos, ar: 'بيع جديد', en: 'New Sale', module: 'pos' },
        { id: 'products', route: APP_ROUTES.products, ar: 'المنتجات', en: 'Products', module: 'catalog' },
        { id: 'stock', route: APP_ROUTES.inventoryCenter, ar: 'المخزون', en: 'Inventory', module: 'inventory' },
        { id: 'purchase', route: APP_ROUTES.purchases, ar: 'شراء', en: 'Purchase', module: 'purchases' },
      ],
    },
  },
  services: {
    workflow: 'service_delivery',
    terminology: {
      item: T('خدمة', 'Service'),
      customer: T('عميل', 'Customer'),
      supplier: T('مورد', 'Supplier'),
      branch: T('فرع / مكتب', 'Branch / Office'),
      sale: T('خدمة / فاتورة', 'Service / Invoice'),
      purchase: T('تكلفة / شراء', 'Cost / Purchase'),
    },
    navigation: {
      order: ['dashboard', 'business-records', 'people-center', 'products', 'finance-center', 'administration-center', 'super-admin'],
      hidden: ['pos', 'kitchen-display', 'operations-center', 'inventory-center', 'procurement-center', 'raw-materials'],
      menuLabels: {
        products: T('الخدمات', 'Services'),
        'business-records': T('المواعيد والخدمات', 'Appointments & Services'),
        'people-center': T('العملاء', 'Customers'),
        'finance-center': T('الفواتير والحسابات', 'Billing & Finance'),
      },
      groupLabels: {
        main: T('الخدمات', 'Services'),
        centers: T('مراكز شركة الخدمات', 'Service Workspaces'),
        catalog: T('كتالوج الخدمات', 'Service Catalog'),
      },
    },
    dashboard: {
      sections: ['sales', 'expenses', 'finance', 'business_records'],
      quickActions: [
        { id: 'appointment', route: APP_ROUTES.businessRecords, ar: 'موعد جديد', en: 'New Appointment', capability: 'services' },
        { id: 'customer', route: APP_ROUTES.customers, ar: 'العملاء', en: 'Customers', module: 'customers' },
        { id: 'services', route: APP_ROUTES.products, ar: 'الخدمات', en: 'Services', module: 'catalog' },
        { id: 'accounts', route: APP_ROUTES.accounts, ar: 'الحسابات', en: 'Accounts', module: 'accounting' },
      ],
    },
  },
  custom: {
    workflow: 'custom',
    terminology: {
      item: T('صنف / خدمة', 'Item / Service'),
      customer: T('عميل', 'Customer'),
      supplier: T('مورد', 'Supplier'),
      branch: T('فرع', 'Branch'),
      sale: T('معاملة', 'Transaction'),
      purchase: T('شراء', 'Purchase'),
    },
    navigation: {
      order: ['dashboard', 'products', 'people-center', 'finance-center', 'administration-center', 'super-admin'],
    },
    dashboard: {
      sections: ['sales', 'expenses', 'finance', 'business_records'],
      quickActions: [
        { id: 'items', route: APP_ROUTES.products, ar: 'الأصناف والخدمات', en: 'Items & Services', module: 'catalog' },
        { id: 'customers', route: APP_ROUTES.customers, ar: 'العملاء', en: 'Customers', module: 'customers' },
        { id: 'accounts', route: APP_ROUTES.accounts, ar: 'الحسابات', en: 'Accounts', module: 'accounting' },
      ],
    },
  },
};

const PATH_CAPABILITY_RULES: Array<{ route: AppRoute; any: string[] }> = [
  { route: APP_ROUTES.delivery, any: ['delivery'] },
  { route: APP_ROUTES.driveThru, any: ['drive_thru'] },
  { route: APP_ROUTES.floorPlan, any: ['tables'] },
  { route: APP_ROUTES.kitchenDisplay, any: ['kds'] },
  { route: APP_ROUTES.kitchenStations, any: ['kds'] },
  { route: APP_ROUTES.productModifiers, any: ['modifiers'] },
  { route: APP_ROUTES.productModifierOptions, any: ['modifiers'] },
  { route: APP_ROUTES.rawMaterials, any: ['raw_materials'] },
  { route: APP_ROUTES.inventoryUnits, any: ['component_groups', 'raw_materials', 'recipes'] },
  { route: APP_ROUTES.production, any: ['component_groups', 'raw_materials', 'recipes'] },
  { route: APP_ROUTES.productionUnits, any: ['component_groups', 'raw_materials', 'recipes'] },
  { route: APP_ROUTES.manufacturingCenter, any: ['component_groups', 'raw_materials', 'recipes'] },
  { route: APP_ROUTES.stockCounts, any: ['stock_counts'] },
  { route: APP_ROUTES.lowStockAlerts, any: ['low_stock'] },
];

const SORTED_PATH_CAPABILITY_RULES = [...PATH_CAPABILITY_RULES].sort(
  (a, b) => b.route.length - a.route.length,
);

function resolveBusinessKey(
  businessType: BusinessProfileKey | null | undefined,
  profile: StoredBusinessProfile | null | undefined,
): BusinessProfileKey {
  const candidate = profile?.preset_key || businessType || 'custom';
  return candidate in BUSINESS_PROFILE_PRESETS ? candidate : 'custom';
}

export function resolveBusinessRuntime(
  businessType: BusinessProfileKey | null | undefined,
  profile: StoredBusinessProfile | null | undefined,
): BusinessRuntime {
  const key = resolveBusinessKey(businessType, profile);
  const preset = BUSINESS_PROFILE_PRESETS[key];
  const blueprint = BLUEPRINTS[key];
  const defaultRuntime = BUSINESS_RUNTIME_PROFILES[key];

  const capabilities = new Set(profile?.capabilities || preset.capabilities);
  const runtimeFields = profile?.runtime_fields || defaultRuntime.fields;
  const recordTypes = profile?.record_types || defaultRuntime.records;

  const terminology: BusinessTerminology = {
    ...blueprint.terminology,
    item: { ...blueprint.terminology.item, ar: profile?.terminology?.item || blueprint.terminology.item.ar },
    customer: { ...blueprint.terminology.customer, ar: profile?.terminology?.customer || blueprint.terminology.customer.ar },
    supplier: { ...blueprint.terminology.supplier, ar: profile?.terminology?.supplier || blueprint.terminology.supplier.ar },
    branch: { ...blueprint.terminology.branch, ar: profile?.terminology?.branch || blueprint.terminology.branch.ar },
  };

  return {
    key,
    title: { ar: preset.ar, en: preset.en },
    description: { ar: preset.descriptionAr, en: preset.descriptionEn },
    workflow: blueprint.workflow,
    landingRoute: blueprint.landingRoute || APP_ROUTES.dashboard,
    terminology,
    capabilities,
    runtimeFields,
    recordTypes,
    navigation: {
      order: blueprint.navigation.order,
      hidden: new Set(blueprint.navigation.hidden || []),
      menuLabels: blueprint.navigation.menuLabels || {},
      groupLabels: blueprint.navigation.groupLabels || {},
    },
    dashboard: {
      sections: new Set(blueprint.dashboard.sections),
      quickActions: blueprint.dashboard.quickActions,
    },
  };
}

export function businessPathAllowed(runtime: BusinessRuntime, pathname: string): boolean {
  if (pathname === APP_ROUTES.businessRecords || pathname.startsWith(`${APP_ROUTES.businessRecords}/`)) {
    return runtime.recordTypes.length > 0;
  }

  for (const rule of SORTED_PATH_CAPABILITY_RULES) {
    if (pathname === rule.route || pathname.startsWith(`${rule.route}/`)) {
      return rule.any.some((capability) => runtime.capabilities.has(capability));
    }
  }

  return true;
}

export function businessMenuLabel(
  runtime: BusinessRuntime,
  itemId: string,
  language: 'ar' | 'en',
  fallback: string,
): string {
  return runtime.navigation.menuLabels[itemId]?.[language] || fallback;
}

export function businessGroupLabel(
  runtime: BusinessRuntime,
  group: 'main' | 'centers' | 'catalog' | 'admin',
  language: 'ar' | 'en',
  fallback: string,
): string {
  return runtime.navigation.groupLabels[group]?.[language] || fallback;
}


const RAW_MATERIAL_REPORTS = new Set([
  'raw_material_consumption',
  'raw_material_current_cost',
  'raw_material_financial',
  'sales_component_reconciliation',
  'production_waste',
]);

const POS_ONLY_REPORTS = new Set([
  'cashier_performance',
  'sales_by_employee',
  'daily_closing_range',
]);

export function businessReportAllowed(
  runtime: BusinessRuntime,
  reportKey: string,
  category?: string,
): boolean {
  if (RAW_MATERIAL_REPORTS.has(reportKey)) {
    return runtime.capabilities.has('raw_materials') || runtime.capabilities.has('recipes');
  }
  if (POS_ONLY_REPORTS.has(reportKey)) {
    return runtime.dashboard.sections.has('orders');
  }
  if (reportKey === 'inventory' || reportKey === 'low_stock') {
    return runtime.dashboard.sections.has('inventory');
  }
  if (reportKey === 'purchases') {
    return runtime.dashboard.sections.has('purchases');
  }
  if (reportKey === 'expenses') {
    return runtime.dashboard.sections.has('expenses');
  }

  if (category === 'manufacturing_costing') {
    return runtime.capabilities.has('raw_materials')
      || runtime.capabilities.has('recipes')
      || runtime.capabilities.has('component_groups');
  }
  if (category === 'inventory') return runtime.dashboard.sections.has('inventory');
  if (category === 'employees_shifts') {
    return runtime.capabilities.has('shifts') || runtime.dashboard.sections.has('orders');
  }
  if (category === 'sales') return runtime.dashboard.sections.has('sales');
  if (category === 'financial' || category === 'treasury_payments') {
    return runtime.dashboard.sections.has('finance');
  }

  return true;
}

export function businessFinancialViewAllowed(
  runtime: BusinessRuntime,
  view: string,
): boolean {
  if (view === 'inventory_movement') return runtime.dashboard.sections.has('inventory');
  if (view === 'ap_aging') return runtime.dashboard.sections.has('purchases');
  return runtime.dashboard.sections.has('finance');
}
