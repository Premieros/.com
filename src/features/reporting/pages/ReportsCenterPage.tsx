import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, ChevronDown, ChevronUp, BarChart3, Star, LayoutGrid, ArrowLeft, ArrowRight, ShieldCheck } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ReportsPage } from './ReportsPage';
import { FinancialReportsPage } from '@/features/accounting/pages/FinancialReportsPage';
import { ReportsExecutiveKpis } from '../components/ReportsExecutiveKpis';
import { useCan, type Permission } from '@/lib/permissions';
import { useBranchScope } from '@/lib/branchScope';
import { useLanguage } from '@/context/LanguageContext';
import { REPORT_REGISTRY, REPORT_CATEGORIES, type ReportCategory } from '../reportRegistry';
import type { ReportType } from '../reportFilters';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';
import { businessFinancialViewAllowed, businessReportAllowed } from '@/core/organizations/businessRuntime';

type FinancialView =
  | 'trial_balance'
  | 'ledger'
  | 'treasury_statement'
  | 'inventory_movement'
  | 'income'
  | 'balance_sheet'
  | 'ar_aging'
  | 'ap_aging'
  | 'aging_summary'
  | 'cash_flow'
  | 'party_statement';

// Reuse the same registry, permissions and report loaders used by the
// operational screens. No shadow reporting engine or summary SQL is created.
const FAVORITES_KEY = 'premire_report_favorites';

function loadFavorites(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch { return []; }
}

const LEGACY_HIDDEN_REPORTS = new Set<ReportType>([
  'component_consumption',
  'recipe_costs',
  'top_consumed_components',
  'top_consumed_products',
]);

const FINANCIAL_REPORTS: Array<{ key: FinancialView; ar: string; en: string }> = [
  { key: 'treasury_statement', ar: 'كشف حساب بنك / خزنة', en: 'Bank / Treasury Statement' },
  { key: 'inventory_movement', ar: 'حركة صنف', en: 'Item Movement' },
  { key: 'ledger', ar: 'دفتر الأستاذ', en: 'General Ledger' },
  { key: 'trial_balance', ar: 'ميزان المراجعة', en: 'Trial Balance' },
  { key: 'income', ar: 'قائمة الدخل', en: 'Income Statement' },
  { key: 'balance_sheet', ar: 'الميزانية', en: 'Balance Sheet' },
  { key: 'ar_aging', ar: 'أعمار ديون العملاء', en: 'AR Aging' },
  { key: 'ap_aging', ar: 'أعمار ديون الموردين', en: 'AP Aging' },
  { key: 'aging_summary', ar: 'ملخص الذمم', en: 'Aging Summary' },
  { key: 'cash_flow', ar: 'التدفقات النقدية', en: 'Cash Flow' },
  { key: 'party_statement', ar: 'كشف حساب عميل / مورد', en: 'Party Statement' },
];

export function ReportsCenterPage() {
  const can = useCan();
  const branchScope = useBranchScope();
  const { lang } = useLanguage();
  const { runtime } = useOrganizationModules();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<ReportCategory | 'all'>('all');
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);
  const [showDirectory, setShowDirectory] = useState(false);
  const toggleFavorite = useCallback((key: string) => {
    setFavorites((previous) => {
      const next = previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const requestedType = searchParams.get('type') as ReportType | null;
  const requestedFinancialView = searchParams.get('view') as FinancialView | null;
  const requestedFinancial =
    location.pathname.includes('financial-reports')
    || searchParams.get('section') === 'financial'
    || Boolean(requestedFinancialView);

  const permittedOperational = useMemo(
    () => REPORT_REGISTRY.filter((report) =>
      !LEGACY_HIDDEN_REPORTS.has(report.key)
      && report.permissions.every((permission) => can(permission as Permission))
      && businessReportAllowed(runtime, report.key, report.category)
    ),
    [can, runtime],
  );

  const initialOperational =
    requestedType && permittedOperational.some((report) => report.key === requestedType)
      ? requestedType
      : permittedOperational[0]?.key || 'sales';

  const [activeReport, setActiveReport] = useState<ReportType>(initialOperational);

  useEffect(() => {
    if (requestedType && permittedOperational.some((report) => report.key === requestedType)) {
      setActiveReport(requestedType);
    }
  }, [requestedType, permittedOperational]);

  const canFinancial = can('reports.financial');
  const allowedFinancialViews = FINANCIAL_REPORTS.filter((report) => businessFinancialViewAllowed(runtime, report.key));
  const activeFinancialView: FinancialView =
    requestedFinancialView && allowedFinancialViews.some((report) => report.key === requestedFinancialView)
      ? requestedFinancialView
      : allowedFinancialViews[0]?.key || 'trial_balance';

  const filteredOperational = useMemo(() => {
    const q = search.trim().toLowerCase();
    const categoryReports = activeCategory === 'all' ? permittedOperational : permittedOperational.filter((item) => item.category === activeCategory);
    if (!q) return categoryReports;
    return categoryReports.filter((report) =>
      report.title.toLowerCase().includes(q)
      || report.titleEn.toLowerCase().includes(q)
      || report.description.toLowerCase().includes(q)
      || report.descriptionEn.toLowerCase().includes(q)
      || report.key.toLowerCase().includes(q)
    );
  }, [search, activeCategory, permittedOperational]);

  const filteredFinancial = useMemo(() => {
    if (!canFinancial || (activeCategory !== 'all' && activeCategory !== 'financial')) return [];
    const allowed = FINANCIAL_REPORTS.filter((report) => businessFinancialViewAllowed(runtime, report.key));
    const q = search.trim().toLowerCase();
    if (!q) return allowed;
    return allowed.filter((report) =>
      report.ar.toLowerCase().includes(q)
      || report.en.toLowerCase().includes(q)
      || report.key.toLowerCase().includes(q)
    );
  }, [search, activeCategory, canFinancial, runtime]);

  const permittedCategories = useMemo(() => {
    const used = new Set(permittedOperational.map((item) => item.category));
    if (canFinancial && FINANCIAL_REPORTS.some((item) => businessFinancialViewAllowed(runtime, item.key))) {
      used.add('financial');
    }
    return (Object.entries(REPORT_CATEGORIES) as Array<[ReportCategory, typeof REPORT_CATEGORIES[ReportCategory]]>)
      .filter(([key]) => used.has(key))
      .sort((a, b) => a[1].order - b[1].order);
  }, [permittedOperational, canFinancial, runtime]);

  const selectOperational = useCallback((type: ReportType) => {
    setActiveReport(type);
    setMobileListOpen(false);
    setShowDirectory(false);
    navigate(`/reports?type=${type}`, { replace: true });
  }, [navigate]);

  const selectFinancial = useCallback((view: FinancialView) => {
    setMobileListOpen(false);
    setShowDirectory(false);
    navigate(`/reports?section=financial&view=${view}`, { replace: true });
  }, [navigate]);

  const currentName = requestedFinancial
    ? allowedFinancialViews.find((report) => report.key === activeFinancialView)
    : permittedOperational.find((report) => report.key === activeReport);


  const isAr = lang === 'ar';
  const reportList = (
    <div className="overflow-hidden rounded-xl border border-ui-border bg-ui-surface shadow-ui-sm" data-testid="premier-reports-directory">
      <div className="border-b border-ui-border p-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-muted" />
          <span className="sr-only">{isAr ? 'ابحث عن تقرير' : 'Search reports'}</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={isAr ? 'ابحث عن تقرير أو مجال عمل...' : 'Find a report...'}
            className="h-10 w-full rounded-lg border border-ui-border bg-ui-page-alt ps-9 pe-3 text-sm text-ui-text outline-none focus-visible:ring-2 focus-visible:ring-ui-ring"
          />
        </label>
        <div className="mt-3 flex gap-1 overflow-x-auto pb-1 lg:flex-wrap">
          <button
            type="button"
            onClick={() => setActiveCategory('all')}
            className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${activeCategory === 'all' ? 'bg-ui-primary text-ui-primary-fg' : 'bg-ui-page-alt text-ui-muted hover:text-ui-text'}`}
          >
            {isAr ? 'جميع الأقسام' : 'All'}
          </button>
          {permittedCategories.map(([key, category]) => (
            <button
              type="button"
              key={key}
              onClick={() => setActiveCategory(key)}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${activeCategory === key ? 'bg-ui-primary text-ui-primary-fg' : 'bg-ui-page-alt text-ui-muted hover:text-ui-text'}`}
            >
              {isAr ? category.title : category.titleEn}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[min(76vh,760px)] overflow-y-auto p-2">
        {filteredOperational.map((report) => {
          const selected = !requestedFinancial && activeReport === report.key;
          return (
            <div key={report.key} className={`group mb-1 flex items-center rounded-lg transition ${selected ? 'bg-ui-primary/10' : 'hover:bg-ui-page-alt'}`}>
              <button
                type="button"
                aria-current={selected ? 'page' : undefined}
                onClick={() => selectOperational(report.key)}
                className={`min-w-0 flex-1 px-3 py-2.5 text-start ${selected ? 'text-ui-primary' : 'text-ui-text'}`}
              >
                <span className="block truncate text-xs font-bold">{isAr ? report.title : report.titleEn}</span>
                <span className="mt-0.5 block truncate text-[11px] text-ui-muted">{isAr ? report.description : report.descriptionEn}</span>
              </button>
              <button
                type="button"
                onClick={() => toggleFavorite(report.key)}
                aria-label={favorites.includes(report.key) ? (isAr ? 'إزالة من المفضلة' : 'Remove favorite') : (isAr ? 'إضافة للمفضلة' : 'Add favorite')}
                className="shrink-0 rounded-lg p-2 text-ui-muted hover:text-ui-primary"
              >
                <Star className={`h-4 w-4 ${favorites.includes(report.key) ? 'fill-current text-ui-primary' : ''}`} />
              </button>
            </div>
          );
        })}
        {filteredFinancial.map((report) => {
          const selected = requestedFinancial && activeFinancialView === report.key;
          return (
            <button
              key={report.key}
              type="button"
              aria-current={selected ? 'page' : undefined}
              onClick={() => selectFinancial(report.key)}
              className={`mb-1 block w-full rounded-lg px-3 py-2.5 text-start text-xs font-bold transition ${selected ? 'bg-ui-primary/10 text-ui-primary' : 'text-ui-text hover:bg-ui-page-alt'}`}
            >
              {isAr ? report.ar : report.en}
            </button>
          );
        })}
        {filteredOperational.length === 0 && filteredFinancial.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-ui-muted">{isAr ? 'لا توجد تقارير متاحة بهذه الصلاحيات أو الفلاتر' : 'No reports available for this search or permissions'}</p>
        )}
      </div>
    </div>
  );

  return (
    <section className="space-y-4" dir={isAr ? 'rtl' : 'ltr'} data-testid="unified-reports-center">
      <header className="overflow-hidden rounded-2xl border border-ui-border bg-ui-surface shadow-ui-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 p-4 sm:p-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ui-primary/10 text-ui-primary">
              <BarChart3 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-extrabold tracking-wide text-ui-primary">PREMIER OS</p>
              <h1 className="text-xl font-black text-ui-text sm:text-2xl">Premier Reports Center</h1>
              <p className="mt-1 text-xs text-ui-muted">
                {isAr ? 'تقارير المبيعات والتكاليف والمخزون والحسابات من مصادر النظام المعتمدة' : 'Sales, costing, inventory and finance from Premier’s existing sources'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-w-[180px] flex-col gap-1 text-xs font-semibold text-ui-muted">
              {isAr ? 'نطاق الفروع' : 'Branch scope'}
              <select
                value={branchScope.allBranchesSelected ? '__all' : branchScope.selectedBranchIds.length === 1 ? branchScope.selectedBranchIds[0] : '__selected'}
                onChange={(event) => {
                  if (event.target.value === '__all') branchScope.setAllBranches(true);
                  else if (event.target.value !== '__selected') branchScope.setSelectedBranchIds([event.target.value]);
                }}
                aria-label={isAr ? 'تصفية التقارير حسب الفرع المصرح' : 'Authorized report branch filter'}
                className="h-9 rounded-lg border border-ui-border bg-ui-page-alt px-2 text-xs font-bold text-ui-text"
              >
                <option value="__all">{isAr ? 'كل الفروع المصرح بها' : 'All authorized branches'}</option>
                {branchScope.selectedBranchIds.length > 1 && !branchScope.allBranchesSelected && (
                  <option value="__selected">{isAr ? 'فروع محددة' : 'Selected branches'}</option>
                )}
                {branchScope.organizationBranches.map((item) => (
                  <option key={item.id} value={item.id}>{isAr ? item.name : (item.name_en || item.name)}</option>
                ))}
              </select>
            </label>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-ui-border bg-ui-page-alt px-3 py-2 text-xs font-semibold text-ui-muted">
              <ShieldCheck className="h-4 w-4" />
              {isAr ? 'حسب صلاحياتك' : 'Permission scoped'}
            </span>
            <button
              type="button"
              aria-expanded={showDirectory}
              onClick={() => setShowDirectory(!showDirectory)}
              className="inline-flex items-center gap-2 rounded-lg border border-ui-border bg-ui-page-alt px-3 py-2 text-xs font-bold text-ui-text hover:border-ui-primary lg:hidden"
            >
              <LayoutGrid className="h-4 w-4" />{isAr ? 'استعراض الأقسام' : 'Browse sections'}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ui-border bg-ui-page-alt/40 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <span className="text-[11px] font-semibold text-ui-muted">{isAr ? 'التقرير الحالي' : 'Current report'}</span>
            <h2 className="truncate text-sm font-extrabold text-ui-text">
              {currentName
                ? ('title' in currentName ? (isAr ? currentName.title : currentName.titleEn) : (isAr ? currentName.ar : currentName.en))
                : (isAr ? 'التقارير المتاحة' : 'Available reports')}
            </h2>
          </div>
          <div className="flex gap-2">
            {favorites.filter((key) => permittedOperational.some((report) => report.key === key)).slice(0, 2).map((key) => {
              const favorite = permittedOperational.find((report) => report.key === key);
              return favorite ? (
                <button key={key} type="button" onClick={() => selectOperational(favorite.key)}
                  className="hidden max-w-36 truncate rounded-lg border border-ui-border bg-ui-surface px-3 py-2 text-xs font-bold text-ui-muted hover:text-ui-primary sm:block">
                  <Star className="me-1 inline h-3.5 w-3.5 fill-current" />{isAr ? favorite.title : favorite.titleEn}
                </button>
              ) : null;
            })}
            <button type="button" onClick={() => { setMobileListOpen(!mobileListOpen); setShowDirectory(!mobileListOpen); }}
              className="flex items-center gap-2 rounded-lg border border-ui-border bg-ui-surface px-3 py-2 text-xs font-bold text-ui-text lg:hidden">
              {isAr ? 'اختيار تقرير' : 'Choose report'} {mobileListOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>
      {canFinancial && businessFinancialViewAllowed(runtime, 'income') && <ReportsExecutiveKpis />}
      {showDirectory && <div className="lg:hidden">{reportList}</div>}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="hidden lg:sticky lg:top-3 lg:block lg:self-start">
          {reportList}
        </aside>
        <main className="min-w-0" data-testid="premier-reports-content">
          {requestedFinancial && canFinancial && allowedFinancialViews.length > 0 ? (
            <FinancialReportsPage hideViewPicker />
          ) : permittedOperational.some((report) => report.key === activeReport) ? (
            <ReportsPage controlledReportType={activeReport} onReportTypeChange={selectOperational} />
          ) : (
            <div className="rounded-xl border border-ui-border bg-ui-surface px-6 py-12 text-center text-sm text-ui-muted">
              {isAr ? 'اختر تقريرًا مسموحًا لك لعرض بياناته الحقيقية' : 'Select an authorized report to view live data'}
              {isAr ? <ArrowLeft className="mx-auto mt-4 h-5 w-5" /> : <ArrowRight className="mx-auto mt-4 h-5 w-5" />}
            </div>
          )}
        </main>
      </div>
    </section>
  );
}
