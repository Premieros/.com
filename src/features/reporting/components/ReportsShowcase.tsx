import { useEffect, useRef, useState } from 'react';
import { BarChart3, CalendarDays, ExternalLink, Layers3, RefreshCw, Store, Trophy, TrendingUp } from 'lucide-react';
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
const PAYMENT_LABELS: Record<string, { ar: string; en: string }> = {
  cash: { ar: 'نقدي', en: 'Cash' }, card: { ar: 'بطاقة', en: 'Card' },
  transfer: { ar: 'تحويل', en: 'Transfer' }, credit: { ar: 'آجل', en: 'Credit' },
  other: { ar: 'أخرى', en: 'Other' },
};
type Loaded = { snapshot: DashboardSalesSnapshot; scopeKey: string; from: string; to: string };

export function ReportsShowcase({
  isAr, allowedReportTypes, onSelectReport, from, to, hasAuthorizedBranches,
}: {
  isAr: boolean;
  allowedReportTypes: ReadonlySet<ReportType>;
  onSelectReport: (type: ReportType) => void;
  from: string;
  to: string;
  hasAuthorizedBranches: boolean;
}) {
  const branchScope = useBranchScope();
  const can = useCan();
  const { effectiveSettings } = useSettings();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const canReadSnapshot = can('dashboard.view');
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

  if (!panels.length) return null;

  const load = async () => {
    if (!canReadSnapshot || !hasAuthorizedBranches || loading) return;
    const version = ++generation.current;
    setLoading(true);
    setLoaded(null);
    setError(null);
    try {
      const { startIso, endExclusiveIso } = reportDateRangeUtc(from, to);
      const duration = Date.parse(endExclusiveIso) - Date.parse(startIso);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('INVALID_PERIOD');
      const previousTo = new Date(Date.parse(startIso)).toISOString();
      const previousFrom = new Date(Date.parse(startIso) - duration).toISOString();
      const snapshot = await loadDashboardSalesSnapshot({
        branchId: branchIds.length === 1 ? branchIds[0] : null,
        branchIds: [...branchIds],
        currentFrom: startIso,
        currentTo: endExclusiveIso,
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
        : 'The authoritative sales snapshot is unavailable. Open the detailed report or retry.');
    } finally {
      if (version === generation.current) setLoading(false);
    }
  };

  const payments = current ? Array.from(current.paymentMethods.reduce((map, item) => {
    const name = (PAYMENT_LABELS[item.method] || { ar: item.method, en: item.method })[isAr ? 'ar' : 'en'];
    map.set(name, (map.get(name) || 0) + item.total);
    return map;
  }, new Map<string, number>()), ([name, value]) => ({ name, value })).filter((item) => item.value > 0) : [];
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
    if (!commonCurrency) return (
      <p className="py-12 text-center text-xs text-ui-muted">
        {isAr ? 'أكمل التالي: وحّد عملة الفروع المحددة أو اختر فرعًا واحدًا لعرض قيم مالية قابلة للمقارنة.' : 'Select one branch or a common currency before comparing monetary figures.'}
      </p>
    );
    if (id === 'payment' && payments.length) return (
      <div className="h-48 w-full" dir="ltr" data-testid="reports-payment-donut">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={payments} dataKey="value" nameKey="name" innerRadius="46%" outerRadius="77%" paddingAngle={2}>
              {payments.map((item, index) => <Cell key={item.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(value: number) => money(Number(value))} />
          </PieChart>
        </ResponsiveContainer>
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

  return (
    <section data-testid="reports-visual-overview" className="space-y-3">
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
      {!canReadSnapshot && <p className="text-xs text-ui-muted">
        {isAr ? 'الرسوم المجمعة تتطلب صلاحية لوحة المبيعات؛ التقارير المفصلة أدناه متاحة حسب صلاحياتك.' : 'Dashboard access is required for the overview charts; detailed reports remain available according to your permissions.'}
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
                <button type="button" aria-label={isAr ? 'فتح تفاصيل التقرير' : 'Open report details'}
                  onClick={() => onSelectReport(panel.report)}
                  className="shrink-0 rounded-lg p-2 text-ui-primary hover:bg-ui-primary-soft">
                  <ExternalLink className="h-4 w-4" />
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
        {isAr ? 'المخططات من نفس خدمة لقطة المبيعات المعتمدة في لوحة Premier. طرق الدفع تعرض المدفوعات، وأفضل الأصناف تعرض الكميات؛ ولا تُعرض إجماليات مجمعة لعملات مختلفة.'
          : 'Charts reuse the Premier dashboard sales snapshot. Payments reflect tenders and top products reflect units; different currencies are never combined.'}
      </p>
    </section>
  );
}
