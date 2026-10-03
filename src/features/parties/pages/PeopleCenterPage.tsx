import { Truck, UsersRound } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { CenterGrid, type CenterTileItem } from '@/components/design/CenterTile';
import { useLanguage } from '@/context/LanguageContext';
import { useCan } from '@/lib/permissions';
import { APP_ROUTES } from '@/core/navigation/routes';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';

export function PeopleCenterPage() {
  const { lang } = useLanguage();
  const can = useCan();
  const { runtime, canAccessPath } = useOrganizationModules();
  const ar = lang === 'ar';

  const actions: CenterTileItem[] = [
    { id: 'customers', ar: runtime.terminology.customer.ar, en: runtime.terminology.customer.en, descriptionAr: `إدارة ${runtime.terminology.customer.ar} والأرصدة والبيانات المرتبطة.`, descriptionEn: `Manage ${runtime.terminology.customer.en}, balances and related data.`, route: APP_ROUTES.customers, permission: can('customers.view') && canAccessPath(APP_ROUTES.customers), icon: UsersRound, accent: 'primary' },
    { id: 'suppliers', ar: runtime.terminology.supplier.ar, en: runtime.terminology.supplier.en, descriptionAr: `إدارة ${runtime.terminology.supplier.ar} والكشوف والمستحقات.`, descriptionEn: `Manage ${runtime.terminology.supplier.en}, statements and obligations.`, route: APP_ROUTES.suppliers, permission: can('suppliers.view') && canAccessPath(APP_ROUTES.suppliers), icon: Truck, accent: 'purchase' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={ar ? `مركز ${runtime.title.ar}` : `${runtime.title.en} People`} subtitle={ar ? `${runtime.terminology.customer.ar} و${runtime.terminology.supplier.ar} حسب نشاط المؤسسة` : `${runtime.terminology.customer.en} and ${runtime.terminology.supplier.en} for this business profile.`} />
      <CenterGrid items={actions} testIdPrefix="people-center" columns={2} />
    </div>
  );
}
