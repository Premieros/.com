import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, ArrowRight, ClipboardList,
  ExternalLink, FileText, LockKeyhole, ShieldCheck, Store, Truck,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { useLanguage } from '@/context/LanguageContext';
import { APP_ROUTES } from '@/core/navigation/routes';
import { useAuth } from '@/context/AuthContext';
import { useBranches } from '@/hooks/useBranches';
import { readInstalledApps, updateLocalAppInstallation, type IntegrationAppId, type InstalledAppMap } from '../localAppInstallations';

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
  const [section, setSection] = useState<IntegrationSection>('egypt');
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
  const userId = user?.id ?? '';
  useEffect(() => {
    setInstalledApps(userId && selectedBranchId ? readInstalledApps(userId, selectedBranchId) : {});
    setOpenedAppId(null);
    setInstallError('');
  }, [userId, selectedBranchId]);

  function changeInstallation(appId: IntegrationAppId, install: boolean) {
    if (!userId || !selectedBranchId) return;
    try {
      const state = updateLocalAppInstallation(userId, selectedBranchId, appId, install);
      setInstalledApps(state);
      setInstallError('');
      setOpenedAppId(install ? appId : null);
    } catch {
      setInstallError(ar
        ? 'تعذّر حفظ تثبيت التطبيق في هذا المتصفح. راجع أذونات التخزين.'
        : 'Could not save the local installation. Check browser storage permissions.');
    }
  }

  const sections: Array<{ key: IntegrationSection; ar: string; en: string; icon: typeof FileText }> = [
    { key: 'egypt', ar: 'الضرائب المصرية', en: 'Egyptian Tax', icon: FileText },
    { key: 'saudi', ar: 'الضرائب السعودية', en: 'Saudi ZATCA', icon: ShieldCheck },
    { key: 'delivery', ar: 'تطبيقات التوصيل', en: 'Delivery Apps', icon: Truck },
  ];

  return (
    <div className="space-y-6" data-testid="integrations-hub">
      <PageHeader
        title={ar ? 'التكاملات والربط' : 'Integrations Hub'}
        subtitle={ar
          ? 'مركز متابعة الضرائب المصرية والسعودية وتطبيقات التوصيل'
          : 'Track Egyptian and Saudi tax integrations and delivery platforms'}
      />
      <section className="rounded-2xl border border-ui-border bg-ui-surface p-4 sm:p-5" aria-label={ar ? 'نطاق الفرع' : 'Branch scope'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-ui-text">{ar ? 'الفرع المحدد للتكامل' : 'Integration branch'}</h2>
            <p className="mt-1 text-xs text-ui-muted">{ar
              ? 'اختر الفرع لمراجعة متطلبات ربطه. لا يعني اختيار الفرع وجود اتصال خارجي.'
              : 'Choose the branch to review its setup requirements. A selection does not indicate a live connection.'}</p>
          </div>
          {eligibleBranches.length > 0 ? (
            <label className="flex min-w-48 flex-col gap-1 text-xs font-semibold text-ui-muted">
              {ar ? 'الفرع' : 'Branch'}
              <select
                aria-label={ar ? 'اختيار فرع التكامل' : 'Select integration branch'}
                value={selectedBranchId}
                onChange={(event) => setRequestedBranchId(event.target.value)}
                className="min-h-11 rounded-xl border border-ui-border bg-ui-page px-3 text-sm text-ui-text"
              >
                {eligibleBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <span className="text-sm text-ui-muted" role="status">
              {branchesLoading ? (ar ? 'تحميل الفروع...' : 'Loading branches...') :
                branchesError ? (ar ? 'تعذر جلب الفروع؛ لا يمكن تحديد نطاق الربط.' : 'Could not load branches; connection scope unavailable.') :
                (ar ? 'لا توجد فروع متاحة للحساب.' : 'No branches available to this account.')}
            </span>
          )}
        </div>
        {selectedBranch && (
          <p className="mt-3 text-xs text-ui-muted" data-testid="integration-branch-scope">
            {ar ? 'نطاق العرض الحالي: ' : 'Current view scope: '}<strong>{selectedBranch.name}</strong>
            {' · '}{ar ? 'الجاهزية التالية إرشادية وغير متحقَّق منها للفرع.' : 'The following readiness items are guidance, not verified branch status.'}
          </p>
        )}
      </section>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={ar ? 'فئات التكامل' : 'Integration categories'}>
        {sections.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              id={`integrations-tab-${item.key}`}
              role="tab"
              type="button"
              aria-selected={section === item.key}
              aria-controls="integrations-content"
              onClick={() => setSection(item.key)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-colors border ${
                section === item.key
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-ui-border bg-ui-surface text-ui-text hover:bg-ui-page-alt'
              }`}
            >
              <Icon className="h-4 w-4" />
              {ar ? item.ar : item.en}
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-ui-text" role="status">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <p>{ar
          ? 'يمكنك تثبيت التطبيقات لهذا المستخدم والفرع على هذا المتصفح فقط، ثم فتح خطوات تجهيزها. هذا ليس تثبيتًا مركزيًا على الخادم ولا اتصالًا بالهيئة أو مزوّد التوصيل. لا تُدخل أي مفاتيح API أو شهادات هنا.'
          : 'Install apps locally for this user and branch in this browser, then open setup steps. This is not a server-wide installation or a live provider connection. Never enter private keys or API secrets here.'}</p>
      </div>

      {installError && <p role="alert" className="text-sm text-red-600">{installError}</p>}
      <div className="rounded-xl border border-ui-border bg-ui-surface p-3 text-sm text-ui-muted">
        {ar ? 'تطبيقاتي المثبّتة على هذا المتصفح لهذا الفرع: ' : 'My local apps for this branch: '}
        <strong data-testid="installed-app-count">{Object.keys(installedApps).length}</strong>
      </div>

      <section
        id="integrations-content"
        role="tabpanel"
        aria-labelledby={`integrations-tab-${section}`}
        className="space-y-4"
      >
        <div className="grid gap-4 md:grid-cols-2">
          {INTEGRATION_TILES[section].map((item) => (
            <article key={item.id} className="rounded-2xl border border-ui-border bg-ui-surface p-5 shadow-ui-sm" data-testid={`integration-${item.id}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold text-ui-text">{ar ? item.ar : item.en}</h2>
                <span className="rounded-full border border-ui-border bg-ui-page-alt px-3 py-1 text-xs font-semibold text-ui-muted">
                  {item.stage === 'foundation'
                    ? (ar ? 'تطوير أولي — غير متصل' : 'Foundation — not connected')
                    : (ar ? 'غير متصل' : 'Not connected')}
                </span>
              </div>
              <p className="text-sm leading-7 text-ui-muted">{ar ? item.detailAr : item.detailEn}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {installedApps[item.id] ? (
                  <>
                    <span className="rounded-full border border-ui-border bg-ui-page-alt px-3 py-1 text-xs font-semibold text-ui-muted">
                      {ar ? 'مثبّت محليًا · غير متصل' : 'Locally installed · not connected'}
                    </span>
                    <button type="button" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white"
                      onClick={() => setOpenedAppId(openedAppId === item.id ? null : item.id)}
                      data-testid={`open-integration-${item.id}`}>
                      {ar ? 'فتح التطبيق' : 'Open app'}
                    </button>
                    <button type="button" className="rounded-lg border border-ui-border px-3 py-2 text-sm text-ui-text"
                      onClick={() => changeInstallation(item.id, false)} data-testid={`remove-integration-${item.id}`}>
                      {ar ? 'إزالة' : 'Remove'}
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={!userId || !selectedBranchId}
                    className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    onClick={() => changeInstallation(item.id, true)}
                    data-testid={`install-integration-${item.id}`}>
                    {ar ? 'تثبيت التطبيق' : 'Install app'}
                  </button>
                )}
              </div>
              {openedAppId === item.id && installedApps[item.id] && (
                <div className="mt-4 rounded-xl border border-ui-border bg-ui-page-alt p-3 text-sm" data-testid={`setup-integration-${item.id}`}>
                  <strong className="text-ui-text">{ar ? 'إعداد التطبيق' : 'App setup'}</strong>
                  <p className="mt-1 leading-6 text-ui-muted">{ar
                    ? 'تمت إضافته إلى هذا المتصفح فقط. للربط الحقيقي يلزم موصّل خلفي معتمد وبيانات اعتماد آمنة واختبار اتصال رسمي.'
                    : 'Added only in this browser. Live setup requires a reviewed server connector, secure provider credentials and a verified connection test.'}</p>
                  <p className="mt-2 text-xs text-ui-muted">{ar ? item.detailAr : item.detailEn}</p>
                </div>
              )}
            </article>
          ))}
        </div>

        {selectedBranch && (
          <div className="rounded-2xl border border-ui-border bg-ui-surface p-5" data-testid="integration-readiness-plan">
            <h3 className="mb-3 font-bold text-ui-text">
              {ar ? `خطة تجهيز فرع: ${selectedBranch.name}` : `Setup plan for: ${selectedBranch.name}`}
            </h3>
            <p className="mb-3 text-xs text-ui-muted">
              {ar ? 'هذه متطلبات تحضيرية، وليست مهام مكتملة أو نتيجة اختبار اتصال.' : 'These are preparation requirements, not completed tasks or connection test results.'}
            </p>
            <ol className="list-decimal space-y-2 ps-5 text-sm leading-7 text-ui-muted">
              {(section === 'egypt'
                ? [
                    ar ? 'التحقق من تسجيل المنشأة والفرع لدى مصلحة الضرائب المصرية.' : 'Confirm ETA legal-entity and branch registration.',
                    ar ? 'تهيئة التوقيع الرقمي ومفاتيح الاتصال داخل خدمة خلفية آمنة.' : 'Provision server-side signing and ETA credentials securely.',
                    ar ? 'اختبار الفواتير والإيصالات مع البيئة الرسمية قبل إصدار مستندات حقيقية.' : 'Run official eInvoice and eReceipt conformance tests.',
                  ]
                : section === 'saudi'
                  ? [
                      ar ? 'توثيق المنشأة والرقم الضريبي وربط جهاز EGS بالفرع.' : 'Verify Saudi VAT details and branch EGS enrollment.',
                      ar ? 'إتمام شهادات CSID والتوقيع وفق UBL وQR المعتمدين.' : 'Complete CSID, compliant signed UBL XML and QR.',
                      ar ? 'اختبار Clearance وReporting رسميًا ثم تفعيل الإنتاج لكل عميل.' : 'Pass official clearance/reporting tests before per-tenant production activation.',
                    ]
                  : [
                      ar ? 'الحصول على اعتماد تكامل API من تطبيق التوصيل المطلوب.' : 'Obtain approved API access from the delivery platform.',
                      ar ? 'تجهيز ربط الأصناف والأسعار والفروع دون تخزين الأسرار بالمتصفح.' : 'Map menu, prices and branch scope using server-side credentials.',
                      ar ? 'اختبار استقبال الطلبات ومنع التكرار وإلغاء الطلبات قبل التشغيل.' : 'Test webhook order intake, deduplication and cancellations.',
                    ]).map((step) => <li key={step}>{step}</li>)}
            </ol>
          </div>
        )}

        {section !== 'delivery' ? (
          <div className="rounded-2xl border border-ui-border bg-ui-surface p-5">
            <h3 className="mb-3 flex items-center gap-2 font-bold text-ui-text">
              <ClipboardList className="h-5 w-5 text-brand-600" />
              {ar ? 'المطلوب قبل التفعيل الرسمي' : 'Requirements before activation'}
            </h3>
            <ul className="list-disc space-y-2 ps-5 text-sm leading-7 text-ui-muted">
              <li>{ar ? 'إعداد حساب المنشأة والرقم الضريبي لكل دولة وفرع بشكل معتمد.' : 'Verified legal tax registration and authorized branch information.'}</li>
              <li>{ar ? 'إدارة الأسرار والشهادات داخل خادم آمن، وليس في متصفح الكاشير.' : 'Keep signing credentials and certificates in a secure server vault.'}</li>
              <li>{ar ? 'اختبار التوقيع والملفات وإجراءات الهيئة الرسمية قبل إرسال أي مستند.' : 'Validate signed documents and official authority workflows before submission.'}</li>
            </ul>
          </div>
        ) : (
          <div className="rounded-2xl border border-ui-border bg-ui-surface p-5">
            <h3 className="mb-3 flex items-center gap-2 font-bold text-ui-text">
              <Store className="h-5 w-5 text-brand-600" />
              {ar ? 'الطلبات الداخلية والتوصيل' : 'Internal delivery orders'}
            </h3>
            <p className="mb-4 text-sm leading-7 text-ui-muted">
              {ar
                ? 'يمكن متابعة مسار التوصيل الداخلي الموجود بالفعل في Premier. هذا لا يعني وجود ربط مع تطبيقات التوصيل الخارجية.'
                : 'Premier already has an internal delivery order workflow. This does not mean external delivery platforms are connected.'}
            </p>
            <Link to={APP_ROUTES.delivery} className="inline-flex items-center gap-2 rounded-xl border border-ui-border bg-ui-page-alt px-4 py-2 text-sm font-semibold text-ui-text hover:bg-ui-page">
              {ar ? 'فتح التوصيل الداخلي' : 'Open internal delivery'}
              {ar ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
            </Link>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ui-border bg-ui-page-alt p-4 text-sm text-ui-muted">
        <LockKeyhole className="h-5 w-5 shrink-0" />
        <span>{ar
          ? 'تفعيل أي موصّل حقيقي يحتاج خدمة خلفية ومفاتيح مزوّد موثّقة واختبارات صلاحيات.'
          : 'Enabling any live connector requires a trusted server adapter, verified provider credentials and authorization tests.'}</span>
        <Link to={APP_ROUTES.settings} className="ms-auto inline-flex items-center gap-1 font-bold text-brand-600 hover:underline">
          {ar ? 'إعدادات النظام' : 'System settings'}
          <ExternalLink className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
