import type { OrganizationModuleKey } from '@/core/modules/module.config';

export type BusinessProfileKey =
  | 'restaurant'
  | 'food_manufacturing'
  | 'pharmacy'
  | 'car_showroom'
  | 'tourism'
  | 'retail'
  | 'services'
  | 'custom';

export interface BusinessProfilePreset {
  key: BusinessProfileKey;
  ar: string;
  en: string;
  descriptionAr: string;
  descriptionEn: string;
  enabledModules: OrganizationModuleKey[];
  terminology: {
    item: string;
    customer: string;
    supplier: string;
    branch: string;
  };
  capabilities: string[];
  defaults: {
    taxEnabled: boolean;
    taxRate: number;
    currency: string;
  };
}

const CORE: OrganizationModuleKey[] = [
  'customers',
  'suppliers',
  'expenses',
  'accounting',
  'reports',
  'branch_management',
  'employees',
  'advanced_permissions',
  'audit_logs',
  'data_exchange',
];

export const BUSINESS_PROFILE_PRESETS: Record<BusinessProfileKey, BusinessProfilePreset> = {
  restaurant: {
    key: 'restaurant',
    ar: 'مطعم / كافيه',
    en: 'Restaurant / Cafe',
    descriptionAr: 'نقطة بيع، طاولات، مطبخ، مكونات، خامات، ورديات وخزينة.',
    descriptionEn: 'POS, tables, kitchen, components, raw materials, shifts and treasury.',
    enabledModules: [...CORE, 'pos', 'catalog', 'inventory', 'purchases', 'shift_management', 'costing', 'advanced_reports', 'approvals', 'kds'],
    terminology: { item: 'منتج', customer: 'عميل', supplier: 'مورد', branch: 'فرع' },
    capabilities: ['tables', 'kds', 'recipes', 'raw_materials', 'component_groups', 'modifiers', 'shifts', 'delivery', 'drive_thru'],
    defaults: { taxEnabled: true, taxRate: 14, currency: 'EGP' },
  },
  food_manufacturing: {
    key: 'food_manufacturing',
    ar: 'مصنع / شركة أغذية',
    en: 'Food Manufacturing',
    descriptionAr: 'خامات، مجموعات مكونات، تكلفة، مشتريات، مخزون ومبيعات بدون تشغيل مطعم.',
    descriptionEn: 'Raw materials, component groups, costing, purchasing, inventory and sales.',
    enabledModules: [...CORE, 'pos', 'catalog', 'inventory', 'purchases', 'costing', 'advanced_reports', 'approvals'],
    terminology: { item: 'صنف', customer: 'عميل', supplier: 'مورد خامات', branch: 'موقع' },
    capabilities: ['recipes', 'raw_materials', 'component_groups', 'batches', 'costing', 'wholesale_sales'],
    defaults: { taxEnabled: true, taxRate: 14, currency: 'EGP' },
  },
  pharmacy: {
    key: 'pharmacy',
    ar: 'صيدلية',
    en: 'Pharmacy',
    descriptionAr: 'باركود، باتشات، صلاحية، موردون، مشتريات، مخزون ونقطة بيع.',
    descriptionEn: 'Barcode, batches, expiry, suppliers, purchasing, inventory and POS.',
    enabledModules: [...CORE, 'pos', 'catalog', 'inventory', 'purchases', 'advanced_reports', 'approvals'],
    terminology: { item: 'دواء / صنف', customer: 'عميل', supplier: 'شركة / مورد', branch: 'صيدلية' },
    capabilities: ['barcode', 'batches', 'expiry', 'stock_counts', 'low_stock', 'purchase_receiving'],
    defaults: { taxEnabled: false, taxRate: 0, currency: 'EGP' },
  },
  car_showroom: {
    key: 'car_showroom',
    ar: 'معرض سيارات',
    en: 'Car Showroom',
    descriptionAr: 'مخزون سيارات، عملاء، مبيعات، مصروفات وخزينة مع حقول تعريف السيارة.',
    descriptionEn: 'Vehicle inventory, customers, sales, expenses and treasury with vehicle identity fields.',
    enabledModules: [...CORE, 'pos', 'catalog', 'inventory', 'purchases', 'advanced_reports', 'approvals'],
    terminology: { item: 'سيارة', customer: 'عميل', supplier: 'مورد / مالك', branch: 'معرض' },
    capabilities: ['vin', 'vehicle_model', 'vehicle_year', 'vehicle_color', 'unique_item_tracking', 'reservations'],
    defaults: { taxEnabled: true, taxRate: 14, currency: 'EGP' },
  },
  tourism: {
    key: 'tourism',
    ar: 'شركة سياحة',
    en: 'Tourism Company',
    descriptionAr: 'خدمات وبرامج، حجوزات، عملاء، موردون، مدفوعات ومصروفات وتقارير.',
    descriptionEn: 'Services, packages, bookings, customers, suppliers, payments, expenses and reports.',
    enabledModules: [...CORE, 'catalog', 'customers', 'suppliers', 'expenses', 'accounting', 'reports', 'advanced_reports', 'approvals'],
    terminology: { item: 'برنامج / خدمة', customer: 'مسافر / عميل', supplier: 'مزود خدمة', branch: 'مكتب' },
    capabilities: ['services', 'packages', 'bookings', 'traveler_records', 'supplier_settlement'],
    defaults: { taxEnabled: false, taxRate: 0, currency: 'EGP' },
  },
  retail: {
    key: 'retail',
    ar: 'تجزئة / متجر',
    en: 'Retail Store',
    descriptionAr: 'منتجات، باركود، مخزون، مشتريات، موردون ونقطة بيع.',
    descriptionEn: 'Products, barcode, inventory, purchasing, suppliers and POS.',
    enabledModules: [...CORE, 'pos', 'catalog', 'inventory', 'purchases', 'shift_management', 'advanced_reports'],
    terminology: { item: 'منتج', customer: 'عميل', supplier: 'مورد', branch: 'متجر' },
    capabilities: ['barcode', 'stock_counts', 'low_stock', 'pricing', 'shifts'],
    defaults: { taxEnabled: true, taxRate: 14, currency: 'EGP' },
  },
  services: {
    key: 'services',
    ar: 'شركة خدمات',
    en: 'Services Company',
    descriptionAr: 'خدمات، عملاء، موردون، مصروفات، خزينة وحسابات بدون إلزام بالمخزون.',
    descriptionEn: 'Services, customers, suppliers, expenses, treasury and accounting without mandatory inventory.',
    enabledModules: [...CORE, 'catalog', 'advanced_reports', 'approvals'],
    terminology: { item: 'خدمة', customer: 'عميل', supplier: 'مورد', branch: 'فرع' },
    capabilities: ['services', 'service_sales', 'customer_accounts'],
    defaults: { taxEnabled: true, taxRate: 14, currency: 'EGP' },
  },
  custom: {
    key: 'custom',
    ar: 'نشاط مخصص',
    en: 'Custom Business',
    descriptionAr: 'ابدأ بالنواة الأساسية ثم اختر الموديولات والاحتياجات يدويًا.',
    descriptionEn: 'Start with the core and choose modules and capabilities manually.',
    enabledModules: [...CORE, 'catalog'],
    terminology: { item: 'صنف / خدمة', customer: 'عميل', supplier: 'مورد', branch: 'فرع' },
    capabilities: [],
    defaults: { taxEnabled: true, taxRate: 14, currency: 'EGP' },
  },
};

export const BUSINESS_PROFILE_KEYS = Object.keys(BUSINESS_PROFILE_PRESETS) as BusinessProfileKey[];
