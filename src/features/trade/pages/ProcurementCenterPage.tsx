import { ClipboardList, FileSearch, PackageCheck, ShoppingCart, Truck, WalletCards } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { CenterGrid, type CenterTileItem } from '@/components/design/CenterTile';
import { useLanguage } from '@/context/LanguageContext';
import { useCan } from '@/lib/permissions';
import { APP_ROUTES } from '@/core/navigation/routes';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';

export function ProcurementCenterPage() {
  const { lang } = useLanguage();
  const can = useCan();
  const { runtime, canAccessPath } = useOrganizationModules();
  const ar = lang === 'ar';

  const actions: CenterTileItem[] = [
    { id: 'purchases', ar: 'المشتريات', en: 'Purchases', descriptionAr: 'إدارة فواتير وعمليات الشراء.', descriptionEn: 'Manage purchase invoices and transactions.', route: APP_ROUTES.purchases, permission: can('purchases.view') && canAccessPath(APP_ROUTES.purchases), icon: ShoppingCart },
    { id: 'requests', ar: 'طلبات الشراء', en: 'Purchase Requests', descriptionAr: 'متابعة الطلبات قبل إنشاء أمر الشراء.', descriptionEn: 'Track requests before purchase orders.', route: APP_ROUTES.purchaseRequests, permission: can('purchases.requests') && canAccessPath(APP_ROUTES.purchaseRequests), icon: ClipboardList },
    { id: 'rfqs', ar: 'طلبات عروض الأسعار', en: 'RFQs', descriptionAr: 'مقارنة عروض الموردين قبل الاعتماد.', descriptionEn: 'Compare supplier quotations before approval.', route: APP_ROUTES.rfqs, permission: can('purchases.rfq') && canAccessPath(APP_ROUTES.rfqs), icon: FileSearch },
    { id: 'receiving', ar: 'الاستلام', en: 'Receiving', descriptionAr: 'استلام الأصناف ومطابقة الكميات.', descriptionEn: 'Receive items and reconcile quantities.', route: APP_ROUTES.receiving, permission: can('purchases.receiving') && canAccessPath(APP_ROUTES.receiving), icon: PackageCheck },
    { id: 'suppliers', ar: 'الموردون', en: 'Suppliers', descriptionAr: 'إدارة الموردين وبياناتهم.', descriptionEn: 'Manage suppliers and their records.', route: APP_ROUTES.suppliers, permission: can('suppliers.view') && canAccessPath(APP_ROUTES.suppliers), icon: Truck },
    { id: 'payables', ar: 'المستحقات', en: 'Payables', descriptionAr: 'متابعة الالتزامات والمدفوعات للموردين.', descriptionEn: 'Monitor supplier obligations and payments.', route: APP_ROUTES.payments, permission: can('accounts.view') && canAccessPath(APP_ROUTES.payments), icon: WalletCards },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={runtime.navigation.menuLabels['procurement-center']?.[ar ? 'ar' : 'en'] || (ar ? 'مركز المشتريات' : 'Procurement Center')}
        subtitle={ar ? `دورة ${runtime.terminology.purchase.ar} المناسبة لنشاط ${runtime.title.ar}.` : `${runtime.terminology.purchase.en} workflow for the active ${runtime.title.en} profile.`}
      />
      <CenterGrid items={actions} testIdPrefix="procurement-center" columns={3} />
    </div>
  );
}
