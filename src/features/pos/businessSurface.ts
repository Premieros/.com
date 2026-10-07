import type { BusinessRuntime, BusinessWorkflowMode } from '@/core/organizations/businessRuntime';

export interface PosBusinessSurface {
  workflow: BusinessWorkflowMode;
  title: { ar: string; en: string };
  subtitle: { ar: string; en: string };
  transactionLabel: { ar: string; en: string };
  itemLabel: { ar: string; en: string };
  customerLabel: { ar: string; en: string };
  catalogLabel: { ar: string; en: string };
  newSaleLabel: { ar: string; en: string };
  currentSaleLabel: { ar: string; en: string };
  showTables: boolean;
  showKitchen: boolean;
  showDelivery: boolean;
  showDriveThru: boolean;
  showActiveOrders: boolean;
  showRestaurantOrderControls: boolean;
  requiresShift: boolean;
  customerEmphasis: boolean;
  customerRequired: boolean;
}

const T = (ar: string, en: string) => ({ ar, en });

export function resolvePosBusinessSurface(runtime: BusinessRuntime): PosBusinessSurface {
  const restaurant = runtime.workflow === 'restaurant_service';
  const capabilities = runtime.capabilities;

  const base = {
    workflow: runtime.workflow,
    title: runtime.title,
    transactionLabel: runtime.terminology.sale,
    itemLabel: runtime.terminology.item,
    customerLabel: runtime.terminology.customer,
    showTables: restaurant && capabilities.has('tables'),
    showKitchen: restaurant && capabilities.has('kds'),
    showDelivery: restaurant && capabilities.has('delivery'),
    showDriveThru: restaurant && capabilities.has('drive_thru'),
    showActiveOrders: restaurant,
    showRestaurantOrderControls: restaurant,
    requiresShift: capabilities.has('shifts'),
    customerEmphasis: runtime.workflow === 'vehicle_sales' || runtime.workflow === 'manufacturing',
    customerRequired: runtime.workflow === 'vehicle_sales',
  };

  switch (runtime.workflow) {
    case 'restaurant_service':
      return {
        ...base,
        subtitle: T('إدارة الطلبات والطاولات والمطبخ من شاشة تشغيل واحدة.', 'Run orders, tables and kitchen from one service workspace.'),
        catalogLabel: T('المنيو', 'Menu'),
        newSaleLabel: T('طلب جديد', 'New order'),
        currentSaleLabel: T('الطلب الحالي', 'Current order'),
      };
    case 'pharmacy_retail':
      return {
        ...base,
        subtitle: T('بيع سريع للأدوية والأصناف مع تركيز على الباركود والعميل.', 'Fast medicine checkout focused on barcode scanning and customer service.'),
        catalogLabel: T('الأدوية والأصناف', 'Medicines & items'),
        newSaleLabel: T('بيع جديد', 'New sale'),
        currentSaleLabel: T('فاتورة البيع', 'Sale invoice'),
      };
    case 'vehicle_sales':
      return {
        ...base,
        subtitle: T('إتمام صفقة السيارة مع إبراز العميل وقيمة الصفقة.', 'Close vehicle deals with customer and deal value in focus.'),
        catalogLabel: T('السيارات المتاحة', 'Available vehicles'),
        newSaleLabel: T('صفقة جديدة', 'New deal'),
        currentSaleLabel: T('الصفقة الحالية', 'Current deal'),
      };
    case 'manufacturing':
      return {
        ...base,
        subtitle: T('مكتب مبيعات للأصناف المصنعة والعملاء دون تشغيل مطعم.', 'Sales desk for manufactured goods without restaurant operations.'),
        catalogLabel: T('الأصناف المصنعة', 'Manufactured items'),
        newSaleLabel: T('فاتورة مبيعات جديدة', 'New sales invoice'),
        currentSaleLabel: T('فاتورة المبيعات', 'Sales invoice'),
      };
    case 'retail':
      return {
        ...base,
        subtitle: T('كاشير سريع للمتجر مع بحث وباركود وسلة دفع مباشرة.', 'Fast retail checkout with search, barcode and direct payment.'),
        catalogLabel: T('المنتجات', 'Products'),
        newSaleLabel: T('بيع جديد', 'New sale'),
        currentSaleLabel: T('السلة الحالية', 'Current cart'),
      };
    case 'service_delivery':
      return {
        ...base,
        subtitle: T('تحصيل خدمات وفواتير العملاء وفق نشاط المؤسسة.', 'Bill and collect for services according to the active business.'),
        catalogLabel: T('الخدمات', 'Services'),
        newSaleLabel: T('فاتورة خدمة جديدة', 'New service invoice'),
        currentSaleLabel: T('فاتورة الخدمة', 'Service invoice'),
      };
    case 'tourism_bookings':
      return {
        ...base,
        subtitle: T('تحصيل الحجوزات والبرامج السياحية.', 'Collect payments for bookings and travel packages.'),
        catalogLabel: T('البرامج والخدمات', 'Packages & services'),
        newSaleLabel: T('تحصيل جديد', 'New collection'),
        currentSaleLabel: T('التحصيل الحالي', 'Current collection'),
      };
    default:
      return {
        ...base,
        subtitle: runtime.description,
        catalogLabel: runtime.terminology.item,
        newSaleLabel: T('معاملة جديدة', 'New transaction'),
        currentSaleLabel: T('المعاملة الحالية', 'Current transaction'),
      };
  }
}
