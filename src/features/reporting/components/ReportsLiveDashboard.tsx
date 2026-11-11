import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarDays, RotateCw, TrendingUp, ShoppingBag, Receipt, Undo2 } from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';
import { reporting } from '@/api';
import { useBranchScope } from '@/lib/branchScope';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { useLanguage } from '@/context/LanguageContext';
import { reportDateRangeUtc, businessDateISO, addIsoDays } from '@/lib/businessTime';
import { loadSalesReportRows } from '../services/reportCoreLoaders';
import { loadSalesByProductItems } from '../services/reportInventoryLoaders';
import { netSaleAmount, netSaleItemQuantity, netSaleItemRevenue, allocateSaleNetRevenue } from '../numericIntegrity';
import { requireFinancialReport } from '../services/requireFinancialReport';
import { useSettings } from '@/context/SettingsContext';
import { useCan } from '@/lib/permissions';
import type { ReportType } from '../reportFilters';

type Point = { name: string; value: number };
type ProductPoint = { name: string; quantity: number; sales: number };
type Overview = {
  amount: number;
  invoiceCount: number;
  refundAmount: number;
  trend: Point[];
  branches: Point[];
  payments: Point[] | null;
  products: ProductPoint[] | null;
  warnings: string[];
  currency: string | null;
};
const COLORS = ['#793df0', '#3884f6', '#28c9a0', '#ffa431', '#ed7198', '#a2a4b4'];

function money(n: number, currency: string | null, lang: string) {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US', {
    style: currency ? 'currency' : 'decimal',
    ...(currency ? { currency } : { maximumFractionDigits: 2 }),
  }).format(n);
}
function validDate(value: string) {
  return /^\\d{4}-\\d{2}-\\d{2}$/.test(value)
    && !Number.isNaN(new Date(value + 'T12:00:00Z').getTime())
    && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
}
export function ReportsLiveDashboard({
  allowedReportTypes,
  onSelectReport,
}: {
  allowedReportTypes: ReadonlySet<ReportType>;
  onSelectReport: (type: ReportType) => void;
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const can = useCan();
  const history = useHistoryAccess();
  const scope = useBranchScope();
  const { effectiveSettings } = useSettings();
  const [from, setFrom] = useState(() => addIsoDays(businessDateISO(), -23));
  const [to, setTo] = useState(() => businessDateISO());
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const branchIds = scope.selectedBranchIds;
  const branchNames = useMemo(() => new Map(scope.organizationBranches.map(b => [b.id, ar ? b.name : b.name_en || b.name])), [scope.organizationBranches, ar]);
  const scopeKey = scope.scopeKey;
  const hasSales = can('reports.view') && allowedReportTypes.has('sales');

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    if (!hasSales || scope.loading || branchIds.length === 0) {
      return () => { cancelled = true; };
    }
    if (!validDate(from) || !validDate(to) || from > to) {
      setError(ar ? 'أكمل التالي: اختر فترة صحيحة.' : 'Complete the following: select a valid date range.');
      return () => { cancelled = true; };
    }
    const allowed = history.clampRange(from, to);
    if (allowed.from !== from || allowed.to !== to) {
      setError(ar ? 'أكمل التالي: الفترة خارج نطاق التاريخ المصرح لك.' : 'Complete the following: date range is outside your authorized history.');
      return () => { cancelled = true; };
    }
    const ids = [...branchIds];
    const { startIso, endExclusiveIso } = reportDateRangeUtc(from, to);
    setLoading(true);
    (async () => {
      try {
        // Identical source and numeric net-sales helper as the existing Sales Report.
        // Do not infer a complete total if the canonical loader fails.
        const sales = await loadSalesReportRows({
          branchId: null, branchIds: ids, fromTs: startIso, toExclusiveTs: endExclusiveIso, filters: {},
        });
        if (cancelled) return;
        const inScope = sales.filter(s => ids.includes(String(s.branch_id || '')));
        const amounts = new Map<string, number>();
        const byBranch = new Map<string, number>();
        let refunds = 0;
        let total = 0;
        for (const sale of inScope) {
          const net = netSaleAmount(sale);
          total += net;
          const date = String(sale.created_at || '').slice(0, 10);
          amounts.set(date, (amounts.get(date) || 0) + net);
          const id = String(sale.branch_id);
          byBranch.set(id, (byBranch.get(id) || 0) + net);
          const refund = Number(sale.refunded_amount);
          if (Number.isFinite(refund) && refund > 0) refunds += refund;
        }
        const warnings: string[] = [];
        const currencies = ids.map(id => effectiveSettings(id)?.currency || null);
        const currency = currencies.every(c => Boolean(c) && c === currencies[0]) ? currencies[0] : null;
        if (!currency) warnings.push(ar
          ? 'أكمل التالي: راجع عملات الفروع. لا يمكن اعتماد إجمالي مالي موحّد لعملات مختلفة أو ناقصة.'
          : 'Complete the following: check branch currencies. A unified total cannot combine mixed or unknown currencies.');

        let payments: Point[] | null = null;
        if (allowedReportTypes.has('sales_by_payment')) {
          try {
            const responses = await Promise.all(ids.map(id => reporting.getSalesByPaymentReport({
              p_branch_id: id, p_from: startIso, p_to: endExclusiveIso,
              p_payment_method: null, p_order_type: null, p_warehouse_id: null, p_cashier_id: null, p_status: null,
            })));
            const paymentMap = new Map<string, number>();
            responses.forEach((response, index) => {
              const raw = requireFinancialReport(response, 'sales_by_payment', ids[index]);
              if (!Array.isArray(raw.rows) || !raw.summary) throw Error('INCOMPLETE_PAYMENTS');
              for (const item of raw.rows as Record<string, unknown>[]) {
                const value = Number(item.sales_total);
                if (!Number.isFinite(value)) throw Error('INCOMPLETE_PAYMENTS');
                const key = String(item.method || 'other');
                paymentMap.set(key, (paymentMap.get(key) || 0) + value);
              }
            });
            payments = [...paymentMap].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
          } catch {
            warnings.push(ar ? 'أكمل التالي: راجع مصدر توزيع طرق الدفع ثم أعد التحميل.' : 'Complete the following: check payment distribution source then refresh.');
          }
        }

        let products: ProductPoint[] | null = null;
        if (allowedReportTypes.has('sales_by_product')) {
          try {
            const items = await loadSalesByProductItems({ branchId: null, branchIds: ids, filters: {} });
            const matching = items.filter(item => {
              const sale = item.sale as { created_at?: string; branch_id?: string } | null;
              return sale && ids.includes(String(sale.branch_id)) && String(sale.created_at || '') >= startIso && String(sale.created_at || '') < endExclusiveIso;
            });
            const bySale = new Map<string, number>();
            matching.forEach(item => {
              const sid = String(item.sale_id || '');
              bySale.set(sid, (bySale.get(sid) || 0) + netSaleItemRevenue(item));
            });
            const byProduct = new Map<string, ProductPoint>();
            matching.forEach(item => {
              const sale = item.sale as { total?: number; refunded_amount?: number } | null;
              const product = item.product as { name?: string } | null;
              const name = product?.name || (ar ? 'صنف غير محدد' : 'Unspecified product');
              const sid = String(item.sale_id || '');
              const key = String((sale as Record<string, unknown> | null)?.branch_id || '') + ':' + name;
              const row = byProduct.get(key) || { name, quantity: 0, sales: 0 };
              row.quantity += netSaleItemQuantity(item);
              row.sales += allocateSaleNetRevenue(netSaleItemRevenue(item), netSaleAmount(sale || {}), bySale.get(sid) || 0);
              byProduct.set(key, row);
            });
            products = [...byProduct.values()].sort((a, b) => b.sales - a.sales).slice(0, 5);
          } catch {
            warnings.push(ar ? 'أكمل التالي: راجع بيانات الأصناف المباعة ثم أعد التحميل.' : 'Complete the following: review product sales source then refresh.');
          }
        }
        if (cancelled) return;
        setData({
          amount: total, invoiceCount: inScope.length, refundAmount: refunds, currency,
          trend: [...amounts].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => ({ name: name.slice(5), value })),
          branches: [...byBranch].map(([id, value]) => ({ name: branchNames.get(id) || id, value })).sort((a, b) => b.value - a.value),
          payments, products, warnings,
        });
      } catch {
        if (!cancelled) setError(ar
          ? 'أكمل التالي: تعذّر تحميل تقرير المبيعات المعتمد. راجع صلاحياتك واتصال التقرير، ثم أعد المحاولة.'
          : 'Complete the following: source sales report failed. Check access and reporting connection, then retry.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [scopeKey, scope.loading, from, to, hasSales, allowedReportTypes, history, ar, effectiveSettings, branchNames, branchIds]);

  if (!hasSales) return null;
  const cards = [
    { key: 'sales', label: ar ? 'صافي المبيعات' : 'Net sales', value: data?.currency ? money(data.amount, data.currency, lang) : null, icon: TrendingUp, tone: 'bg-emerald-50 dark:bg-emerald-950/30' },
    { key: 'invoices', label: ar ? 'عدد الفواتير' : 'Invoices', value: data?.invoiceCount.toLocaleString(ar ? 'ar-EG' : 'en-US') ?? null, icon: Receipt, tone: 'bg-sky-50 dark:bg-sky-950/30' },
    { key: 'average', label: ar ? 'متوسط الفاتورة' : 'Average invoice', value: data?.currency && data.invoiceCount ? money(data.amount / data.invoiceCount, data.currency, lang) : null, icon: ShoppingBag, tone: 'bg-violet-50 dark:bg-violet-950/30' },
    { key: 'refunds', label: ar ? 'المرتجعات' : 'Refunds', value: data?.currency ? money(data.refundAmount, data.currency, lang) : null, icon: Undo2, tone: 'bg-rose-50 dark:bg-rose-950/30' },
  ];
  const renderUnavailable = (key: string) => (
    <p className="flex min-h-48 items-center justify-center p-4 text-center text-sm text-ui-muted" data-testid={`overview-missing-${key}`}>
      {ar ? 'أكمل التالي: البيانات غير متاحة من مصدر التقرير حاليًا.' : 'Complete the following: report source data is unavailable.'}
    </p>
  );
  const drill = (type: ReportType) => onSelectReport(type);
  return (
    <section className="space-y-4" data-testid="reports-live-dashboard">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-ui-border bg-ui-surface p-4 shadow-ui-sm">
        <div>
          <h2 className="text-base font-black text-ui-text">{ar ? 'ملخص الأداء' : 'Performance summary'}</h2>
          <p className="mt-1 text-xs text-ui-muted">{ar ? 'كل الرسوم والجداول تعرض بيانات الفترة والفروع المحددة من تقارير Premier.' : 'All charts reflect the selected period and authorized branches.'}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-ui-muted">{ar ? 'من' : 'From'}
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="ms-1 rounded-lg border border-ui-border bg-ui-page-alt p-2 text-ui-text" />
          </label>
          <label className="text-xs text-ui-muted">{ar ? 'إلى' : 'To'}
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="ms-1 rounded-lg border border-ui-border bg-ui-page-alt p-2 text-ui-text" />
          </label>
          <span className="flex items-center gap-1 rounded-lg bg-ui-page-alt px-3 py-2 text-xs text-ui-muted"><CalendarDays className="h-4 w-4" />{ar ? 'توقيت الفرع: القاهرة' : 'Branch time: Cairo'}</span>
        </div>
      </div>
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {loading && <p role="status" className="flex items-center gap-2 text-sm text-ui-muted"><RotateCw className="h-4 w-4 animate-spin" />{ar ? 'تحميل التقارير الفعلية...' : 'Loading live reports...'}</p>}
      {data?.warnings.map((warning) => <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" key={warning}><AlertCircle className="me-2 inline h-4 w-4" />{warning}</p>)}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map(card => <div key={card.key} className={`rounded-2xl border border-ui-border p-4 shadow-ui-sm ${card.tone}`}>
          <div className="flex items-center justify-between gap-2 text-xs font-bold text-ui-muted"><span>{card.label}</span><card.icon className="h-5 w-5 text-ui-primary" /></div>
          <div className="mt-3 text-xl font-black tabular-nums text-ui-text">{card.value ?? (ar ? 'أكمل البيانات' : 'Data required')}</div>
        </div>)}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <article className="min-w-0 rounded-2xl border border-ui-border bg-ui-surface p-4 shadow-ui-sm" data-testid="overview-sales-trend">
          <button className="mb-3 w-full text-start text-sm font-black text-ui-text hover:text-ui-primary" type="button" onClick={() => drill('sales')}>{ar ? 'المبيعات حسب الفترة ↗' : 'Sales by period ↗'}</button>
          {data?.trend.length ? <div className="h-56" dir="ltr"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.trend}><defs><linearGradient id="salesOverviewGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8649ec" stopOpacity={0.4}/><stop offset="100%" stopColor="#8649ec" stopOpacity={0.02}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" opacity={0.2}/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Area type="monotone" dataKey="value" stroke="#8649ec" strokeWidth={2.5} fill="url(#salesOverviewGradient)"/></AreaChart></ResponsiveContainer></div> : renderUnavailable('trend')}
        </article>
        <article className="min-w-0 rounded-2xl border border-ui-border bg-ui-surface p-4 shadow-ui-sm" data-testid="overview-payment-mix">
          <button className="mb-3 w-full text-start text-sm font-black text-ui-text hover:text-ui-primary" type="button" onClick={() => drill('sales_by_payment')}>{ar ? 'توزيع المبيعات حسب قنوات الدفع ↗' : 'Payment channel mix ↗'}</button>
          {data?.payments?.length ? <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
            <div className="h-56" dir="ltr"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.payments} innerRadius="54%" outerRadius="81%" dataKey="value" nameKey="name" paddingAngle={2}>{data.payments.map((p,i) => <Cell key={p.name} fill={COLORS[i % COLORS.length]}/>)}</Pie><Tooltip/></PieChart></ResponsiveContainer></div>
            <div className="space-y-2">{data.payments.map((p,i) => <div key={p.name} className="flex items-center gap-2 text-xs"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{background:COLORS[i%COLORS.length]}}/><span className="min-w-0 flex-1 truncate text-ui-text">{p.name}</span><span className="font-bold tabular-nums">{money(p.value,data.currency,lang)}</span></div>)}</div>
          </div> : renderUnavailable('payments')}
        </article>
        <article className="min-w-0 rounded-2xl border border-ui-border bg-ui-surface p-4 shadow-ui-sm" data-testid="overview-products">
          <button className="mb-3 w-full text-start text-sm font-black text-ui-text hover:text-ui-primary" type="button" onClick={() => drill('sales_by_product')}>{ar ? 'الأصناف الأكثر مبيعًا ↗' : 'Top selling items ↗'}</button>
          {data?.products?.length ? <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-ui-border text-ui-muted"><th className="p-2 text-start">{ar?'الصنف':'Product'}</th><th className="p-2 text-end">{ar?'الكمية':'Quantity'}</th><th className="p-2 text-end">{ar?'المبيعات':'Sales'}</th></tr></thead><tbody>{data.products.map((p,i)=><tr key={i} className="border-b border-ui-border/50"><td className="p-2 font-semibold">{p.name}</td><td className="p-2 text-end tabular-nums">{p.quantity.toLocaleString()}</td><td className="p-2 text-end font-bold tabular-nums">{money(p.sales,data.currency,lang)}</td></tr>)}</tbody></table></div> : renderUnavailable('products')}
        </article>
        <article className="min-w-0 rounded-2xl border border-ui-border bg-ui-surface p-4 shadow-ui-sm" data-testid="overview-branches">
          <button className="mb-3 w-full text-start text-sm font-black text-ui-text hover:text-ui-primary" type="button" onClick={() => drill('sales')}>{ar ? 'المبيعات حسب الفروع ↗' : 'Sales by branch ↗'}</button>
          {data?.branches.length ? <div className="h-56" dir="ltr"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.branches} margin={{bottom:22}}><CartesianGrid strokeDasharray="3 3" opacity={0.2}/><XAxis dataKey="name" tick={{fontSize:10}} interval={0}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="value" fill="#9c76e8" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></div> : renderUnavailable('branches')}
        </article>
      </div>
    </section>
  );
}
