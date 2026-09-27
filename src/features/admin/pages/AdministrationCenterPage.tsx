import { ArrowLeftRight, Building2, FileClock, KeyRound, Settings, ShieldCheck, Users, Workflow } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { CenterGrid, type CenterTileItem } from '@/components/design/CenterTile';
import { useLanguage } from '@/context/LanguageContext';
import { useCan } from '@/lib/permissions';
import { APP_ROUTES } from '@/core/navigation/routes';

export function AdministrationCenterPage() {
  const { lang } = useLanguage();
  const can = useCan();
  const ar = lang === 'ar';

  const actions: CenterTileItem[] = [
    { id: 'branches', ar: 'الفروع', en: 'Branches', descriptionAr: 'إدارة الفروع وبياناتها التشغيلية.', descriptionEn: 'Manage branches and their operational data.', route: APP_ROUTES.branches, permission: can('branches.manage'), icon: Building2, accent: 'system' },
    { id: 'users', ar: 'المستخدمون', en: 'Users', descriptionAr: 'إدارة المستخدمين وربطهم بالفروع.', descriptionEn: 'Manage users and branch assignments.', route: APP_ROUTES.users, permission: can('users.view'), icon: Users, accent: 'system' },
    { id: 'permissions', ar: 'الصلاحيات والأدوار', en: 'Roles & Permissions', descriptionAr: 'منح الصلاحيات وفق Permission-First.', descriptionEn: 'Manage roles using the Permission-First model.', route: APP_ROUTES.permissions, permission: can('roles.permissions.manage'), icon: KeyRound, accent: 'system' },
    { id: 'approvals', ar: 'مركز الموافقات', en: 'Approval Center', descriptionAr: 'مراجعة الطلبات التي تحتاج إلى اعتماد.', descriptionEn: 'Review requests that require approval.', route: APP_ROUTES.approvals, permission: can('approvals.review'), icon: ShieldCheck, accent: 'alert' },
    { id: 'audit', ar: 'سجل العمليات', en: 'Audit Log', descriptionAr: 'متابعة التغييرات والعمليات الحساسة.', descriptionEn: 'Review sensitive actions and changes.', route: APP_ROUTES.auditLog, permission: can('audit.view'), icon: FileClock, accent: 'system' },
    { id: 'data', ar: 'الاستيراد والتصدير', en: 'Import / Export', descriptionAr: 'إدخال وإخراج البيانات من مكان واحد.', descriptionEn: 'Import and export operational data.', route: APP_ROUTES.importExport, permission: can('settings.manage'), icon: ArrowLeftRight, accent: 'system' },
    { id: 'kitchen-stations', ar: 'محطات المطبخ', en: 'Kitchen Stations', descriptionAr: 'إعداد المحطات فقط دون تغيير مسار الطباعة أو الإرسال.', descriptionEn: 'Configure stations without changing print or dispatch runtime.', route: APP_ROUTES.kitchenStations, permission: can('settings.manage'), icon: Workflow, accent: 'system' },
    { id: 'settings', ar: 'الإعدادات', en: 'Settings', descriptionAr: 'إعدادات الفرع والضريبة واليوم المالي والمظهر.', descriptionEn: 'Branch, tax, business-day and appearance settings.', route: APP_ROUTES.settings, permission: can('settings.manage'), icon: Settings, accent: 'system' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={ar ? 'مركز الإدارة' : 'Administration Center'} subtitle={ar ? 'الفروع والمستخدمون والصلاحيات والإعدادات في مكان واحد' : 'Branches, users, permissions and settings in one place.'} />
      <CenterGrid items={actions} testIdPrefix="admin-center" columns={4} />
    </div>
  );
}
