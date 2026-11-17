import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight,
  FileText, LayoutGrid, Search, Settings2, ShieldCheck, Store, Truck,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { useLanguage } from '@/context/LanguageContext';
import { APP_ROUTES } from '@/core/navigation/routes';
import { useAuth } from '@/context/AuthContext';
import { useBranches } from '@/hooks/useBranches';
import { readInstalledApps, updateLocalAppInstallation, type IntegrationAppId, type InstalledAppMap } from '../localAppInstallations';
import { loadCentralInstalledApps, changeCentralAppInstallation, getPendingLegacyApps, importConfirmedLegacyApps } from '../centralAppInstallations';

// Disabled until the reviewed migration is deployed and branch RLS is verified.
const CENTRAL_INSTALLATIONS_ENABLED = import.meta.env.VITE_CENTRAL_INTEGRATIONS_ENABLED === 'true';

type IntegrationSection = 'egypt' | 'saudi' | 'delivery';
type Stage = 'foundation' | 'not_connected';

interface IntegrationTile {
  id: IntegrationAppId;
  ar: string;
  en: string;
  detailAr: string;
  detailEn: string;
  stage: Stage;
}

const TAX_EGYPT: IntegrationTile[] = [
  {
    id: 'eta-einvoice',
    ar: 'الفاتورة الإلكترونية المصرية', en: 'Egyptian e-Invoice',
    detailAr: 'قواعد توجيه أولية فقط. يلزم التسجيل والتوقيع والتكامل مع مصلحة الضرائب المصرية.',
    detailEn: 'Routing policy only. ETA onboarding, signing and authority API are still needed.',
    stage: 'foundation',
  },
  {
    id: 'eta-ereceipt',
    ar: 'الإيصال الإلكتروني المصري', en: 'Egyptian e-Receipt',
    detailAr: 'قواعد توجيه أولية للإيصالات. لم يُفعّل إصدار أو إرسال الإيصالات للهيئة.',
    detailEn: 'Initial receipt routing only. No official receipt issuance or reporting is active.',
    stage: 'foundation',
  },
];

const TAX_SAUDI: IntegrationTile[] = [
  {
    id: 'zatca-clearance',
    ar: 'الفاتورة الضريبية القياسية — Clearance', en: 'Standard invoice — Clearance',
    detailAr: 'قواعد توجيه وخدمة اتصال خلفية وسجل خاص. توقيع XML المطابق وإرسال الهيئة غير مفعّلين.',
    detailEn: 'Routing, server adapter and private outbox exist. Compliant signed XML and authority submission are inactive.',
    stage: 'foundation',
  },
  {
    id: 'zatca-reporting',
    ar: 'الفاتورة المبسطة — Reporting', en: 'Simplified invoice — Reporting',
    detailAr: 'مسار إرسال مبدئي محمي؛ لا توجد شهادات CSID فعلية أو ربط إنتاجي.',
    detailEn: 'Guarded preliminary reporting path; no live CSID or production connection.',
    stage: 'foundation',
  },
  {
    id: 'zatca-egs',
    ar: 'أجهزة الفوترة وشهادات EGS / CSID', en: 'EGS devices and CSID',
    detailAr: 'جداول خاصة واختبارات تشفير محلية. لا تُدخل المفاتيح الخاصة أو OTP هنا.',
    detailEn: 'Private schema and offline cryptographic tests. Do not enter OTP or private keys here.',
    stage: 'foundation',
  },
];

const DELIVERY_APPS: IntegrationTile[] = [
  {
    id: 'talabat', ar: 'طلبات', en: 'Talabat',
    detailAr: 'يلزم اتفاق تكامل ومفاتيح API من المزوّد قبل استقبال الطلبات تلقائيًا.',
    detailEn: 'Provider agreement and API credentials are needed for automatic order ingestion.',
    stage: 'not_connected',
  },
  {
    id: 'hungerstation', ar: 'هنقرستيشن', en: 'HungerStation',
    detailAr: 'لم يتم إعداد موصّل API أو مزامنة المنيو والطلبات.',
    detailEn: 'API connector, menu sync and order ingestion are not implemented.',
    stage: 'not_connected',
  },
  {
    id: 'jahez', ar: 'جاهز', en: 'Jahez',
    detailAr: 'التكامل الخارجي غير مفعّل؛ لا توجد طلبات واردة من المنصة بعد.',
    detailEn: 'External integration is inactive; no platform orders are being imported.',
    stage: 'not_connected',
  },
  {
    id: 'other', ar: 'مزود توصيل آخر', en: 'Other delivery provider',
    detailAr: 'يُضاف بعد توفير توثيق API والصلاحيات الخاصة بالمزوّد.',
    detailEn: 'Can be added after provider API documentation and authorization are available.',
    stage: 'not_connected',
  },
];

export const INTEGRATION_TILES: Record<IntegrationSection, IntegrationTile[]> = {
  egypt: TAX_EGYPT,
  saudi: TAX_SAUDI,
  delivery: DELIVERY_APPS,
};

export function IntegrationsHubPage() {
  const { lang } = useLanguage();
  const { user } = useAuth();
  const { branches, loading: branchesLoading, error: branchesError } = useBranches();
  const ar = lang === 'ar';
  const [section, setSection] = useState<IntegrationSection | 'all' | 'installed'>('all');
  const [search, setSearch] = useState('');
  const [requestedBranchId, setRequestedBranchId] = useState('');
  const eligibleBranches = user?.branch_id && user.role !== 'super_admin'
    ? branches.filter((branch) => branch.id === user.branch_id)
    : branches;
  const selectedBranchId = eligibleBranches.some((branch) => branch.id === requestedBranchId)
    ? requestedBranchId : eligibleBranches[0]?.id ?? '';
  const selectedBranch = eligibleBranches.find((branch) => branch.id === selectedBranchId);
  const [installedApps, setInstalledApps] = useState<InstalledAppMap>({});
  const [openedAppId, setOpenedAppId] = useState<IntegrationAppId | null>(null);
  const [installError, setInstallError] = useState('');
  const [installLoading, setInstallLoading] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [reloadCentral, setReloadCentral] = useState(0);
  const [legacyApps, setLegacyApps] = useState<InstalledAppMap>({});
  const [showImportReview, setShowImportReview] = useState(false);
  const userId = user?.id ?? '';
  const organizationId = selectedBranch?.organization_id ?? '';
  const scopeKey = `${userId}:${selectedBranchId}:${organizationId}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  useEffect(() => {
    let cancelled = false;
    setOpenedAppId(null);
    setInstallError('');
    setInstalledApps({});
    setShowImportReview(false);
    setLegacyApps(userId && selectedBranchId ? readInstalledApps(userId, selectedBranchId) : {});
    if (!userId || !selectedBranchId) {
      setInstallLoading(false);
      return;
    }
    if (!CENTRAL_INSTALLATIONS_ENABLED) {
      setInstalledApps(readInstalledApps(userId, selectedBranchId));
      setInstallLoading(false);
      return;
    }
    setInstallLoading(true);
    if (!organizationId) {
      setInstallError(ar ? 'الفرع غير مرتبط بمؤسسة؛ التثبيت المركزي غير متاح.' : 'Branch organization missing; central installations unavailable.');
      setInstallLoading(false);
      return;
    }
    void loadCentralInstalledApps(organizationId, selectedBranchId)
      .then((apps) => { if (!cancelled) setInstalledApps(apps); })
      .catch(() => {
        if (!cancelled) setInstallError(ar
          ? 'تعذر تحميل التطبيقات المركزية. لا يمكن حفظ التثبيت حتى يعود الاتصال.'
          : 'Could not load central installations. Changes are disabled until connection is restored.');
      })
      .finally(() => { if (!cancelled) setInstallLoading(false); });
    return () => { cancelled = true; };
  }, [userId, selectedBranchId, organizationId, ar, reloadCentral]);

  async function changeInstallation(appId: IntegrationAppId, install: boolean) {
    if (!userId || !selectedBranchId || installBusy || installLoading) return;
    const operationScope = scopeKey;
    setInstallBusy(true);
    try {
      const state = CENTRAL_INSTALLATIONS_ENABLED
        ? await changeCentralAppInstallation(organizationId, selectedBranchId, appId, userId, install)
        : updateLocalAppInstallation(userId, selectedBranchId, appId, install);
      if (scopeRef.current !== operationScope) return;
      setInstalledApps(state);
      setInstallError('');
      setOpenedAppId(install ? appId : null);
    } catch {
      if (scopeRef.current !== operationScope) return;
      setInstallError(ar
        ? (CENTRAL_INSTALLATIONS_ENABLED
          ? 'رفض الخادم العملية أو تعذر الاتصال. لم يُسجل تثبيت جديد.'
          : 'تعذّر حفظ تثبيت التطبيق في هذا المتصفح. راجع أذونات التخزين.')
        : (CENTRAL_INSTALLATIONS_ENABLED
          ? 'Server rejected the operation or could not be reached. No install was confirmed.'
          : 'Could not save the local installation. Check browser storage permissions.'));
    } finally {
      setInstallBusy(false);
    }
  }

  const pendingLegacyApps = CENTRAL_INSTALLATIONS_ENABLED
    ? getPendingLegacyApps(legacyApps, installedApps)
    : [];

  async function confirmLegacyImport() {
    if (!CENTRAL_INSTALLATIONS_ENABLED || !showImportReview || !userId || !organizationId ||
        !selectedBranchId || installBusy || installLoading || installError) return;
    const operationScope = scopeKey;
    setInstallBusy(true);
    try {
      const state = await importConfirmedLegacyApps(
        organizationId, selectedBranchId, userId, legacyApps, installedApps,
      );
      if (scopeRef.current !== operationScope) return;
      setInstalledApps(state);
      setShowImportReview(false);
      setInstallError('');
    } catch {
      if (scopeRef.current !== operationScope) return;
      setShowImportReview(false);
      setInstallError(ar
        ? 'لم يكتمل استيراد التطبيقات. قد يكون بعضها محفوظًا؛ أعد تحميل قائمة الفرع للتحقق قبل إعادة المحاولة.'
        : 'Import could not finish. Some apps may have been saved; reload the branch list to verify before retrying.');
    } finally {
      setInstallBusy(false);
    }
  }

  const allApps = Object.values(INTEGRATION_TILES).flat();
  const activeApp = allApps.find((app) => app.id === openedAppId);
  const filteredApps = allApps.filter((app) => {
    const matchesCategory = section === 'all' || section === 'installed'
      ? section !== 'installed' || Boolean(installedApps[app.id])
      : INTEGRATION_TILES[section].some((candidate) => candidate.id === app.id);
    const matchesSearch = (app.ar + ' ' + app.en + ' ' + app.id).toLowerCase().includes(search.trim().toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const categories = [
    { key: 'all', ar: 'اكتشف', en: 'Discover' },
    { key: 'installed', ar: 'تطبيقاتي', en: 'My apps' },
    { key: 'egypt', ar: 'الضرائب المصرية', en: 'Egyptian Tax' },
    { key: 'saudi', ar: 'الضرائب السعودية', en: 'Saudi ZATCA' },
    { key: 'delivery', ar: 'تطبيقات التوصيل', en: 'Delivery Apps' },
  ] as const;

  function appCategory(appId: IntegrationAppId) {
    if (INTEGRATION_TILES.egypt.some((app) => app.id === appId)) return ar ? 'الضرائب المصرية' : 'Egyptian Tax';
    if (INTEGRATION_TILES.saudi.some((app) => app.id === appId)) return ar ? 'الضرائب السعودية' : 'Saudi Tax';
    return ar ? 'تطبيقات التوصيل' : 'Delivery Apps';
  }

  function appIcon(appId: IntegrationAppId) {
    const iconClass = 'h-9 w-9';
    if (INTEGRATION_TILES.egypt.some((app) => app.id === appId)) return <FileText className={iconClass} />;
    if (INTEGRATION_TILES.saudi.some((app) => app.id === appId)) return <ShieldCheck className={iconClass} />;
    return <Truck className={iconClass} />;
  }

  function setupSteps(appId: IntegrationAppId) {
    if (INTEGRATION_TILES.egypt.some((app) => app.id === appId)) {
      return ar
        ? ['تسجيل المنشأة والفرع لدى مصلحة الضرائب المصرية', 'تجهيز التوقيع الرقمي والاعتماد في خدمة خلفية آمنة', 'اجتياز اختبار الفواتير أو الإيصالات في البيئة الرسمية']
        : ['Register the organization and branch with ETA', 'Provision secure server-side digital signing credentials', 'Pass official invoice or receipt tests'];
    }
    if (INTEGRATION_TILES.saudi.some((app) => app.id === appId)) {
      return ar
        ? ['التحقق من الرقم الضريبي وبيانات الفرع', 'إكمال تسجيل EGS وشهادات CSID في الخادم', 'اختبار التوقيع والتوافق قبل Clearance أو Reporting']
        : ['Verify VAT and branch information', 'Register EGS and CSID securely on the server', 'Test compliant signing before clearance or reporting'];
    }
    return ar
      ? ['الحصول على موافقة منصة التوصيل وتوثيق API', 'ربط المنتجات والأسعار والفروع عبر خدمة خلفية', 'اختبار الطلبات والإلغاء ومنع التكرار']
      : ['Get provider approval and API documentation', 'Map products, pricing and branches through a backend', 'Test new orders, cancellation and deduplication'];
  }

  const backIcon = ar ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />;

  return (
    <div className="space-y-5" data-testid="integrations-hub">
      <PageHeader title={ar ? 'متجر التطبيقات' : 'App Store'}
        subtitle={ar ? 'اكتشف تطبيقات Premier وثبّتها حسب الفرع' : 'Discover and install apps for each Premier branch'} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ui-border bg-ui-surface px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-600/10 text-brand-600">
            <LayoutGrid className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-ui-text">{ar ? 'تطبيقات Premier' : 'Premier Apps'}</p>
            <p className="text-xs text-ui-muted" data-testid="integration-branch-scope">
              {selectedBranch ? selectedBranch.name : (ar ? 'اختر فرعًا' : 'Select a branch')}
              {' · '}{Object.keys(installedApps).length} {ar ? 'مثبّت' : 'installed'}
            </p>
          </div>
        </div>
        {eligibleBranches.length > 0 ? (
          <select aria-label={ar ? 'اختيار فرع التكامل' : 'Select integration branch'}
            value={selectedBranchId} onChange={(event) => setRequestedBranchId(event.target.value)}
            className="min-h-10 max-w-full rounded-xl border border-ui-border bg-ui-page px-3 text-sm text-ui-text">
            {eligibleBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        ) : (
          <span className="text-sm text-ui-muted" role="status">
            {branchesLoading ? (ar ? 'تحميل الفروع...' : 'Loading branches...') :
              branchesError ? (ar ? 'تعذر تحميل الفروع' : 'Branches unavailable') :
                (ar ? 'لا توجد فروع' : 'No branches')}
          </span>
        )}
      </div>

      {installError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-600">
          <span>{installError}</span>
          {CENTRAL_INSTALLATIONS_ENABLED && (
            <button type="button" disabled={installLoading || installBusy}
              className="rounded-lg border border-ui-border px-3 py-2 text-ui-text"
              onClick={() => setReloadCentral((value) => value + 1)}>
              {ar ? 'إعادة المحاولة' : 'Retry'}
            </button>
          )}
        </div>
      )}

      {activeApp ? (
        <section data-testid={'app-detail-' + activeApp.id} className="space-y-5">
          <button type="button" onClick={() => setOpenedAppId(null)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-semibold text-ui-muted hover:bg-ui-page-alt hover:text-ui-text">
            {backIcon} {ar ? 'كل التطبيقات' : 'All apps'}
          </button>
          <div className="rounded-3xl border border-ui-border bg-ui-surface p-5 sm:p-7">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[1.7rem] bg-brand-600/10 text-brand-600 shadow-ui-sm">
                {appIcon(activeApp.id)}
              </div>
              <div className="flex-1 space-y-1">
                <h2 className="text-2xl font-bold text-ui-text">{ar ? activeApp.ar : activeApp.en}</h2>
                <p className="text-sm text-ui-muted">{appCategory(activeApp.id)}</p>
                <p className="text-sm font-semibold text-ui-muted">{ar ? 'غير متصل بمزوّد الخدمة' : 'Provider not connected'}</p>
              </div>
              {installedApps[activeApp.id] ? (
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 rounded-xl bg-brand-600/10 px-3 py-2 text-sm font-bold text-brand-600">
                    <Check className="h-4 w-4" />{ar ? 'مثبّت' : 'Installed'}
                  </span>
                  <button type="button" data-testid={'remove-integration-' + activeApp.id}
                    disabled={installBusy || installLoading || Boolean(installError && CENTRAL_INSTALLATIONS_ENABLED)}
                    onClick={() => void changeInstallation(activeApp.id, false)}
                    className="rounded-xl border border-ui-border px-4 py-2 text-sm font-semibold text-ui-text disabled:opacity-50">
                    {ar ? 'إزالة' : 'Remove'}
                  </button>
                </div>
              ) : (
                <button type="button" data-testid={'install-integration-' + activeApp.id}
                  disabled={!userId || !selectedBranchId || installBusy || installLoading || Boolean(installError && CENTRAL_INSTALLATIONS_ENABLED)}
                  onClick={() => void changeInstallation(activeApp.id, true)}
                  className="rounded-xl bg-brand-600 px-6 py-3 text-sm font-bold text-white disabled:opacity-50">
                  {ar ? 'تثبيت' : 'Install'}
                </button>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-ui-border bg-ui-surface p-5">
            <h3 className="mb-2 text-lg font-bold text-ui-text">{ar ? 'حول التطبيق' : 'About this app'}</h3>
            <p className="text-sm leading-7 text-ui-muted">{ar ? activeApp.detailAr : activeApp.detailEn}</p>
          </div>

          {installedApps[activeApp.id] && (
            <section data-testid={'setup-integration-' + activeApp.id}
              className="space-y-4 rounded-2xl border border-ui-border bg-ui-surface p-5">
              <div className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-brand-600" />
                <h3 className="text-lg font-bold text-ui-text">{ar ? 'إعدادات التطبيق' : 'App settings'}</h3>
              </div>
              <p className="text-sm text-ui-muted">
                {ar
                  ? 'التطبيق مثبت؛ إعدادات الربط الفني ستتوفر هنا عند تجهيز موصّل الخدمة. لا توجد بيانات اعتماد مطلوبة في هذه الشاشة.'
                  : 'App installed. Provider configuration will be available here once a secure connector is ready; no credentials are entered on this screen.'}
              </p>
              <div className="rounded-xl bg-ui-page-alt p-4">
                <h4 className="mb-3 font-semibold text-ui-text">{ar ? 'خطوات تجهيز هذا التطبيق' : 'App setup checklist'}</h4>
                <ol className="list-decimal space-y-2 ps-5 text-sm leading-7 text-ui-muted">
                  {setupSteps(activeApp.id).map((step) => <li key={step}>{step}</li>)}
                </ol>
              </div>
              <p className="text-xs text-ui-muted">
                {CENTRAL_INSTALLATIONS_ENABLED
                  ? (ar ? 'التثبيت محفوظ لهذا الفرع مركزيًا، لكنه لا يفعّل الاتصال الخارجي.' : 'Installation is stored centrally for this branch, but does not enable provider connectivity.')
                  : (ar ? 'التثبيت محفوظ في هذا المتصفح فقط.' : 'Installation is saved on this browser only.')}
              </p>
              {INTEGRATION_TILES.delivery.some((app) => app.id === activeApp.id) && (
                <Link to={APP_ROUTES.delivery} className="inline-flex items-center gap-2 text-sm font-semibold text-brand-600">
                  <Store className="h-4 w-4" />{ar ? 'فتح التوصيل الداخلي' : 'Open internal delivery'}
                  {ar ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                </Link>
              )}
            </section>
          )}
        </section>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ui-muted" />
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
              aria-label={ar ? 'البحث عن تطبيق' : 'Search apps'}
              placeholder={ar ? 'ابحث عن تطبيق...' : 'Search apps...'}
              className="h-12 w-full rounded-2xl border border-ui-border bg-ui-surface pe-4 ps-12 text-sm text-ui-text outline-none focus:border-brand-600" />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={ar ? 'فئات التطبيقات' : 'App categories'}>
            {categories.map((category) => (
              <button type="button" role="tab" key={category.key}
                aria-selected={section === category.key}
                onClick={() => setSection(category.key)}
                className={'shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors ' +
                  (section === category.key ? 'bg-brand-600 text-white' : 'border border-ui-border bg-ui-surface text-ui-text hover:bg-ui-page-alt')}>
                {ar ? category.ar : category.en}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold text-ui-text">
              {ar ? categories.find((item) => item.key === section)?.ar : categories.find((item) => item.key === section)?.en}
            </h2>
            <span className="text-xs text-ui-muted" data-testid="installed-app-count">
              {Object.keys(installedApps).length} {ar ? 'تطبيقات مثبتة' : 'installed'}
            </span>
          </div>

          {installLoading ? (
            <p className="rounded-xl bg-ui-surface p-6 text-center text-ui-muted" role="status">
              {ar ? 'جاري تحميل التطبيقات...' : 'Loading apps...'}
            </p>
          ) : filteredApps.length === 0 ? (
            <div className="rounded-2xl border border-ui-border bg-ui-surface p-10 text-center" data-testid="empty-app-results">
              <LayoutGrid className="mx-auto mb-3 h-9 w-9 text-ui-muted" />
              <p className="font-semibold text-ui-text">{ar ? 'لا توجد تطبيقات مطابقة' : 'No matching apps'}</p>
              <p className="mt-1 text-sm text-ui-muted">{ar ? 'جرّب بحثًا آخر أو تصنيفًا مختلفًا' : 'Try another search or category'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-testid="apps-catalog-grid">
              {filteredApps.map((app) => (
                <button type="button" key={app.id} onClick={() => setOpenedAppId(app.id)}
                  data-testid={'integration-' + app.id}
                  aria-label={(ar ? 'تفاصيل تطبيق ' : 'App details ') + (ar ? app.ar : app.en)}
                  className="group flex min-w-0 flex-col items-start gap-3 rounded-2xl border border-ui-border bg-ui-surface p-4 text-start shadow-ui-sm transition hover:-translate-y-0.5 hover:border-brand-600/40 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
                  <div className="flex h-16 w-16 items-center justify-center rounded-[1.25rem] bg-brand-600/10 text-brand-600 transition group-hover:scale-105">
                    {appIcon(app.id)}
                  </div>
                  <div className="w-full min-w-0">
                    <p className="truncate text-sm font-bold text-ui-text" title={ar ? app.ar : app.en}>{ar ? app.ar : app.en}</p>
                    <p className="mt-1 truncate text-xs text-ui-muted">{appCategory(app.id)}</p>
                  </div>
                  <span className={'mt-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ' +
                    (installedApps[app.id] ? 'bg-brand-600/10 text-brand-600' : 'bg-ui-page-alt text-ui-muted')}>
                    {installedApps[app.id] ? <Check className="h-3 w-3" /> : null}
                    {installedApps[app.id] ? (ar ? 'مثبّت' : 'Installed') : (ar ? 'متاح' : 'Available')}
                  </span>
                </button>
              ))}
            </div>
          )}

          {CENTRAL_INSTALLATIONS_ENABLED && !installLoading && !installError && pendingLegacyApps.length > 0 && (
            <details className="rounded-2xl border border-ui-border bg-ui-surface p-4" data-testid="legacy-integration-import">
              <summary className="cursor-pointer text-sm font-semibold text-ui-text">
                {ar ? 'استيراد تطبيقاتي السابقة من هذا المتصفح' : 'Import my previous browser apps'}
                {' · '}{pendingLegacyApps.length}
              </summary>
              <div className="mt-3 space-y-3">
                <p className="text-sm text-ui-muted">
                  {ar ? 'يتطلب الاستيراد تأكيدك، وتظل صلاحيات الفرع مطبقة.' : 'Import requires your confirmation and branch authorization.'}
                </p>
                {!showImportReview ? (
                  <button type="button" onClick={() => setShowImportReview(true)}
                    data-testid="review-legacy-integration-import"
                    className="rounded-lg border border-ui-border px-4 py-2 text-sm font-semibold text-ui-text">
                    {ar ? 'مراجعة' : 'Review'}
                  </button>
                ) : (
                  <div data-testid="confirm-legacy-integration-import" className="space-y-3">
                    <ul className="list-disc space-y-1 ps-5 text-sm text-ui-muted">
                      {pendingLegacyApps.map((id) => <li key={id}>{ar ? allApps.find((app) => app.id === id)?.ar : allApps.find((app) => app.id === id)?.en}</li>)}
                    </ul>
                    <button type="button" onClick={() => void confirmLegacyImport()} disabled={installBusy}
                      data-testid="execute-legacy-integration-import"
                      className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                      {ar ? 'تأكيد الاستيراد للفرع' : 'Confirm branch import'}
                    </button>
                    <button type="button" onClick={() => setShowImportReview(false)} disabled={installBusy}
                      className="ms-2 rounded-xl border border-ui-border px-4 py-2 text-sm text-ui-text">
                      {ar ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                )}
              </div>
            </details>
          )}

          <p className="text-xs leading-6 text-ui-muted">
            {CENTRAL_INSTALLATIONS_ENABLED
              ? (ar ? 'التثبيت خاص بالفرع، ولا يعني وجود اتصال بالجهات الضريبية أو منصات التوصيل.' : 'Installation is shared by branch; tax authorities and delivery providers remain disconnected.')
              : (ar ? 'التثبيت محفوظ على هذا المتصفح فقط؛ لا توجد اتصالات خارجية مفعلة.' : 'Installations are browser-local; external providers remain disconnected.')}
          </p>
        </>
      )}
    </div>
  );
}
