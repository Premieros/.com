import { Truck, UsersRound } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { CenterGrid, type CenterTileItem } from '@/components/design/CenterTile';
import { useLanguage } from '@/context/LanguageContext';
import { useCan } from '@/lib/permissions';
import { APP_ROUTES } from '@/core/navigation/routes';

export function PeopleCenterPage() {
  const { lang } = useLanguage();
  const can = useCan();
  const ar = lang === 'ar';

  const actions: CenterTileItem[] = [
    { id: 'customers', ar: 'العملاء', en: 'Customers', descriptionAr: 'إدارة العملاء والأرصدة والبيانات المرتبطة.', descriptionEn: 'Manage customers, balances and related data.', route: APP_ROUTES.customers, permission: can('customers.view'), icon: UsersRound, accent: 'primary' },
    { id: 'suppliers', ar: 'الموردون', en: 'Suppliers', descriptionAr: 'إدارة الموردين والكشوف والمستحقات.', descriptionEn: 'Manage suppliers, statements and obligations.', route: APP_ROUTES.suppliers, permission: can('suppliers.view'), icon: Truck, accent: 'purchase' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={ar ? 'مركز الأطراف' : 'People Center'} subtitle={ar ? 'العملاء والموردون في شاشة موحدة وبسيطة' : 'Customers and suppliers in one simple hub.'} />
      <CenterGrid items={actions} testIdPrefix="people-center" columns={2} />
    </div>
  );
}
