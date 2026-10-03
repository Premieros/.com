import { BarChart3, BookOpenText, Calculator, CircleDollarSign, ClipboardList, Landmark, ReceiptText, Scale, WalletCards } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { CenterGrid, type CenterTileItem } from '@/components/design/CenterTile';
import { useLanguage } from '@/context/LanguageContext';
import { useCan } from '@/lib/permissions';
import { APP_ROUTES } from '@/core/navigation/routes';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';

export function FinanceCenterPage() {
  const { lang } = useLanguage();
  const can = useCan();
  const { runtime, canAccessPath } = useOrganizationModules();
  const ar = lang === 'ar';

  const actions: CenterTileItem[] = [
    { id: 'treasury', ar: 'الخزينة', en: 'Treasury', descriptionAr: 'حركة النقد والبنك والتحويلات اليومية.', descriptionEn: 'Cash, bank and treasury transfers.', route: APP_ROUTES.treasury, permission: can('accounts.view') && canAccessPath(APP_ROUTES.treasury), icon: WalletCards, accent: 'finance' },
    { id: 'accounts', ar: 'دليل الحسابات', en: 'Chart of Accounts', descriptionAr: 'الحسابات الرئيسية والفرعية المستخدمة في القيود.', descriptionEn: 'Manage the accounting chart and account structure.', route: APP_ROUTES.accounts, permission: can('accounts.view') && canAccessPath(APP_ROUTES.accounts), icon: BookOpenText, accent: 'finance' },
    { id: 'journal', ar: 'القيود اليومية', en: 'Journal', descriptionAr: 'عرض ومراجعة القيود المحاسبية.', descriptionEn: 'Review accounting journal entries.', route: APP_ROUTES.journal, permission: can('accounts.view') && canAccessPath(APP_ROUTES.journal), icon: ClipboardList, accent: 'finance' },
    { id: 'payments', ar: 'التحصيل والسداد', en: 'Payments', descriptionAr: 'تسجيل ومتابعة عمليات التحصيل والسداد.', descriptionEn: 'Record and track incoming and outgoing payments.', route: APP_ROUTES.payments, permission: can('accounts.view') && canAccessPath(APP_ROUTES.payments), icon: CircleDollarSign, accent: 'finance' },
    { id: 'reconciliation', ar: 'التسويات البنكية', en: 'Reconciliation', descriptionAr: 'مطابقة حركة البنك مع القيود المسجلة.', descriptionEn: 'Reconcile bank activity with recorded entries.', route: APP_ROUTES.reconciliation, permission: can('accounts.view') && canAccessPath(APP_ROUTES.reconciliation), icon: Scale, accent: 'finance' },
    { id: 'employee-receivables', ar: 'ذمم الموظفين', en: 'Employee Receivables', descriptionAr: 'متابعة أرصدة ومديونيات الموظفين.', descriptionEn: 'Track employee balances and receivables.', route: APP_ROUTES.employeeReceivables, permission: can('accounts.view') && canAccessPath(APP_ROUTES.employeeReceivables), icon: Landmark, accent: 'finance' },
    { id: 'expenses', ar: 'المصروفات', en: 'Expenses', descriptionAr: 'تسجيل ومراجعة مصروفات الفروع.', descriptionEn: 'Record and review branch expenses.', route: APP_ROUTES.expenses, permission: can('expenses.view') && canAccessPath(APP_ROUTES.expenses), icon: ReceiptText, accent: 'alert' },
    { id: 'sales', ar: 'فواتير المبيعات', en: 'Sales', descriptionAr: 'عرض فواتير المبيعات والمرتجعات.', descriptionEn: 'Review sales invoices and returns.', route: APP_ROUTES.sales, permission: can('sales.view') && canAccessPath(APP_ROUTES.sales), icon: BarChart3, accent: 'finance' },
    { id: 'shifts', ar: 'الشفتات', en: 'Shifts', descriptionAr: 'مراجعة الورديات والإغلاق والتقارير المرتبطة.', descriptionEn: 'Review shifts, closing and related reports.', route: APP_ROUTES.shifts, permission: can('shifts.view') && canAccessPath(APP_ROUTES.shifts), icon: ClipboardList, accent: 'system' },
    { id: 'costing', ar: 'التكاليف', en: 'Costing', descriptionAr: 'تكلفة المنتجات والخامات وتحليل الهوامش.', descriptionEn: 'Product/raw cost and margin analysis.', route: APP_ROUTES.costingCenter, permission: can('reports.costing') && canAccessPath(APP_ROUTES.costingCenter), icon: Calculator, accent: 'finance' },
    { id: 'reports', ar: 'التقارير', en: 'Reports', descriptionAr: 'التقارير التشغيلية والمالية الموحدة.', descriptionEn: 'Unified operational and financial reporting.', route: APP_ROUTES.reports, permission: (can('reports.view') || can('reports.financial')) && canAccessPath(APP_ROUTES.reports), icon: BarChart3, accent: 'finance' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={runtime.navigation.menuLabels['finance-center']?.[ar ? 'ar' : 'en'] || (ar ? 'المركز المالي' : 'Finance Center')} subtitle={ar ? `الحسابات والتدفقات المالية المرتبطة بنشاط ${runtime.title.ar}.` : `Finance and accounting flows for the active ${runtime.title.en} profile.`} />
      <CenterGrid items={actions} testIdPrefix="finance-center" columns={4} />
    </div>
  );
}
