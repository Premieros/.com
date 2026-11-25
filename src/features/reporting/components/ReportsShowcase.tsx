import { useEffect, useRef, useState } from 'react';
import { BarChart3, CalendarDays, Check, Layers3, RefreshCw, Store, Trophy, TrendingUp } from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { loadDashboardSalesSnapshot, type DashboardSalesSnapshot } from '@/features/dashboard/services/dashboardSnapshot';
import { useSettings } from '@/context/SettingsContext';
import { useBranchScope } from '@/lib/branchScope';
import { useCan } from '@/lib/permissions';
import { formatFinancialCurrency } from '@/lib/format';
import { canonicalReportCurrency, sharedReportCurrency } from '../reportCurrency';
import { DashboardBreakdown } from '@/features/dashboard/components/DashboardBreakdown';
import { comparisonPeriod } from '../reportComparison';
import { addIsoDays, reportDateRangeUtc } from '@/lib/businessTime';
import type { ReportType } from '../reportFilters';
import type { IncomeKpiVerified } from './ReportsExecutiveKpis';

type Panel = {
  id: 'payment' | 'orders' | 'time' | 'branches' | 'products';
  report: ReportType;
  ar: string;
  en: string;
  icon: typeof BarChart3;
};
const PANELS: Panel[] = [
  { id: 'payment', report: 'sales_by_payment', ar: 'صافي المدفوعات حسب الطريقة', en: 'Net payments by method', icon: Layers3 },
  { id: 'orders', report: 'detailed_invoices', ar: 'الطلبات حسب النوع', en: 'Orders by type', icon: Layers3 },
  { id: 'time', report: 'sales', ar: 'المبيعات حسب الفترة', en: 'Sales over time', icon: TrendingUp },
  { id: 'branches', report: 'sales', ar: 'المبيعات حسب الفروع', en: 'Sales by branch', icon: Store },
  { id: 'products', report: 'sales_by_product', ar: 'الأصناف الأكثر مبيعًا (بالكمية)', en: 'Top products (units)', icon: Trophy },
];
type Loaded = { snapshot: DashboardSalesSnapshot; scopeKey: string; from: string; to: string };

export function ReportsShowcase({
  isAr, allowedReportTypes, onSelectReport, from, to, hasAuthorizedBranches, verifiedIncome,
}: {
  isAr: boolean;
  allowedReportTypes: ReadonlySet<ReportType>;
  onSelectReport: (type: ReportType) => void;
  from: string;
  to: string;
  hasAuthorizedBranches: boolean;
  verifiedIncome: IncomeKpiVerified | null;
}) {
  const branchScope = useBranchScope();
  const can = useCan();
  const { effectiveSettings } = useSettings();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedPanel, setFocusedPanel] = useState<Panel['id'] | null>(null);
  const [compare, setCompare] = useState(false);
  const generation = useRef(0);
  // Report readers may see report aggregates; the invoker-security RPC still enforces table RLS.
  const canReadSnapshot = can('dashboard.view') || can('reports.view');
  const panels = PANELS.filter((panel) => allowedReportTypes.has(panel.report));
  const activePanel = panels.find((panel) => panel.id === focusedPanel);
  const displayedPanels = activePanel ? [activePanel] : panels;
  const showComparison = compare && can('history.unlimited');
  const branchIds = branchScope.selectedBranchIds;
  const currencyCodes = branchIds.map((id) => effectiveSettings(id)?.currency);
  const commonCurrency = sharedReportCurrency(currencyCodes);
  const current = loaded?.scopeKey === branchScope.scopeKey && loaded.from === from && loaded.to === to
    ? loaded.snapshot : null;
  const money = (value: number) => commonCurrency
    ? formatFinancialCurrency(value, commonCurrency, isAr ? 'ar' : 'en')
    : value.toLocaleString(isAr ? 'ar-EG' : 'en-US');

  useEffect(() => {
    generation.current += 1;
    setLoaded(null);
    setError(null);
    setLoading(false);
    return () => { generation.current += 1; };
  }, [branchScope.scopeKey, from, to, canReadSnapshot]);

  const load = async () => {
    // A scope change must start a fresh request even while an older request is loading.
    if (!canReadSnapshot || !hasAuthorizedBranches) return;
    const version = ++generation.current;
    setLoading(true);
    setLoaded(null);
    setError(null);
    try {
      const { startIso, endExclusiveIso } = reportDateRangeUtc(from, to);
      const prior = comparisonPeriod({ from, to }, 'previous');
      const previous = reportDateRangeUtc(prior.from, prior.to);
      const currentToInclusive = new Date(Date.parse(endExclusiveIso) - 1).toISOString();
      const previousTo = new Date(Date.parse(previous.endExclusiveIso) - 1).toISOString();
      const snapshot = await loadDashboardSalesSnapshot({
        branchId: branchIds.length === 1 ? branchIds[0] : null,
        branchIds: [...branchIds],
        currentFrom: startIso,
        currentTo: currentToInclusive,
        previousFrom: previous.startIso,
        previousTo,
        granularity: 'day',
        timezone: 'Africa/Cairo',
      });
      if (version === generation.current) {
        if (!snapshot) throw new Error('SNAPSHOT_UNAVAILABLE');
        setLoaded({ snapshot, scopeKey: branchScope.scopeKey, from, to });
      }
    } catch {
      if (version === generation.current) setError(isAr
        ? 'لم نتمكن من عرض مبيعات الفترة المختارة. اضغط «تحديث الرسوم»؛ وإذا تكرر الأمر جرّب فترة أقصر أو فرعًا واحدًا ثم أبلغ مسؤول النظام.'
        : 'We could not display sales for this period. Refresh the charts; if this continues, try a shorter period or one branch and contact your administrator.');
    } finally {
      if (version === generation.current) setLoading(false);
    }
  };

  // Query the existing snapshot as soon as authorized scope/period changes.
  // A failed request remains visible, never silently replaced with zeros.
  useEffect(() => {
    if (canReadSnapshot && hasAuthorizedBranches && panels.length > 0) void load();
    // One request per authorized scope/range; manual refresh is also available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchScope.scopeKey, from, to, canReadSnapshot, hasAuthorizedBranches]);

  if (!panels.length) return null;

  const channelNames: Record<string, { ar: string; en: string }> = {
    dine_in: { ar: 'داخل المطعم', en: 'Dine in' },
    delivery: { ar: 'طلبات خارجية (توصيل)', en: 'Delivery' },
    takeaway: { ar: 'طلبات استلام', en: 'Takeaway' },
    drive_thru: { ar: 'طلبات السيارات', en: 'Drive through' },
    online: { ar: 'الطلبات الإلكترونية', en: 'Online' },
  };
  const orderTypes = (current?.orderTypes || []).map(({ key, count }) => ({
    key,
    label: (channelNames[key] || { ar: key, en: key })[isAr ? 'ar' : 'en'],
    value: count,
  }));
  const paymentTotals = new Map<string, number>();
  for (const { method, total } of current?.paymentMethods ?? []) {
    paymentTotals.set(method, (paymentTotals.get(method) ?? 0) + total);
  }
  const paymentLabels: Record<string, readonly [string, string]> = {
    cash: ['نقدي', 'Cash'], card: ['بطاقة', 'Card'], visa: ['فيزا / ماستركارد', 'Visa / Mastercard'],
    bank: ['تحويل بنكي', 'Bank transfer'], transfer: ['تحويل', 'Transfer'], instapay: ['إنستاباي', 'InstaPay'],
    wallet: ['محفظة إلكترونية', 'Wallet'], split: ['مختلط غير موزع', 'Unallocated split'],
    credit: ['آجل', 'Credit'], other: ['أخرى', 'Other'],
  };
  const payments = [...paymentTotals].sort((a, b) => b[1] - a[1]).map(([key, value]) => ({
    key, value, label: paymentLabels[key]?.[isAr ? 0 : 1] ?? key,
  }));
  const series = new Map<string, { name: string; value: number; previous: number }>();
  for (const item of current?.currentSeries ?? []) {
    const name = item.bucket.slice(0, 10);
    series.set(name, { name, value: item.sales, previous: 0 });
  }
  if (showComparison && current) {
    const prior = comparisonPeriod({ from, to }, 'previous');
    const days = Math.round((Date.parse(from) - Date.parse(prior.from)) / 86400000);
    for (const item of current.previousSeries) {
      const name = addIsoDays(item.bucket.slice(0, 10), days);
      const row = series.get(name) ?? { name, value: 0, previous: 0 };
      series.set(name, { ...row, previous: item.sales });
    }
  }
  const branches = (current?.branches || []).map((item) => {
    const branch = branchScope.organizationBranches.find((entry) => entry.id === item.branchId);
    return {
      name: (isAr ? branch?.name : (branch?.name_en || branch?.name)) || item.branchId.slice(0, 8),
      value: item.sales,
    };
  });
  const topProducts = current?.topProducts || [];

  const chart = (id: Panel['id']) => {
    if (error) return <p role="alert" className="flex min-h-44 items-center justify-center px-4 text-center text-xs text-ui-danger">{error}</p>;
    if (!current) return (
      <p className="flex min-h-44 items-center justify-center px-4 text-center text-xs text-ui-muted">
        {loading ? (isAr ? 'جارٍ تحميل البيانات الحقيقية...' : 'Loading source data...')
          : (!hasAuthorizedBranches ? (isAr ? 'اختر فرعًا من الفلاتر لعرض بياناته.' : 'Choose a branch in Filters to display its data.') : (isAr ? 'اضغط «تحديث الرسوم» لإعادة عرض البيانات.' : 'Select Refresh charts to load the data.'))}
      </p>
    );
    if (id === 'products') {
      return topProducts.length ? (
        <div className="space-y-2 p-2" data-testid="reports-top-products-data">
          {topProducts.slice(0, 5).map((product, index) => (
            <div key={`${product.name}-${index}`} className="flex items-center gap-3 text-xs">
              <span className="w-5 text-ui-muted">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate font-semibold text-ui-text">{product.name}</span>
              <span className="font-bold tabular-nums text-ui-primary">{product.quantity.toLocaleString(isAr ? 'ar-EG' : 'en-US')}</span>
            </div>
          ))}
        </div>
      ) : <p className="py-12 text-center text-xs text-ui-muted">{isAr ? 'لم تُسجّل مبيعات أصناف في هذه الفترة. جرّب توسيع الفترة أو اختيار فرع آخر.' : 'No product sales were recorded in this period. Try a longer period or another branch.'}</p>;
    }
    if (id === 'orders') {
      return orderTypes.length ? <div className="p-2"><DashboardBreakdown rows={orderTypes}
        formatValue={(value) => value.toLocaleString(isAr ? 'ar-EG' : 'en-US')} /></div>
        : <p className="py-12 text-center text-xs text-ui-muted">{isAr ? 'لا توجد طلبات في هذه الفترة' : 'No orders in this period'}</p>;
    }
    if (!commonCurrency) return (
      <p className="py-12 text-center text-xs text-ui-muted">
        {isAr ? 'الفروع المختارة لا تستخدم عملة واحدة معروفة.' : 'The selected branches do not have one known currency.'}
      </p>
    );
    if (id === 'payment') {
      return payments.length ? <div className="p-2"><DashboardBreakdown rows={payments} formatValue={money} /></div>
        : <p className="py-12 text-center text-xs text-ui-muted">{isAr ? 'لا توجد مدفوعات في هذه الفترة' : 'No payments in this period'}</p>;
    }
    const data = id === 'time' ? [...series.values()].sort((a, b) => a.name.localeCompare(b.name)) : branches;
    return data.length ? (
      <div className="h-48 w-full" dir="ltr" data-testid={id === 'time' ? 'reports-daily-sales-chart' : 'reports-branch-sales-chart'}>
        <ResponsiveContainer width="100%" height="100%">
          {id === 'time' ? (
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 12 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} width={45} />
              <Tooltip formatter={(value: number) => money(Number(value))} />
              {showComparison && <Legend />}
              <Area type="monotone" dataKey="value" name={isAr ? 'الفترة الحالية' : 'Current period'}
                stroke="#7c3aed" fill="#a78bfa" fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} />
              {showComparison && <Area type="monotone" dataKey="previous" name={isAr ? 'الفترة السابقة' : 'Previous period'}
                stroke="rgb(var(--ui-muted))" strokeDasharray="5 4" fill="none" isAnimationActive={false} />}
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 12 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} width={45} />
              <Tooltip formatter={(value: number) => money(Number(value))} />
              <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    ) : <p className="py-12 text-center text-xs text-ui-muted">{isAr ? 'لا توجد عمليات لهذا الرسم ضمن الفترة المختارة. جرّب فترة أخرى أو فرعًا مختلفًا.' : 'No activity for this chart in the selected period. Try another date range or branch.'}</p>;
  };

  const comparableIncome = verifiedIncome && commonCurrency && canonicalReportCurrency(verifiedIncome.currency) === commonCurrency
    ? verifiedIncome.values : null;
  const margin = comparableIncome && comparableIncome.net_revenue > 0
    ? comparableIncome.net_income / comparableIncome.net_revenue * 100 : null;
  const accountingNotice = isAr
    ? 'لم يكتمل حساب بعض مؤشرات الربح والتكلفة. راجع قائمة «مؤشرات قائمة الدخل» أدناه لمعرفة الفرع أو البيان الناقص المطلوب استكماله.'
    : 'Some profit and cost figures are not complete. Check Income statement KPIs below to see the affected branch and missing information.';
  const summaryCards = [
    { id: 'average', ar: 'متوسط قيمة الطلب', en: 'Average order', value: current && commonCurrency ? money(current.current.orders > 0 ? current.current.sales / current.current.orders : 0) : null, tone: 'from-rose-50 to-pink-100/60 dark:from-rose-950/30 dark:to-ui-surface' },
    { id: 'orders', ar: 'عدد الطلبات', en: 'Orders', value: current ? current.current.orders.toLocaleString(isAr ? 'ar-EG' : 'en-US') : null, tone: 'from-blue-50 to-blue-100/70 dark:from-blue-950/30 dark:to-ui-surface' },
    { id: 'sales', ar: 'صافي المبيعات', en: 'Net sales', value: current && commonCurrency ? money(current.current.sales) : null, tone: 'from-emerald-50 to-green-100/70 dark:from-emerald-950/30 dark:to-ui-surface' },
    { id: 'cogs', ar: 'تكلفة المواد (COGS)', en: 'Cost of goods sold', value: comparableIncome ? money(comparableIncome.cogs) : null, tone: 'from-sky-50 to-blue-100/60 dark:from-sky-950/30 dark:to-ui-surface' },
    { id: 'margin', ar: 'معدل الربح الصافي', en: 'Net profit margin', value: margin === null ? null : `${margin.toFixed(1)}%`, tone: 'from-amber-50 to-orange-100/70 dark:from-amber-950/30 dark:to-ui-surface' },
    { id: 'net', ar: 'الربح الصافي', en: 'Net profit', value: comparableIncome ? money(comparableIncome.net_income) : null, tone: 'from-violet-50 to-purple-100/70 dark:from-violet-950/30 dark:to-ui-surface' },
  ];

  return (
    <section data-testid="reports-visual-overview" className="space-y-3">
      <div className="rounded-xl border border-[#d9ddec] bg-white p-3 shadow-sm dark:border-ui-border dark:bg-ui-surface" data-testid="reports-performance-summary">
        <h2 className="mb-3 flex items-center gap-2 text-base font-black text-ui-text"><BarChart3 className="h-5 w-5 text-violet-600" />{isAr ? 'ملخص الأداء' : 'Performance summary'}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-6">
          {summaryCards.map((card) => {
            const target = card.id === 'orders' ? 'orders' : card.id === 'sales' ? 'time' : null;
            const available = target && panels.some((panel) => panel.id === target);
            const content = <>
              <span className="block text-xs font-bold text-ui-text">{isAr ? card.ar : card.en}</span>
              <span className="mt-2 block break-words text-lg font-black tabular-nums text-ui-text">
                {card.value ?? (loading ? (isAr ? 'جارٍ التحميل' : 'Loading') : (isAr ? 'غير متاح' : 'Unavailable'))}
              </span>
            </>;
            const classes = `min-w-0 rounded-xl bg-gradient-to-br p-3 ${card.tone}`;
            return available ? (
              <button type="button" key={card.id} className={`${classes} text-start hover:ring-1 hover:ring-ui-primary focus-visible:ring-2 focus-visible:ring-ui-ring aria-pressed:ring-2 aria-pressed:ring-ui-primary`}
                data-testid={`overview-kpi-${card.id}`} aria-pressed={activePanel?.id === target}
                onClick={() => setFocusedPanel(activePanel?.id === target ? null : target)}>
                {content}
              </button>
            ) : <div key={card.id} className={classes} data-testid={`overview-kpi-${card.id}`}>{content}</div>;
          })}
        </div>
        {!comparableIncome && <p className="mt-2 text-xs text-ui-muted">{accountingNotice}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-base font-black text-ui-text sm:text-lg">
          <BarChart3 className="h-5 w-5 text-ui-primary" />
          {isAr ? 'التحليلات والتقارير' : 'Analytics and reports'}
        </h2>
        <button type="button" data-testid="load-overview-charts" onClick={() => void load()}
          disabled={!canReadSnapshot || !hasAuthorizedBranches || loading}
          className="inline-flex items-center gap-2 rounded-lg bg-ui-primary px-3 py-2 text-xs font-bold text-ui-primary-fg disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? (isAr ? 'جارٍ التحميل...' : 'Loading...') : (isAr ? 'عرض / تحديث الرسوم' : 'Load / refresh charts')}
        </button>
      </div>
      {current && !commonCurrency && <p role="status" className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-ui-surface dark:text-ui-text">
        {isAr ? 'تعذّر جمع المبالغ: بعض الفروع المختارة لا تستخدم العملة نفسها أو لم تُحدّد عملتها. اختر فرعًا واحدًا أو صحّح عملات الفروع في الإعدادات؛ أعداد الطلبات والكميات متاحة.' : 'Amounts cannot be combined: selected branches use different or missing currencies. Select one branch or correct branch currency settings; counts and quantities remain available.'}
      </p>}
      {!canReadSnapshot && <p className="text-xs text-ui-muted">
        {isAr ? 'لا تملك صلاحية عرض ملخص المبيعات. اطلب من مدير النظام منحك صلاحية التقارير أو لوحة المبيعات للفروع المطلوبة.' : 'You do not have permission to view the sales overview. Ask your administrator for reporting or sales dashboard access to the needed branches.'}
      </p>}
      {error && <p role="alert" className="rounded-lg border border-ui-danger/30 bg-ui-danger-soft p-3 text-xs text-ui-danger">{error}</p>}
      <div role="group" aria-label={isAr ? 'اختيار التحليل' : 'Choose analysis'} className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={!activePanel} onClick={() => setFocusedPanel(null)}
          className="rounded-lg border border-ui-border px-3 py-2 text-xs font-bold aria-pressed:bg-ui-primary-soft">
          {isAr ? 'كل التحليلات' : 'All analyses'}
        </button>
        {panels.map((panel) => (
          <button type="button" key={panel.id} aria-pressed={activePanel?.id === panel.id} onClick={() => setFocusedPanel(panel.id)}
            className="rounded-lg border border-ui-border px-3 py-2 text-xs font-bold aria-pressed:bg-ui-primary-soft">
            {isAr ? panel.ar : panel.en}
          </button>
        ))}
      </div>
      <div className={`grid gap-3 ${activePanel ? '' : 'md:grid-cols-2'}`}>
        {displayedPanels.map((panel) => {
          const Icon = panel.icon;
          return (
            <div key={panel.id} data-testid={`report-shortcut-${panel.id}`}
              className="min-w-0 rounded-2xl border border-ui-border bg-ui-surface p-4 shadow-ui-sm">
              <div className="flex items-center justify-between gap-2">
                <h3 className="inline-flex min-w-0 items-center gap-2 text-sm font-black text-ui-text">
                  <Icon className="h-5 w-5 shrink-0 text-ui-primary" />
                  {isAr ? panel.ar : panel.en}
                </h3>
                {panel.id === 'time' && can('history.unlimited') && (
                  <button type="button" aria-pressed={showComparison} onClick={() => setCompare((value) => !value)}
                    className="ms-auto rounded-lg border border-ui-border px-3 py-2 text-xs font-bold aria-pressed:bg-ui-primary-soft">
                    {isAr ? 'مقارنة بالفترة السابقة' : 'Compare previous period'}
                  </button>
                )}
                <button type="button" aria-label={isAr ? 'تحديد نوع التقرير من هذه اللوحة' : 'Select this report type'}
                  onClick={() => onSelectReport(panel.report)}
                  className="shrink-0 rounded-lg p-2 text-ui-primary hover:bg-ui-primary-soft">
                  <Check className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 min-h-44 rounded-xl bg-ui-page-alt/40 py-2">
                {chart(panel.id)}
              </div>
              {current && <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-ui-muted">
                <CalendarDays className="h-3.5 w-3.5" />{from} – {to}
              </p>}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ui-muted">
        {isAr ? 'المخططات من نفس خدمة لقطة المبيعات المعتمدة في لوحة Premier. أنواع الطلبات تعرض العدد، وطرق الدفع تعرض صافي المبالغ، وأفضل الأصناف تعرض الكميات؛ ولا تُعرض إجماليات مجمعة لعملات مختلفة.'
          : 'Charts reuse the Premier dashboard sales snapshot. Order types reflect counts, payments show net amounts, and top products reflect units; different currencies are never combined.'}
      </p>
    </section>
  );
}
