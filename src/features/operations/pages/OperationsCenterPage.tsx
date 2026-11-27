import { ArrowLeftRight, Boxes, ChefHat, ClipboardCheck, NotebookPen, PackageSearch, ShoppingCart, Truck, Warehouse } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { CenterGrid, type CenterTileItem } from '@/components/design/CenterTile';
import { useLanguage } from '@/context/LanguageContext';
import { useCan } from '@/lib/permissions';
import { APP_ROUTES } from '@/core/navigation/routes';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';

export function OperationsCenterPage() {
  const { lang } = useLanguage();
  const can = useCan();
  const { runtime, canAccessPath } = useOrganizationModules();
  const ar = lang === 'ar';

  const cards: CenterTileItem[] = [
    { id: 'pos', ar: 'نقطة البيع والطلبات', en: 'POS & Orders', descriptionAr: 'فتح نقطة البيع ومتابعة الطلبات النشطة.', descriptionEn: 'Open POS and monitor active orders.', route: APP_ROUTES.pos, permission: can('pos.view') && canAccessPath(APP_ROUTES.pos), icon: ShoppingCart },
    { id: 'inventory-center', ar: 'مركز المخزون', en: 'Inventory Center', descriptionAr: 'الوصول الموحد لكل وظائف المخزون.', descriptionEn: 'Unified access to all inventory functions.', route: APP_ROUTES.inventoryCenter, permission: can('inventory.view') && canAccessPath(APP_ROUTES.inventoryCenter), icon: Boxes },
    { id: 'inventory', ar: 'المخزون', en: 'Inventory', descriptionAr: 'الرصيد الحالي وحالة الأصناف.', descriptionEn: 'Current stock and item status.', route: APP_ROUTES.inventory, permission: can('inventory.view') && canAccessPath(APP_ROUTES.inventory), icon: Boxes },
    { id: 'warehouses', ar: 'المستودعات', en: 'Warehouses', descriptionAr: 'إدارة المستودعات والأرصدة.', descriptionEn: 'Manage warehouses and balances.', route: APP_ROUTES.warehouses, permission: can('warehouses.view') && canAccessPath(APP_ROUTES.warehouses), icon: Warehouse },
    { id: 'transfers', ar: 'التحويلات المخزنية', en: 'Stock Transfers', descriptionAr: 'نقل الأصناف بين المستودعات والفروع.', descriptionEn: 'Move stock between warehouses and branches.', route: APP_ROUTES.transfers, permission: can('inventory.view') && canAccessPath(APP_ROUTES.transfers), icon: ArrowLeftRight },
    { id: 'counts', ar: 'الجرد والتسويات', en: 'Counts & Adjustments', descriptionAr: 'الجرد الفعلي وتسويات المخزون.', descriptionEn: 'Physical counts and stock adjustments.', route: APP_ROUTES.stockCounts, permission: can('inventory.view') && canAccessPath(APP_ROUTES.stockCounts), icon: ClipboardCheck },
    { id: 'low-stock', ar: 'تنبيهات المخزون', en: 'Low Stock Alerts', descriptionAr: 'الأصناف التي تحتاج إلى إعادة طلب.', descriptionEn: 'Items that need replenishment.', route: APP_ROUTES.lowStockAlerts, permission: can('inventory.view') && canAccessPath(APP_ROUTES.lowStockAlerts), icon: PackageSearch },
    { id: 'purchases', ar: 'المشتريات', en: 'Purchasing', descriptionAr: 'الفواتير وطلبات الشراء والاستلام.', descriptionEn: 'Purchases, requests, and receiving.', route: APP_ROUTES.purchases, permission: can('purchases.view') && canAccessPath(APP_ROUTES.purchases), icon: Truck },
    { id: 'business-records', ar: 'سجلات النشاط', en: 'Business Records', descriptionAr: 'الحجوزات والمواعيد والخطط والسجلات الخاصة بنوع المؤسسة.', descriptionEn: 'Bookings, appointments, plans, and profile-specific operational records.', route: APP_ROUTES.businessRecords, permission: (can('customers.view') || can('suppliers.view') || can('products.view')) && canAccessPath(APP_ROUTES.businessRecords), icon: NotebookPen },
    { id: 'kitchen', ar: 'المطبخ والطلبات', en: 'Kitchen & Orders', descriptionAr: 'متابعة الطلبات التشغيلية من نقطة البيع.', descriptionEn: 'Follow operational orders from POS.', route: APP_ROUTES.floorPlan, permission: can('floor_plan.view') && canAccessPath(APP_ROUTES.floorPlan), icon: ChefHat },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={ar ? `تشغيل ${runtime.title.ar}` : `${runtime.title.en} Operations`} subtitle={ar ? runtime.description.ar : runtime.description.en} />
      <CenterGrid items={cards} testIdPrefix="operations-center" columns={4} />
    </div>
  );
}
