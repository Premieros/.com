import type { BusinessProfileKey } from './businessProfiles';

export type PosLayoutKey = 'restaurant' | 'retail' | 'pharmacy' | 'wholesale' | 'vehicle' | 'service';

export interface OrganizationThemePreset {
  key: string;
  mode: 'light' | 'dark';
  brandHue: number;
  brandSat: number;
  surfaceHue: number;
  surfaceSat: number;
  radius: 'soft' | 'rounded' | 'compact';
}

export interface OrganizationTerminology {
  item: string;
  items: string;
  customer: string;
  customers: string;
  supplier: string;
  suppliers: string;
  branch: string;
  branches: string;
  sale: string;
  sales: string;
  order: string;
  orders: string;
  newOrder: string;
  businessRecords: string;
}

export interface PosLayoutPreset {
  key: PosLayoutKey;
  showTables: boolean;
  showKitchen: boolean;
  showDelivery: boolean;
  showDriveThru: boolean;
  showShift: boolean;
  showCustomer: boolean;
  barcodeFirst: boolean;
  productCardDensity: 'comfortable' | 'compact' | 'visual';
  primaryAction: 'new_order' | 'scan' | 'reserve' | 'book';
}

export interface OrganizationExperiencePreset {
  theme: OrganizationThemePreset;
  terminology: OrganizationTerminology;
  posLayout: PosLayoutPreset;
}

const T = (
  item: string,
  items: string,
  customer: string,
  customers: string,
  supplier: string,
  suppliers: string,
  branch: string,
  branches: string,
  sale: string,
  sales: string,
  order: string,
  orders: string,
  newOrder: string,
  businessRecords: string,
): OrganizationTerminology => ({
  item,
  items,
  customer,
  customers,
  supplier,
  suppliers,
  branch,
  branches,
  sale,
  sales,
  order,
  orders,
  newOrder,
  businessRecords,
});

export const ORGANIZATION_EXPERIENCE_PRESETS: Record<BusinessProfileKey, OrganizationExperiencePreset> = {
  restaurant: {
    theme: { key: 'restaurant-warm', mode: 'dark', brandHue: 20, brandSat: 80, surfaceHue: 25, surfaceSat: 55, radius: 'rounded' },
    terminology: T('منتج', 'المنتجات', 'عميل', 'العملاء', 'مورد', 'الموردون', 'فرع', 'الفروع', 'فاتورة بيع', 'المبيعات', 'طلب', 'الطلبات', 'طلب جديد', 'سجلات التشغيل'),
    posLayout: { key: 'restaurant', showTables: true, showKitchen: true, showDelivery: true, showDriveThru: true, showShift: true, showCustomer: true, barcodeFirst: false, productCardDensity: 'visual', primaryAction: 'new_order' },
  },
  food_manufacturing: {
    theme: { key: 'manufacturing-slate', mode: 'light', brandHue: 215, brandSat: 58, surfaceHue: 210, surfaceSat: 28, radius: 'compact' },
    terminology: T('صنف', 'الأصناف', 'عميل', 'العملاء', 'مورد خامات', 'مورّدو الخامات', 'موقع', 'المواقع', 'فاتورة', 'المبيعات', 'أمر بيع', 'أوامر البيع', 'أمر بيع جديد', 'سجلات التشغيل'),
    posLayout: { key: 'wholesale', showTables: false, showKitchen: false, showDelivery: true, showDriveThru: false, showShift: false, showCustomer: true, barcodeFirst: true, productCardDensity: 'compact', primaryAction: 'scan' },
  },
  pharmacy: {
    theme: { key: 'pharmacy-clean', mode: 'light', brandHue: 160, brandSat: 62, surfaceHue: 165, surfaceSat: 24, radius: 'soft' },
    terminology: T('دواء', 'الأدوية', 'عميل', 'العملاء', 'شركة / مورد', 'الشركات والموردون', 'صيدلية', 'الصيدليات', 'فاتورة', 'المبيعات', 'فاتورة', 'الفواتير', 'فاتورة جديدة', 'سجلات الصيدلية'),
    posLayout: { key: 'pharmacy', showTables: false, showKitchen: false, showDelivery: false, showDriveThru: false, showShift: true, showCustomer: true, barcodeFirst: true, productCardDensity: 'compact', primaryAction: 'scan' },
  },
  car_showroom: {
    theme: { key: 'showroom-luxury', mode: 'dark', brandHue: 46, brandSat: 74, surfaceHue: 220, surfaceSat: 26, radius: 'soft' },
    terminology: T('سيارة', 'السيارات', 'عميل', 'العملاء', 'مورد / مالك', 'الموردون والملاك', 'معرض', 'المعارض', 'عملية بيع', 'المبيعات', 'حجز / بيع', 'الحجوزات والمبيعات', 'حجز جديد', 'سجلات السيارات'),
    posLayout: { key: 'vehicle', showTables: false, showKitchen: false, showDelivery: false, showDriveThru: false, showShift: false, showCustomer: true, barcodeFirst: false, productCardDensity: 'visual', primaryAction: 'reserve' },
  },
  tourism: {
    theme: { key: 'tourism-ocean', mode: 'light', brandHue: 205, brandSat: 78, surfaceHue: 200, surfaceSat: 38, radius: 'soft' },
    terminology: T('برنامج / خدمة', 'البرامج والخدمات', 'مسافر / عميل', 'المسافرون والعملاء', 'مزود خدمة', 'مزودو الخدمة', 'مكتب', 'المكاتب', 'حجز', 'الحجوزات', 'حجز', 'الحجوزات', 'حجز جديد', 'سجلات الحجوزات'),
    posLayout: { key: 'service', showTables: false, showKitchen: false, showDelivery: false, showDriveThru: false, showShift: false, showCustomer: true, barcodeFirst: false, productCardDensity: 'comfortable', primaryAction: 'book' },
  },
  retail: {
    theme: { key: 'retail-blue', mode: 'light', brandHue: 218, brandSat: 70, surfaceHue: 215, surfaceSat: 30, radius: 'rounded' },
    terminology: T('منتج', 'المنتجات', 'عميل', 'العملاء', 'مورد', 'الموردون', 'متجر', 'المتاجر', 'فاتورة', 'المبيعات', 'فاتورة', 'الفواتير', 'فاتورة جديدة', 'سجلات المتجر'),
    posLayout: { key: 'retail', showTables: false, showKitchen: false, showDelivery: true, showDriveThru: false, showShift: true, showCustomer: true, barcodeFirst: true, productCardDensity: 'compact', primaryAction: 'scan' },
  },
  services: {
    theme: { key: 'services-indigo', mode: 'light', brandHue: 245, brandSat: 66, surfaceHue: 240, surfaceSat: 28, radius: 'soft' },
    terminology: T('خدمة', 'الخدمات', 'عميل', 'العملاء', 'مورد', 'الموردون', 'فرع', 'الفروع', 'فاتورة خدمة', 'المبيعات', 'موعد / أمر خدمة', 'المواعيد وأوامر الخدمة', 'موعد جديد', 'سجلات الخدمات'),
    posLayout: { key: 'service', showTables: false, showKitchen: false, showDelivery: false, showDriveThru: false, showShift: false, showCustomer: true, barcodeFirst: false, productCardDensity: 'comfortable', primaryAction: 'book' },
  },
  custom: {
    theme: { key: 'custom-premier', mode: 'dark', brandHue: 222, brandSat: 72, surfaceHue: 222, surfaceSat: 50, radius: 'rounded' },
    terminology: T('صنف / خدمة', 'الأصناف والخدمات', 'عميل', 'العملاء', 'مورد', 'الموردون', 'فرع', 'الفروع', 'فاتورة', 'المبيعات', 'طلب', 'الطلبات', 'طلب جديد', 'سجلات النشاط'),
    posLayout: { key: 'retail', showTables: false, showKitchen: false, showDelivery: false, showDriveThru: false, showShift: true, showCustomer: true, barcodeFirst: false, productCardDensity: 'comfortable', primaryAction: 'new_order' },
  },
};

export function resolveOrganizationExperience(
  businessType: BusinessProfileKey | null | undefined,
  profile: Record<string, unknown> | null | undefined,
): OrganizationExperiencePreset {
  const base = ORGANIZATION_EXPERIENCE_PRESETS[businessType || 'custom'] || ORGANIZATION_EXPERIENCE_PRESETS.custom;
  const raw = profile || {};
  return {
    theme: { ...base.theme, ...((raw.theme_profile as Partial<OrganizationThemePreset> | undefined) || {}) },
    terminology: { ...base.terminology, ...((raw.terminology_profile as Partial<OrganizationTerminology> | undefined) || {}) },
    posLayout: { ...base.posLayout, ...((raw.pos_layout as Partial<PosLayoutPreset> | undefined) || {}) },
  };
}
