import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, BarChart3, Star, LayoutGrid, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ReportsExecutiveKpis, type IncomeKpiVerified } from '../components/ReportsExecutiveKpis';
import { ReportsShowcase } from '../components/ReportsShowcase';
import { useCan, type Permission } from '@/lib/permissions';
import { useBranchScope } from '@/lib/branchScope';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { addIsoDays, businessDateISO } from '@/lib/businessTime';
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
  const history = useHistoryAccess();
  const [draftFrom, setDraftFrom] = useState(() => addIsoDays(businessDateISO(), -6));
  const [draftTo, setDraftTo] = useState(() => businessDateISO());
  const [dateRange, setDateRange] = useState(() => ({ from: addIsoDays(businessDateISO(), -6), to: businessDateISO() }));
  const [periodError, setPeriodError] = useState(false);
  const [overviewRun, setOverviewRun] = useState(0);
  const [verifiedIncome, setVerifiedIncome] = useState<IncomeKpiVerified | null>(null);
  const { lang } = useLanguage();
  const { runtime } = useOrganizationModules();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<ReportCategory | 'all'>('all');
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);
  const [showDirectory, setShowDirectory] = useState(false);
  const [pendingReport, setPendingReport] = useState<string>('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => { if (!pendingReport && initialOperational) setPendingReport(initialOperational); }, [pendingReport, initialOperational]);
  const toggleFavorite = useCallback((key: string) => {
    setFavorites((previous) => {
      const next = previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);


  const permittedOperational = useMemo(
    () => REPORT_REGISTRY.filter((report) =>
      report.permissions.every((permission) => can(permission as Permission))
      && businessReportAllowed(runtime, report.key, report.category)
    ),
    [can, runtime],
  );

  const initialOperational = permittedOperational.find((report) => report.key === 'sales_by_payment')?.key || permittedOperational[0]?.key || '';

  const canFinancial = can('reports.financial');
  const allowedFinancialViews = FINANCIAL_REPORTS.filter((report) => businessFinancialViewAllowed(runtime, report.key));

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

  const applyOverviewDates = () => {
    const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
      && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
      && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
    if (!valid(draftFrom) || !valid(draftTo) || draftFrom > draftTo) {
      setPeriodError(true);
      return;
    }
    const allowed = history.clampRange(draftFrom, draftTo);
    if (allowed.from !== draftFrom || allowed.to !== draftTo) {
      setPeriodError(true);
      return;
    }
    setPeriodError(false);
    setDateRange({ from: draftFrom, to: draftTo });
    setOverviewRun((value) => value + 1);
    const target = pendingReport || initialOperational;
    if (target.startsWith('financial:')) {
      const view = target.slice('financial:'.length);
      if (canFinancial && allowedFinancialViews.some((entry) => entry.key === view)) {
        navigate(`/reports/view?section=financial&view=${view}&from=${draftFrom}&to=${draftTo}`);
      }
    } else if (permittedOperational.some((entry) => entry.key === target)) {
      navigate(`/reports/view?type=${target}&from=${draftFrom}&to=${draftTo}`);
    }
    setShowDirectory(false);
  };

  // Choosing a type only changes the selection; the single View button opens details.
  const selectOperational = useCallback((type: ReportType) => {
    setPendingReport(type);
  }, []);
  const selectFinancial = useCallback((view: FinancialView) => {
    setPendingReport(`financial:${view}`);
  }, []);

  const allowedReportTypes = useMemo(
    () => new Set(permittedOperational.map((report) => report.key)),
    [permittedOperational],
  );
  const isAr = lang === 'ar';
  const reportList = (
    <div className="overflow-hidden rounded-xl border border-[#d9ddec] bg-white shadow-sm dark:border-ui-border dark:bg-ui-surface" data-testid="premier-reports-directory">
      <div className="border-b border-ui-border bg-gradient-to-l from-violet-50/80 to-ui-surface p-3 dark:from-violet-950/20 dark:to-ui-surface">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-sm font-black text-ui-text">{isAr ? 'المفضلة والتقارير' : 'Favorites & reports'}</span>
          <Star className="h-5 w-5 text-amber-500" aria-hidden="true" />
        </div>
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
          const selected = pendingReport === report.key;
          return (
            <div key={report.key} className={`group mb-1 flex items-center rounded-lg transition ${selected ? 'bg-ui-primary/10' : 'hover:bg-ui-page-alt'}`}>
              <button
                type="button"
                aria-pressed={selected}
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
          const selected = pendingReport === `financial:${report.key}`;
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
    <section className="space-y-3" dir={isAr ? 'rtl' : 'ltr'} data-testid="unified-reports-center">
      <header className="relative z-20 rounded-xl border border-ui-border bg-ui-surface p-3 shadow-ui-sm" data-testid="reports-compact-toolbar">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-black text-ui-text">
              <BarChart3 className="h-6 w-6 text-ui-primary" />{isAr ? 'التقارير' : 'Reports'}
            </h1>
            <p className="text-xs text-ui-muted">{isAr ? 'ملخص مجمع مباشر — افتح التقرير للحصول على كل تفاصيله' : 'Live summary — open a report to see its complete details'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="max-w-56 truncate rounded-lg bg-ui-page-alt px-3 py-2 text-xs text-ui-muted" data-testid="reports-applied-range">
              {draftFrom} — {draftTo}
            </span>
            <button type="button" data-testid="toggle-reports-filters" aria-expanded={filtersOpen}
              aria-controls="reports-filters-popup" onClick={() => setFiltersOpen((open) => !open)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ui-border px-3 text-xs font-bold text-ui-text">
              <SlidersHorizontal className="h-4 w-4" />{isAr ? 'الفلاتر' : 'Filters'}<ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button type="button" data-testid="toggle-reports-directory" aria-expanded={showDirectory}
              aria-controls="reports-type-directory" onClick={() => setShowDirectory((open) => !open)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ui-border px-3 text-xs font-bold text-ui-text">
              <LayoutGrid className="h-4 w-4" />{isAr ? 'أنواع التقارير' : 'Report types'}
            </button>
            <button type="button" onClick={applyOverviewDates} data-testid="apply-overview-dates"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ui-primary px-4 text-xs font-bold text-ui-primary-fg">
              {isAr ? 'عرض التقرير التفصيلي' : 'View detailed report'}
            </button>
          </div>
        </div>
        {filtersOpen && <div id="reports-filters-popup" data-testid="reports-filters-popup"
          className="absolute end-2 top-full z-40 mt-2 w-[min(92vw,540px)] rounded-xl border border-ui-border bg-ui-surface p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-black text-ui-text">{isAr ? 'خيارات التقرير والفترة والفرع' : 'Report options, dates and branch'}</h2>
            <button type="button" onClick={() => setFiltersOpen(false)} className="rounded-lg px-3 py-1.5 text-xs text-ui-muted hover:bg-ui-page-alt">{isAr ? 'إغلاق' : 'Close'}</button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-semibold text-ui-muted sm:col-span-2">
              {isAr ? 'نوع التقرير' : 'Report type'}
              <select data-testid="reports-single-type-select" value={pendingReport || initialOperational}
                onChange={(event) => setPendingReport(event.target.value)}
                className="h-10 w-full rounded-lg border border-ui-border bg-ui-page-alt px-2 text-xs font-bold text-ui-text">
                <optgroup label={isAr ? 'التقارير التشغيلية' : 'Operational'}>
                  {permittedOperational.map((item) => <option key={item.key} value={item.key}>{isAr ? item.title : item.titleEn}</option>)}
                </optgroup>
                {canFinancial && allowedFinancialViews.length > 0 && <optgroup label={isAr ? 'التقارير المالية' : 'Financial'}>
                  {allowedFinancialViews.map((item) => <option key={item.key} value={`financial:${item.key}`}>{isAr ? item.ar : item.en}</option>)}
                </optgroup>}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-ui-muted">
              {isAr ? 'من تاريخ' : 'From'}
              <input type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)}
                className="h-10 w-full rounded-lg border border-ui-border bg-ui-page-alt px-2 text-xs text-ui-text" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-ui-muted">
              {isAr ? 'إلى تاريخ' : 'To'}
              <input type="date" value={draftTo} onChange={(event) => setDraftTo(event.target.value)}
                className="h-10 w-full rounded-lg border border-ui-border bg-ui-page-alt px-2 text-xs text-ui-text" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-ui-muted sm:col-span-2">
              {isAr ? 'نطاق الفروع' : 'Branch scope'}
              <select value={branchScope.allBranchesSelected ? '__all' : branchScope.selectedBranchIds.length === 1 ? branchScope.selectedBranchIds[0] : '__selected'}
                onChange={(event) => {
                  if (event.target.value === '__all') branchScope.setAllBranches(true);
                  else if (event.target.value !== '__selected') branchScope.setSelectedBranchIds([event.target.value]);
                }}
                className="h-10 w-full rounded-lg border border-ui-border bg-ui-page-alt px-2 text-xs text-ui-text">
                <option value="__all">{isAr ? 'جميع الفروع المصرح بها' : 'All authorized branches'}</option>
                {!branchScope.allBranchesSelected && branchScope.selectedBranchIds.length > 1 && <option value="__selected">{isAr ? 'الفروع المحددة' : 'Selected branches'}</option>}
                {branchScope.organizationBranches.map((item) => <option key={item.id} value={item.id}>{isAr ? item.name : (item.name_en || item.name)}</option>)}
              </select>
            </label>
          </div>
          <button type="button" onClick={() => {
            const allowed = history.clampRange(draftFrom, draftTo);
            if (draftFrom > draftTo || allowed.from !== draftFrom || allowed.to !== draftTo) { setPeriodError(true); return; }
            setDateRange({ from: draftFrom, to: draftTo }); setOverviewRun((v) => v + 1); setPeriodError(false); setFiltersOpen(false);
          }} data-testid="apply-summary-filters"
            className="mt-3 w-full rounded-lg bg-ui-primary px-3 py-2.5 text-xs font-black text-ui-primary-fg">
            {isAr ? 'تحديث الملخص المجمع' : 'Refresh summary'}
          </button>
        </div>}
      </header>eader>
      {periodError && <p role="alert" className="rounded-lg border border-ui-danger/30 bg-ui-danger-soft px-4 py-2 text-xs text-ui-danger">
        {isAr ? 'الفترة غير صالحة أو خارج حدود تاريخ التقارير المسموح.' : 'Invalid period or outside authorized history.'}
      </p>}
      <div className="relative min-w-0">
        {showDirectory && <aside id="reports-type-directory" dir={isAr ? 'rtl' : 'ltr'}
          className="absolute start-0 top-0 z-30 w-[min(88vw,320px)] max-h-[75vh] overflow-y-auto rounded-xl bg-ui-surface shadow-2xl" data-testid="reports-collapsible-directory">
          {reportList}
        </aside>}
        <main dir={isAr ? 'rtl' : 'ltr'} className="min-w-0 space-y-3" data-testid="premier-reports-content">
          {(
            <ReportsShowcase
              isAr={isAr}
              allowedReportTypes={allowedReportTypes}
              verifiedIncome={verifiedIncome?.scopeKey === branchScope.scopeKey && verifiedIncome.from === dateRange.from && verifiedIncome.to === dateRange.to ? verifiedIncome : null}
              hasAuthorizedBranches={branchScope.selectedBranchIds.length > 0}
              from={dateRange.from}
              to={dateRange.to}
              key={overviewRun}
              onSelectReport={selectOperational}
            />
          )}
          {canFinancial && businessFinancialViewAllowed(runtime, 'income') && (
            <ReportsExecutiveKpis controlledFrom={dateRange.from} controlledTo={dateRange.to} onVerifiedTotal={setVerifiedIncome} />
          )}
        </main>
      </div>

    </section>
  );
}
