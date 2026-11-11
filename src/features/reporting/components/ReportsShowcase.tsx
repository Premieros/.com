import { useEffect, useRef, useState } from 'react';
import { BarChart3, CalendarDays, Check, Layers3, RefreshCw, Store, Trophy, TrendingUp } from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { loadDashboardSalesSnapshot, type DashboardSalesSnapshot } from '@/features/dashboard/services/dashboardSnapshot';
import { useSettings } from '@/context/SettingsContext';
import { useBranchScope } from '@/lib/branchScope';
import { useCan } from '@/lib/permissions';
import { formatFinancialCurrency } from '@/lib/format';
import { reportDateRangeUtc } from '@/lib/businessTime';
import type { ReportType } from '../reportFilters';
import type { IncomeKpiVerified } from './ReportsExecutiveKpis';

type Panel = {
  id: 'payment' | 'time' | 'branches' | 'products';
  report: ReportType;
  ar: string;
  en: string;
  icon: typeof BarChart3;
};
const PANELS: Panel[] = [
  { id: 'payment', report: 'sales_by_payment', ar: 'توزيع المبيعات حسب طرق الدفع', en: 'Sales by payment method', icon: Layers3 },
  { id: 'time', report: 'sales', ar: 'المبيعات حسب الفترة', en: 'Sales over time', icon: TrendingUp },
  { id: 'branches', report: 'sales', ar: 'المبيعات حسب الفروع', en: 'Sales by branch', icon: Store },
  { id: 'products', report: 'sales_by_product', ar: 'الأصناف الأكثر مبيعًا (بالكمية)', en: 'Top products (units)', icon: Trophy },
];
const PIE_COLORS = ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#6366f1'];
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
  const generation = useRef(0);
  // Report readers may see report aggregates; the invoker-security RPC still enforces table RLS.
  const canReadSnapshot = can('dashboard.view') || can('reports.view');
  const panels = PANELS.filter((panel) => allowedReportTypes.has(panel.report));
  const branchIds = branchScope.selectedBranchIds;
  const currencyCodes = branchIds.map((id) => effectiveSettings(id)?.currency || '');
  const commonCurrency = currencyCodes.length === branchIds.length && currencyCodes.every((code) => code && code === currencyCodes[0])
    ? currencyCodes[0] : null;
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
      const duration = Date.parse(endExclusiveIso) - Date.parse(startIso);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('INVALID_PERIOD');
      // The existing RPC uses <= end; supply the final millisecond of the selected day.
      const currentToInclusive = new Date(Date.parse(endExclusiveIso) - 1).toISOString();
      const previousTo = new Date(Date.parse(startIso) - 1).toISOString();
      const previousFrom = new Date(Date.parse(startIso) - duration).toISOString();
      const snapshot = await loadDashboardSalesSnapshot({
        branchId: branchIds.length === 1 ? branchIds[0] : null,
        branchIds: [...branchIds],
        currentFrom: startIso,
        currentTo: currentToInclusive,
        previousFrom,
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
        ? 'تعذر تحميل لوحة الرسوم من مصدر المبيعات المعتمد. افتح التقرير التفصيلي أو أعد المحاولة.'
        : 'The authorized sales source is unavailable. Open the detailed report or retry.');
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
  const payments = (current?.orderTypes || []).map((item) => ({
    name: (channelNames[item.key] || { ar: item.key, en: item.key })[isAr ? 'ar' : 'en'],
    value: item.count,
  })).filter((item) => item.value > 0);
  const channelCount = payments.reduce((total, item) => total + item.value, 0);
  const series = (current?.currentSeries || []).map((item) => ({ name: item.bucket.slice(0, 10), value: item.sales }));
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
          : (isAr ? 'اختر «عرض الرسوم» لتحميل بيانات الفترة' : 'Choose “Load charts” for live period data')}
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
      ) : <p className="py-12 text-center text-xs text-ui-muted">{isAr ? 'لا توجد أصناف مباعة خلال الفترة' : 'No product sales in this period'}</p>;
    }
    if (id !== 'payment' && !commonCurrency) return (
      <p className="py-12 text-center text-xs text-ui-muted">
        {isAr ? 'أكمل التالي: وحّد عملة الفروع المحددة أو اختر فرعًا واحدًا لعرض قيم مالية قابلة للمقارنة.' : 'Select one branch or a common currency before comparing monetary figures.'}
      </p>
    );
    if (id === 'payment' && payments.length) return (
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2" data-testid="reports-payment-donut">
        <div className="h-48 min-w-0" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={payments} dataKey="value" nameKey="name" innerRadius="46%" outerRadius="77%" paddingAngle={2}>
                {payments.map((item, index) => <Cell key={item.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(value: number) => Number(value).toLocaleString(isAr ? 'ar-EG' : 'en-US')} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="min-w-0 space-y-2">
          {payments.map((item, index) => <div key={item.name} className="flex items-center justify-between gap-1 text-[11px]">
            <span className="flex min-w-0 items-center gap-1 text-ui-text"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} /><span className="truncate">{item.name}</span></span>
            <strong className="shrink-0 tabular-nums text-ui-text">{channelCount ? (item.value / channelCount * 100).toFixed(1) : '0'}%</strong>
          </div>)}
        </div>
      </div>
    );
    const data = id === 'time' ? series : id === 'branches' ? branches : [];
    return data.length ? (
      <div className="h-48 w-full" dir="ltr" data-testid={id === 'time' ? 'reports-daily-sales-chart' : 'reports-branch-sales-chart'}>
        <ResponsiveContainer width="100%" height="100%">
          {id === 'time' ? (
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 12 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} width={45} />
              <Tooltip formatter={(value: number) => money(Number(value))} />
              <Area type="monotone" dataKey="value" stroke="#7c3aed" fill="#a78bfa" fillOpacity={0.18} strokeWidth={2} />
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 12 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} width={45} />
              <Tooltip formatter={(value: number) => money(Number(value))} />
              <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    ) : <p className="py-12 text-center text-xs text-ui-muted">{isAr ? 'لا توجد بيانات ضمن الفترة المختارة' : 'No data in the selected period'}</p>;
  };

  const comparableIncome = verifiedIncome && commonCurrency && verifiedIncome.currency === commonCurrency
    ? verifiedIncome.values : null;
  const margin = comparableIncome && comparableIncome.net_revenue > 0
    ? comparableIncome.net_income / comparableIncome.net_revenue * 100 : null;
  const accountingNotice = isAr
    ? 'القيم المحاسبية تُعرض فقط عند اكتمال قائمة الدخل لجميع الفروع المختارة وتوافق عملاتها.'
    : 'Accounting values display only after all selected branch income statements are complete and currencies match.';
  const summaryCards = [
    { id: 'average', ar: 'متوسط قيمة الطلب', en: 'Average order', value: current && commonCurrency ? money(current.current.orders > 0 ? current.current.sales / current.current.orders : 0) : null, tone: 'from-rose-50 to-pink-100/60 dark:from-rose-950/30 dark:to-ui-surface' },
    { id: 'orders', ar: 'عدد الطلبات', en: 'Orders', value: current ? current.current.orders.toLocaleString(isAr ? 'ar-EG' : 'en-US') : null, tone: 'from-blue-50 to-blue-100/70 dark:from-blue-950/30 dark:to-ui-surface' },
    { id: 'sales', ar: 'إجمالي المبيعات', en: 'Total sales', value: current && commonCurrency ? money(current.current.sales) : null, tone: 'from-emerald-50 to-green-100/70 dark:from-emerald-950/30 dark:to-ui-surface' },
    { id: 'cogs', ar: 'تكلفة المواد (COGS)', en: 'Cost of goods sold', value: comparableIncome ? money(comparableIncome.cogs) : null, tone: 'from-sky-50 to-blue-100/60 dark:from-sky-950/30 dark:to-ui-surface' },
    { id: 'margin', ar: 'معدل الربح الصافي', en: 'Net profit margin', value: margin === null ? null : `${margin.toFixed(1)}%`, tone: 'from-amber-50 to-orange-100/70 dark:from-amber-950/30 dark:to-ui-surface' },
    { id: 'net', ar: 'الربح الصافي', en: 'Net profit', value: comparableIncome ? money(comparableIncome.net_income) : null, tone: 'from-violet-50 to-purple-100/70 dark:from-violet-950/30 dark:to-ui-surface' },
  ];

  return (
    <section data-testid="reports-visual-overview" className="space-y-3">
      <div className="rounded-xl border border-[#d9ddec] bg-white p-3 shadow-sm dark:border-ui-border dark:bg-ui-surface" data-testid="reports-performance-summary">
        <h2 className="mb-3 flex items-center gap-2 text-base font-black text-ui-text"><BarChart3 className="h-5 w-5 text-violet-600" />{isAr ? 'ملخص الأداء' : 'Performance summary'}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-6">
          {summaryCards.map((card) => (
            <div key={card.id} className={`min-w-0 rounded-xl bg-gradient-to-br p-3 ${card.tone}`} data-testid={`overview-kpi-${card.id}`}>
              <p className="text-xs font-bold text-ui-text">{isAr ? card.ar : card.en}</p>
              <p className="mt-2 break-words text-lg font-black tabular-nums text-ui-text">{card.value ?? (loading ? (isAr ? 'جارٍ التحميل' : 'Loading') : (isAr ? 'غير متاح' : 'Unavailable'))}</p>
            </div>
          ))}
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
        {isAr ? 'المبالغ الإجمالية غير معروضة لأن عملات الفروع غير موحّدة أو غير محددة؛ أعداد الطلبات والكميات ما زالت ظاهرة.' : 'Money totals are unavailable because branch currencies differ or are missing. Order counts and product quantities remain visible.'}
      </p>}
      {!canReadSnapshot && <p className="text-xs text-ui-muted">
        {isAr ? 'الرسوم المجمعة تتطلب صلاحية لوحة المبيعات أو التقارير، مع الالتزام بصلاحيات الفروع؛ التقارير المفصلة متاحة حسب صلاحياتها.' : 'Sales dashboard or reporting access is required to view aggregates; detailed reports remain subject to their own permissions.'}
      </p>}
      {error && <p role="alert" className="rounded-lg border border-ui-danger/30 bg-ui-danger-soft p-3 text-xs text-ui-danger">{error}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {panels.map((panel) => {
          const Icon = panel.icon;
          return (
            <div key={panel.id} data-testid={`report-shortcut-${panel.id}`}
              className="min-w-0 rounded-2xl border border-ui-border bg-ui-surface p-4 shadow-ui-sm">
              <div className="flex items-center justify-between gap-2">
                <h3 className="inline-flex min-w-0 items-center gap-2 text-sm font-black text-ui-text">
                  <Icon className="h-5 w-5 shrink-0 text-ui-primary" />
                  {isAr ? panel.ar : panel.en}
                </h3>
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
        {isAr ? 'المخططات من نفس خدمة لقطة المبيعات المعتمدة في لوحة Premier. القنوات تعرض أعداد الطلبات، وأفضل الأصناف تعرض الكميات؛ ولا تُعرض إجماليات مجمعة لعملات مختلفة.'
          : 'Charts reuse the Premier dashboard sales snapshot. Channels reflect order counts and top products reflect units; different currencies are never combined.'}
      </p>
    </section>
  );
}
