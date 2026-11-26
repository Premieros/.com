import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpRight, BarChart3, CreditCard,
  RefreshCw, Wallet, ReceiptText,
  Calculator, ShoppingCart, ChefHat,
  Settings, History as HistoryIcon, Landmark,
} from 'lucide-react';
import { reporting, supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranchScope } from '@/lib/branchScope';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { useCan, type Permission } from '@/lib/permissions';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { formatFinancialCurrency, formatNumber, formatPercent } from '@/lib/format';
import {
  netSaleAmount,
  netSaleItemQuantity,
  type PaymentMethodAggregate,
} from '@/features/reporting/numericIntegrity';
import { loadDashboardPaymentAggregates } from '../services/dashboardPayments';
import { loadDashboardSalesSnapshot, type DashboardSalesSnapshot } from '../services/dashboardSnapshot';
import { DashboardStandbyBar } from '../components/DashboardStandbyBar';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';
import { DashboardBreakdown } from '../components/DashboardBreakdown';
import { Modal } from '@/components/Modal';
import { WorkspaceLiveDot, WorkspaceMeter, WorkspaceSparkline } from '@/components/design/WorkspaceIndicators';
import { businessDateISO } from '@/lib/businessTime';
import { REPORT_REGISTRY } from '@/features/reporting/reportRegistry';
import type { ReportType } from '@/features/reporting/reportFilters';
import { businessReportAllowed } from '@/core/organizations/businessRuntime';
import { APP_ROUTES } from '@/core/navigation/routes';

type Range = 'today' | 'week' | 'month' | 'year';
type AnalysisMetric = 'sales' | 'orders' | 'payments';
type RelatedName = { name?: string | null; name_en?: string | null; low_stock_threshold?: number | null };
type Sale = {
  id: string;
  invoice_number: string | null;
  total: number | null;
  paid_amount: number | null;
  payment_method: string | null;
  status: string | null;
  branch_id: string | null;
  created_at: string;
  order_type: string | null;
  refunded_amount: number | null;
  discount_amount: number | null;
  branch?: RelatedName | RelatedName[] | null;
};
type StockAlert = { key: string; itemId: string; name: string; quantity: number; threshold: number };
type RawStockMaster = { id: string; branch_id: string | null; name: string; min_stock: number | null; is_active: boolean | null };
type RawStockBalance = { raw_material_id: string; branch_id: string | null; quantity: number | null };
type UnitStockMaster = { id: string; branch_id: string | null; name: string; min_stock: number | null; low_stock_threshold: number | null; is_active: boolean | null };
type UnitStockBatch = { unit_id: string; branch_id: string | null; quantity: number | null };
type SaleItem = { quantity: number | null; refunded_quantity: number | null; product?: RelatedName | RelatedName[] | null };
type Point = { label: string; sales: number; previous: number };
type QuickStats = { expenses: number | null; profit: number | null; lowStockCount: number | null };
type ActiveOrderRow = {
  id: string;
  status: string | null;
  order_type: string | null;
  table_id: string | null;
  branch_id: string | null;
  total: number | null;
  order_items?: Array<{ quantity: number | null }> | null;
};
type DashboardOps = {
  openOrderValue: number;
  purchases: number;
  expenses: number;
  businessRecords: number;
};

const rangeLabels: Record<Range, [string, string]> = {
  today: ['اليوم', 'Today'],
  week: ['7 أيام', '7 days'],
  month: ['الشهر', 'Month'],
  year: ['السنة', 'Year'],
};
const orderLabels: Record<string, [string, string]> = {
  dine_in: ['الصالة', 'Dine-in'], takeaway: ['تيك أواي', 'Takeaway'], delivery: ['دليفري', 'Delivery'],
  car: ['سيارة', 'Car'], quick: ['سريع', 'Quick'], other: ['أخرى', 'Other'],
};
const paymentLabels: Record<string, [string, string]> = {
  cash: ['نقدي', 'Cash'], card: ['بطاقة', 'Card'], visa: ['فيزا / ماستركارد', 'Visa / Mastercard'],
  bank: ['تحويل بنكي', 'Bank transfer'], instapay: ['InstaPay', 'InstaPay'], wallet: ['محفظة إلكترونية', 'Wallet'],
  split: ['مختلط غير موزع', 'Unallocated split'], other: ['أخرى', 'Other'],
};

const DashboardSalesChart = lazy(() =>
  import('../components/DashboardSalesChart').then((module) => ({
    default: module.DashboardSalesChart,
  })),
);

function relation<T extends RelatedName>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

function buildStockAlerts(
  rawMasters: RawStockMaster[],
  rawBalances: RawStockBalance[],
  unitMasters: UnitStockMaster[],
  unitBatches: UnitStockBatch[],
  defaultThreshold: number,
): StockAlert[] {
  const rawQty = new Map<string, number>();
  rawBalances.forEach((row) => {
    const key = `${row.branch_id || ''}:${row.raw_material_id}`;
    rawQty.set(key, (rawQty.get(key) || 0) + Number(row.quantity || 0));
  });

  const unitQty = new Map<string, number>();
  unitBatches.forEach((row) => {
    const key = `${row.branch_id || ''}:${row.unit_id}`;
    unitQty.set(key, (unitQty.get(key) || 0) + Number(row.quantity || 0));
  });

  const rawAlerts = rawMasters
    .filter((row) => row.is_active !== false)
    .map((row) => {
      const key = `${row.branch_id || ''}:${row.id}`;
      return {
        key: `raw:${key}`,
        itemId: row.id,
        name: row.name,
        quantity: rawQty.get(key) || 0,
        threshold: Number(row.min_stock ?? defaultThreshold),
      };
    });

  const unitAlerts = unitMasters
    .filter((row) => row.is_active !== false)
    .map((row) => {
      const key = `${row.branch_id || ''}:${row.id}`;
      return {
        key: `unit:${key}`,
        itemId: row.id,
        name: row.name,
        quantity: unitQty.get(key) || 0,
        threshold: Number(row.low_stock_threshold ?? row.min_stock ?? defaultThreshold),
      };
    });

  return [...rawAlerts, ...unitAlerts]
    .filter((row) => row.quantity <= row.threshold)
    .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name));
}

function periodWindow(range: Range) {
  const now = new Date();
  const end = new Date(now);
  let start: Date;
  let previousStart: Date;
  let previousEnd: Date;

  if (range === 'today') {
    start = new Date(now); start.setHours(0, 0, 0, 0);
    previousStart = new Date(start); previousStart.setDate(previousStart.getDate() - 1);
    previousEnd = new Date(end); previousEnd.setDate(previousEnd.getDate() - 1);
  } else if (range === 'week') {
    start = new Date(now); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
    previousEnd = new Date(start); previousEnd.setMilliseconds(-1);
    previousStart = new Date(start); previousStart.setDate(previousStart.getDate() - 7);
  } else if (range === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevLastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    previousEnd = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), prevLastDay), now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  } else {
    start = new Date(now.getFullYear(), 0, 1);
    previousStart = new Date(now.getFullYear() - 1, 0, 1);
    previousEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  }
  return { start, end, previousStart, previousEnd };
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[22px] border border-ui-border bg-ui-surface p-5 shadow-ui ${className}`}>{children}</section>;
}

function Empty({ ar }: { ar: boolean }) {
  return <div className="flex min-h-[120px] items-center justify-center text-sm text-ui-subtle">{ar ? 'لا توجد بيانات فعلية للفترة المحددة' : 'No actual data for the selected period'}</div>;
}

function Metric({ testId, icon: Icon, title, value, display, previous, href, ar, detail, selected, onSelect, sparkValues }: {
  testId: string; icon: typeof Wallet; title: string; value: number; display: string; previous: number; href?: string; ar: boolean; detail?: ReactNode; selected?: boolean; onSelect?: () => void; sparkValues?: number[];
}) {
  const change = previous > 0 ? ((value - previous) / previous) * 100 : null;
  const positive = (change ?? 0) >= 0;
  const content = <>
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ui-primary-soft text-ui-primary">
          <Icon className="h-4 w-4" />
        </div>
        <p className="truncate text-[13px] font-semibold text-ui-muted">{title}</p>
      </div>
      {href && <ArrowUpRight className="h-4 w-4 shrink-0 text-ui-subtle transition group-hover:text-ui-primary" />}
    </div>
    <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
      <p className="min-w-0 truncate text-[26px] font-bold leading-none tracking-[-0.025em] text-ui-text tabular-nums">{display}</p>
      {sparkValues && sparkValues.some((v) => v > 0) && (
        <WorkspaceSparkline values={sparkValues.slice(-12)} tone={positive ? 'primary' : 'danger'} width={68} height={22} />
      )}
    </div>
    {detail && <div className="mt-2 text-xs font-semibold text-ui-muted">{detail}</div>}
    <div className="mt-auto flex flex-wrap items-center gap-2 pt-3 text-xs">
      {change === null ? <span className="text-ui-subtle">—</span> : (
        <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${positive ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-danger-soft text-ui-danger'}`}>
          {positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{formatPercent(Math.abs(change), 1)}
        </span>
      )}
      <span className="text-ui-subtle">{ar ? 'مقارنة بالفترة السابقة' : 'vs previous period'}</span>
    </div>
  </>;
  const className = `flex h-full min-w-0 flex-col overflow-hidden rounded-[22px] border border-ui-border bg-ui-surface p-5 shadow-ui transition-all ${href ? 'group hover:-translate-y-0.5 hover:shadow-ui-lg' : ''}`;
  if (onSelect) return (
    <button type="button" data-testid={testId} aria-pressed={selected} onClick={onSelect}
      className={`${className} text-start transition-colors hover:border-ui-primary/50 focus-visible:outline-2 focus-visible:outline-ui-ring ${selected ? 'border-ui-primary ring-2 ring-ui-primary/25' : ''}`}>
      {content}
    </button>
  );
  if (!href) return <div data-testid={testId} className={className}>{content}</div>;
  return <Link data-testid={testId} to={href} className={className}>{content}</Link>;
}

export function DashboardDataPage() {
  const { lang } = useLanguage();
  const can = useCan();
  const history = useHistoryAccess();
  const branchFilter = useBranchFilter();
  const branchScope = useBranchScope();
  const readBranchIds = useMemo(
    () => branchScope.selectedBranchIds.length ? branchScope.selectedBranchIds : (branchFilter ? [branchFilter] : []),
    [branchScope.selectedBranchIds, branchFilter],
  );
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const { organizationId, runtime, canAccessModule, canAccessPath } = useOrganizationModules();
  const ar = lang === 'ar';
  const dashboardSections = runtime.dashboard.sections;
  const canCreateSale = can('pos.view') && can('pos.order.create') && canAccessModule('pos') && canAccessPath(APP_ROUTES.pos);
  const canViewPos = can('pos.view') && canAccessModule('pos') && dashboardSections.has('orders');
  const canViewSales = (can('sales.view') || can('reports.view'))
    && dashboardSections.has('sales')
    && (canAccessModule('pos') || runtime.capabilities.has('service_sales'));
  const canViewReports = can('reports.view') && canAccessModule('reports');
  const canViewInventory = can('inventory.view') && canAccessModule('inventory') && dashboardSections.has('inventory');
  const canViewFloorPlan = can('floor_plan.view') && canAccessPath(APP_ROUTES.floorPlan);
  const canViewPurchases = can('purchases.view') && canAccessModule('purchases') && dashboardSections.has('purchases');
  const canViewExpenses = can('expenses.view') && canAccessModule('expenses') && dashboardSections.has('expenses');
  const canViewKds = can('pos.kds_view') && canAccessPath(APP_ROUTES.kitchenDisplay);
  const canViewFinancial = can('reports.financial') && canAccessModule('accounting') && dashboardSections.has('finance');
  const canViewBusinessRecords = can('customers.view') && dashboardSections.has('business_records') && runtime.recordTypes.length > 0;
  const canViewAudit = can('audit.view') && canAccessModule('audit_logs') && canAccessPath(APP_ROUTES.auditLog);
  const canViewSettings = can('settings.manage') && canAccessPath(APP_ROUTES.settings);
  const canViewTreasury = can('accounts.view') && canAccessModule('accounting') && canAccessPath(APP_ROUTES.treasury);
  const quickActionPermitted = (route: string): boolean => {
    if (route === APP_ROUTES.pos) return can('pos.view');
    if (route === APP_ROUTES.floorPlan) return canViewFloorPlan;
    if (route === APP_ROUTES.kitchenDisplay) return canViewKds;
    if (route === APP_ROUTES.purchases) return canViewPurchases;
    if (route === APP_ROUTES.products) return can('products.view');
    if (route === APP_ROUTES.customers) return can('customers.view');
    if (route === APP_ROUTES.accounts) return can('accounts.view') && canAccessModule('accounting');
    if (route === APP_ROUTES.sales) return can('sales.view');
    if (route === APP_ROUTES.inventory) return can('inventory.view');
    return true;
  };
  const visibleQuickActions = runtime.dashboard.quickActions.filter((action) =>
    (!action.module || canAccessModule(action.module))
    && (!action.capability || runtime.capabilities.has(action.capability))
    && canAccessPath(action.route)
    && quickActionPermitted(action.route),
  );
  const quickRoutes = new Set(visibleQuickActions.map((action) => action.route));
  const [params, setParams] = useSearchParams();
  const requestedRange = params.get('range');
  const range = (Object.keys(rangeLabels) as Range[]).find((key) => key === requestedRange)
    ?? (history.unlimited ? 'month' : 'week');
  const requestedMetric = params.get('metric');
  const metric: AnalysisMetric = requestedMetric === 'orders' || requestedMetric === 'payments' ? requestedMetric : 'sales';
  const compare = params.get('compare') === '1';
  const groupByWeek = range === 'month' && params.get('group') === 'week';
  const [expanded, setExpanded] = useState(false);
  const requestId = useRef(0);
  const lastSalesScope = useRef<string>();
  const updateView = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSalesSnapshot | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [previousSales, setPreviousSales] = useState<Sale[]>([]);
  const [paymentAggregates, setPaymentAggregates] = useState<PaymentMethodAggregate[]>([]);
  const [previousPaymentAggregates, setPreviousPaymentAggregates] = useState<PaymentMethodAggregate[]>([]);
  const [stockAlerts, setStockAlerts] = useState<StockAlert[]>([]);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [quickStats, setQuickStats] = useState<QuickStats>({ expenses: null, profit: null, lowStockCount: null });
  const [ops, setOps] = useState<DashboardOps>({
    openOrderValue: 0,
    purchases: 0,
    expenses: 0,
    businessRecords: 0,
  });
  const settings = effectiveSettings(branchFilter);
  const money = useCallback((value: number) => formatFinancialCurrency(value, settings?.currency || 'EGP', lang), [settings?.currency, lang]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    const scope = `${branchScope.scopeKey}:${range}`;
    if (!canViewSales || lastSalesScope.current !== scope) {
      setSnapshot(null);
      setSales([]);
      setPreviousSales([]);
      setPaymentAggregates([]);
      setPreviousPaymentAggregates([]);
      setItems([]);
    }
    setRefreshing(true);
    setError(null);
    if (!canViewSales) {
      lastSalesScope.current = undefined;
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const effectiveRange: Range = range;
    const window = periodWindow(effectiveRange);
    let boundedSnapshot: DashboardSalesSnapshot | null;
    try {
      boundedSnapshot = await loadDashboardSalesSnapshot({
        branchId: branchFilter || null,
        branchIds: readBranchIds,
        currentFrom: window.start.toISOString(),
        currentTo: window.end.toISOString(),
        previousFrom: window.previousStart.toISOString(),
        previousTo: window.previousEnd.toISOString(),
        granularity: effectiveRange === 'today' ? 'hour' : effectiveRange === 'year' ? 'month' : 'day',
        timezone: 'Africa/Cairo',
      });
    } catch {
      if (requestId.current !== id) return;
      // Keep the last successful dashboard instead of turning a slow/failed
      // snapshot into a burst of raw sales, sale-items and payment queries.
      setError(ar ? 'تعذر تحديث ملخص المبيعات. أعد المحاولة.' : 'Sales summary could not refresh. Please retry.');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (requestId.current !== id) return;
    if (boundedSnapshot) {
      lastSalesScope.current = scope;
      setSnapshot(boundedSnapshot);
      setSales([]);
      setPreviousSales([]);
      setItems([]);
      setPaymentAggregates(boundedSnapshot.paymentMethods);
      setPreviousPaymentAggregates(boundedSnapshot.previousPaymentMethods);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setSnapshot(null);
    const fields = 'id,invoice_number,total,paid_amount,payment_method,status,branch_id,created_at,order_type,refunded_amount,discount_amount,branch:branches(name,name_en)';
    const previousFields = 'id,total,paid_amount,payment_method,branch_id,created_at,refunded_amount,discount_amount';
    let currentQuery = supabase.from('sales').select(fields).gte('created_at', window.start.toISOString()).lte('created_at', window.end.toISOString()).order('created_at', { ascending: false }).limit(5000);
    let previousQuery = supabase.from('sales').select(previousFields).gte('created_at', window.previousStart.toISOString()).lte('created_at', window.previousEnd.toISOString()).order('created_at', { ascending: false }).limit(5000);
    if (readBranchIds.length) {
      currentQuery = currentQuery.in('branch_id', readBranchIds);
      previousQuery = previousQuery.in('branch_id', readBranchIds);
    }

    const [currentResult, previousResult] = await Promise.all([currentQuery, previousQuery]);
    if (requestId.current !== id) return;
    const currentRows = currentResult.error ? [] : ((currentResult.data || []) as unknown as Sale[]);
    const previousRows = previousResult.error ? [] : ((previousResult.data || []) as unknown as Sale[]);
    setSales(currentRows);
    setPreviousSales(previousRows);
    if (currentResult.error) setError(ar ? 'تعذر تحميل بيانات المبيعات. أعد المحاولة.' : 'Sales data could not be loaded. Please retry.');

    const paymentPromise = Promise.allSettled([
      loadDashboardPaymentAggregates({
        sales: currentRows,
        from: window.start.toISOString(),
        to: window.end.toISOString(),
      }),
      loadDashboardPaymentAggregates({
        sales: previousRows,
        from: window.previousStart.toISOString(),
        to: window.previousEnd.toISOString(),
      }),
    ]);
    let itemPromise: PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }> = Promise.resolve({ data: [], error: null });
    if (currentRows.length) {
      let itemQuery = supabase
        .from('sale_items')
        .select('quantity,refunded_quantity,product:products(name),sale:sales!inner(created_at,branch_id)')
        .gte('sale.created_at', window.start.toISOString())
        .lte('sale.created_at', window.end.toISOString())
        .limit(5000);
      if (readBranchIds.length) itemQuery = itemQuery.in('sale.branch_id', readBranchIds);
      itemPromise = itemQuery;
    }

    const [paymentResults, itemResult] = await Promise.all([paymentPromise, itemPromise]);
    if (requestId.current !== id) return;
    const currentPaymentResult = paymentResults[0];
    const previousPaymentResult = paymentResults[1];
    setPaymentAggregates(currentPaymentResult.status === 'fulfilled' ? currentPaymentResult.value : []);
    setPreviousPaymentAggregates(previousPaymentResult.status === 'fulfilled' ? previousPaymentResult.value : []);
    if (paymentResults.some((result) => result.status === 'rejected')) {
      setError(ar ? 'تعذر تحميل تفاصيل طرق الدفع. أعد المحاولة.' : 'Payment-method details could not be loaded. Please retry.');
    }
    setItems(itemResult.error ? [] : ((itemResult.data || []) as unknown as SaleItem[]));
    if (!currentResult.error) lastSalesScope.current = scope;

    setLoading(false);
    setRefreshing(false);
  }, [ar, branchFilter, branchScope.scopeKey, range, canViewSales, readBranchIds]);

  useEffect(() => {
    setLoading(true);
    void load();
    return () => { requestId.current += 1; };
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const now = new Date();
      let rawMasterQuery = canViewInventory ? supabase.from('raw_materials').select('id,branch_id,name,min_stock,is_active').eq('is_active', true) : null;
      let rawBalanceQuery = canViewInventory ? supabase.from('raw_material_inventory').select('raw_material_id,branch_id,quantity') : null;
      let unitMasterQuery = canViewInventory ? supabase.from('inventory_units').select('id,branch_id,name,min_stock,low_stock_threshold,is_active').eq('is_active', true) : null;
      let unitBatchQuery = canViewInventory ? supabase.from('inventory_unit_batches').select('unit_id,branch_id,quantity') : null;
      if (readBranchIds.length) {
        if (rawMasterQuery) rawMasterQuery = rawMasterQuery.in('branch_id', readBranchIds);
        if (rawBalanceQuery) rawBalanceQuery = rawBalanceQuery.in('branch_id', readBranchIds);
        if (unitMasterQuery) unitMasterQuery = unitMasterQuery.in('branch_id', readBranchIds);
        if (unitBatchQuery) unitBatchQuery = unitBatchQuery.in('branch_id', readBranchIds);
      }
      const [rawMastersResult, rawBalancesResult, unitMastersResult, unitBatchesResult] = await Promise.all([
        rawMasterQuery ?? Promise.resolve({ data: [], error: null }),
        rawBalanceQuery ?? Promise.resolve({ data: [], error: null }),
        unitMasterQuery ?? Promise.resolve({ data: [], error: null }),
        unitBatchQuery ?? Promise.resolve({ data: [], error: null }),
      ]);
      if (cancelled) return;
      const stockQueryFailed = !canViewInventory || Boolean(rawMastersResult.error || rawBalancesResult.error || unitMastersResult.error || unitBatchesResult.error);
      const alerts = stockQueryFailed ? [] : buildStockAlerts(
        (rawMastersResult.data || []) as RawStockMaster[],
        (rawBalancesResult.data || []) as RawStockBalance[],
        (unitMastersResult.data || []) as UnitStockMaster[],
        (unitBatchesResult.data || []) as UnitStockBatch[],
        Number(settings?.low_stock_threshold ?? 5),
      );
      setStockAlerts(alerts);
      const lowStockCount = stockQueryFailed ? null : alerts.length;
      const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const to = now.toISOString().slice(0, 10);
      const selectedBranchSet = new Set(readBranchIds);
      const targetBranches = branches.filter((branch) => selectedBranchSet.has(branch.id));
      const statements = canViewFinancial
        ? await Promise.all(targetBranches.map((branch) => reporting.getIncomeStatement({ p_branch_id: branch.id, p_from_date: from, p_to_date: to })))
        : [];
      if (cancelled) return;
      const validStatements = statements.filter((result) => !result.error && result.data);
      const expenses = canViewFinancial && targetBranches.length && validStatements.length === targetBranches.length ? validStatements.reduce((sum, result) => sum + Number(result.data?.expenses || 0), 0) : null;
      const profit = canViewFinancial && targetBranches.length && validStatements.length === targetBranches.length ? validStatements.reduce((sum, result) => sum + Number(result.data?.net_income || 0), 0) : null;
      setQuickStats({ expenses, profit, lowStockCount });
    })();
    return () => { cancelled = true; };
  }, [readBranchIds, branches, settings?.low_stock_threshold, canViewInventory, canViewFinancial]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const effectiveRange: Range = range;
      const window = periodWindow(effectiveRange);
      const fromIso = window.start.toISOString();
      const fromDate = fromIso.slice(0, 10);

      const orderPromise = canViewPos
        ? (() => {
            let q = supabase
              .from('orders')
              .select('id,status,order_type,table_id,branch_id,total,order_items(quantity)')
              .in('status', ['open', 'held'])
              .limit(5000);
            if (readBranchIds.length) q = q.in('branch_id', readBranchIds);
            return q;
          })()
        : Promise.resolve({ data: [], error: null });

      const purchasePromise = canViewPurchases
        ? (() => {
            let q = supabase.from('purchases').select('total,returned_amount,branch_id,created_at').gte('created_at', fromIso);
            if (readBranchIds.length) q = q.in('branch_id', readBranchIds);
            return q;
          })()
        : Promise.resolve({ data: [], error: null });

      const expensePromise = canViewExpenses
        ? (() => {
            let q = supabase.from('expenses').select('amount,branch_id,expense_date,status').gte('expense_date', fromDate).neq('status', 'voided');
            if (readBranchIds.length) q = q.in('branch_id', readBranchIds);
            return q;
          })()
        : Promise.resolve({ data: [], error: null });

      const businessRecordsPromise = canViewBusinessRecords && organizationId
        ? (() => {
            let q = supabase
              .from('business_records')
              .select('id', { count: 'exact', head: true })
              .eq('organization_id', organizationId)
              .neq('status', 'cancelled');
            if (readBranchIds.length) q = q.in('branch_id', readBranchIds);
            return q;
          })()
        : Promise.resolve({ count: 0, data: [], error: null });

      const [ordersRes, purchasesRes, expensesRes, businessRecordsRes] = await Promise.all([
        orderPromise, purchasePromise, expensePromise, businessRecordsPromise,
      ]);
      if (cancelled) return;

      const activeOrders = ((ordersRes.data || []) as unknown as ActiveOrderRow[]).filter((order) =>
        (order.order_items || []).some((item) => Number(item.quantity || 0) > 0),
      );
      setOps({
        openOrderValue: activeOrders.reduce((sum, order) => sum + Math.max(0, Number(order.total || 0)), 0),
        purchases: (purchasesRes.data || []).reduce((sum: number, row: Record<string, unknown>) => sum + Math.max(0, Number(row.total || 0) - Number(row.returned_amount || 0)), 0),
        expenses: (expensesRes.data || []).reduce((sum: number, row: Record<string, unknown>) => sum + Number(row.amount || 0), 0),
        businessRecords: Number(businessRecordsRes.count || 0),
      });
    })();

    return () => { cancelled = true; };
  }, [
    branchFilter, branchScope.scopeKey, range,
    canViewPos, canViewPurchases, canViewExpenses, canViewBusinessRecords, organizationId, readBranchIds,
  ]);

  const current = useMemo(() => {
    if (snapshot) return snapshot.current;
    const methods = paymentAggregates;
    return {
      orders: sales.length,
      sales: sales.reduce((sum, sale) => sum + netSaleAmount(sale), 0),
      payments: methods.reduce((sum, row) => sum + row.total, 0),
      returns: sales.reduce((sum, sale) => sum + Number(sale.refunded_amount || 0), 0),
      discounts: sales.reduce((sum, sale) => sum + Number(sale.discount_amount || 0), 0),
    };
  }, [sales, paymentAggregates, snapshot]);
  const previous = useMemo(() => {
    if (snapshot) return snapshot.previous;
    const methods = previousPaymentAggregates;
    return {
      orders: previousSales.length,
      sales: previousSales.reduce((sum, sale) => sum + netSaleAmount(sale), 0),
      payments: methods.reduce((sum, row) => sum + row.total, 0),
      returns: previousSales.reduce((sum, sale) => sum + Number(sale.refunded_amount || 0), 0),
      discounts: previousSales.reduce((sum, sale) => sum + Number(sale.discount_amount || 0), 0),
    };
  }, [previousSales, previousPaymentAggregates, snapshot]);
  const paymentRows = useMemo(() => {
    const totals = new Map<string, number>();
    for (const { method, total } of paymentAggregates) {
      totals.set(method, (totals.get(method) ?? 0) + total);
    }
    return [...totals].sort((a, b) => b[1] - a[1]);
  }, [paymentAggregates]);
  const orderRows = useMemo(() => {
    if (snapshot) return snapshot.orderTypes.map((row) => [row.key, row.count] as [string, number]);
    const map = new Map<string, number>();
    sales.forEach((sale) => map.set(sale.order_type || 'other', (map.get(sale.order_type || 'other') || 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [sales, snapshot]);
  const productRows = useMemo(() => {
    if (snapshot) return snapshot.topProducts.map((row) => [row.name, row.quantity] as [string, number]);
    const map = new Map<string, number>();
    items.forEach((item) => {
      const product = relation(item.product);
      const name = product?.name || (ar ? 'غير محدد' : 'Unknown');
      map.set(name, (map.get(name) || 0) + netSaleItemQuantity(item));
    });
    return [...map.entries()].filter(([, qty]) => qty > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [ar, items, snapshot]);
  const branchRows = useMemo(() => {
    if (snapshot) {
      return snapshot.branches.map((row) => {
        const branch = branches.find((item) => item.id === row.branchId);
        const name = ar ? branch?.name || 'غير محدد' : branch?.name_en || branch?.name || 'Unknown';
        return [name, { orders: row.orders, sales: row.sales }] as [string, { orders: number; sales: number }];
      });
    }
    const map = new Map<string, { orders: number; sales: number }>();
    sales.forEach((sale) => {
      const branch = relation(sale.branch);
      const name = ar ? branch?.name || 'غير محدد' : branch?.name_en || branch?.name || 'Unknown';
      const row = map.get(name) || { orders: 0, sales: 0 };
      row.orders += 1; row.sales += netSaleAmount(sale); map.set(name, row);
    });
    return [...map.entries()].sort((a, b) => b[1].sales - a[1].sales).slice(0, 5);
  }, [ar, branches, sales, snapshot]);
  const lowStock = useMemo(() => stockAlerts.slice(0, 5), [stockAlerts]);

  const chart = useMemo<Point[]>(() => {
    const effectiveRange: Range = range;
    const window = periodWindow(effectiveRange);
    const currentMap = new Map<string, number>();
    const previousMap = new Map<string, number>();
    const key = (date: Date) => effectiveRange === 'today' ? String(date.getHours()) : effectiveRange === 'year' ? String(date.getMonth()) : date.toISOString().slice(0, 10);
    if (snapshot) {
      const snapshotKey = (bucket: string) => effectiveRange === 'today'
        ? String(Number(bucket.slice(11, 13)))
        : effectiveRange === 'year'
        ? String(Math.max(0, Number(bucket.slice(5, 7)) - 1))
        : bucket.slice(0, 10);
      snapshot.currentSeries.forEach((row) => currentMap.set(snapshotKey(row.bucket), row.sales));
      snapshot.previousSeries.forEach((row) => previousMap.set(snapshotKey(row.bucket), row.sales));
    } else {
      sales.forEach((sale) => currentMap.set(key(new Date(sale.created_at)), (currentMap.get(key(new Date(sale.created_at))) || 0) + netSaleAmount(sale)));
      previousSales.forEach((sale) => previousMap.set(key(new Date(sale.created_at)), (previousMap.get(key(new Date(sale.created_at))) || 0) + netSaleAmount(sale)));
    }
    if (effectiveRange === 'today') return Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, '0')}:00`, sales: currentMap.get(String(hour)) || 0, previous: previousMap.get(String(hour)) || 0 }));
    if (effectiveRange === 'year') return Array.from({ length: 12 }, (_, month) => ({ label: new Date(window.start.getFullYear(), month, 1).toLocaleDateString(ar ? 'ar-EG' : 'en-US', { month: 'short' }), sales: currentMap.get(String(month)) || 0, previous: previousMap.get(String(month)) || 0 }));
    const dayCount = effectiveRange === 'month' ? new Date(window.start.getFullYear(), window.start.getMonth() + 1, 0).getDate() : 7;
    return Array.from({ length: dayCount }, (_, index) => {
      const date = new Date(window.start); date.setDate(date.getDate() + index);
      const dateKey = date.toISOString().slice(0, 10);
      const prevDate = new Date(window.previousStart); prevDate.setDate(prevDate.getDate() + index);
      return { label: date.toLocaleDateString(ar ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' }), sales: currentMap.get(dateKey) || 0, previous: previousMap.get(prevDate.toISOString().slice(0, 10)) || 0 };
    });
  }, [ar, previousSales, range, sales, snapshot]);

  const displayedChart = useMemo(() => {
    if (!groupByWeek) return chart;
    const points: Point[] = [];
    for (let start = 0; start < chart.length; start += 7) {
      const week = chart.slice(start, start + 7);
      points.push({
        label: `${week[0].label} – ${week[week.length - 1].label}`,
        sales: week.reduce((total, point) => total + point.sales, 0),
        previous: week.reduce((total, point) => total + point.previous, 0),
      });
    }
    return points;
  }, [chart, groupByWeek]);

  const quick = (value: number | null, formatter: (value: number) => string) => value === null ? '—' : formatter(value);
  const recent = snapshot ? snapshot.recentSales : sales.slice(0, 5);

  const period = periodWindow(range);
  const dates = history.clampRange(businessDateISO(period.start), businessDateISO(period.end));
  const canCompare = history.unlimited;
  const reportLink = (type: ReportType, orderType?: string) => {
    const report = REPORT_REGISTRY.find((entry) => entry.key === type);
    if (!canViewReports || !canAccessPath(APP_ROUTES.reportView) || !report
      || !report.permissions.every((permission) => can(permission as Permission))
      || !businessReportAllowed(runtime, type, report.category)) return undefined;
    return `${APP_ROUTES.reportView}?${new URLSearchParams({ type, from: dates.from, to: dates.to, ...(orderType ? { order_type: orderType } : {}) }).toString()}`;
  };
  const analysis = {
    sales: { title: ar ? 'حركة صافي المبيعات' : 'Net sales performance', href: reportLink('sales') },
    orders: { title: ar ? 'الطلبات حسب النوع' : 'Orders by type', href: reportLink('detailed_invoices') },
    payments: { title: ar ? 'صافي المدفوعات حسب الطريقة' : 'Net payments by method', href: reportLink('sales_by_payment') },
  }[metric];
  const orderBreakdown = orderRows.map(([key, value]) => ({
    key, label: orderLabels[key]?.[ar ? 0 : 1] || key, value,
    href: key === 'other' ? undefined : reportLink('detailed_invoices', key),
  }));
  const paymentBreakdown = paymentRows.map(([key, value]) => ({ key, label: paymentLabels[key]?.[ar ? 0 : 1] || key, value }));
  const renderAnalysis = (large: boolean) => metric === 'sales' ? (
    <div className={`min-w-0 text-ui-primary ${large ? 'h-[min(55vh,24rem)]' : 'h-72'}`} dir="ltr">
      {current.orders > 0 || (compare && canCompare && previous.orders > 0) ? (
        <Suspense fallback={<div className="flex h-full items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin" /></div>}>
          <DashboardSalesChart data={displayedChart} formatValue={money} compare={compare && canCompare}
            labels={{ current: ar ? 'الفترة الحالية' : 'Current period', previous: ar ? 'الفترة السابقة' : 'Previous period' }} />
        </Suspense>
      ) : <Empty ar={ar} />}
    </div>
  ) : (
    <div className="mt-4">
      {(metric === 'orders' ? orderBreakdown.length : paymentBreakdown.length) ? (
        <DashboardBreakdown rows={metric === 'orders' ? orderBreakdown : paymentBreakdown}
          formatValue={metric === 'orders' ? (value) => formatNumber(value, 0) : money} />
      ) : <Empty ar={ar} />}
    </div>
  );

  return <div dir={ar ? 'rtl' : 'ltr'} className="min-h-[calc(100vh-64px)] w-full min-w-0 bg-transparent py-2 sm:py-3" data-testid="dashboard-surface"><div className="w-full min-w-0 space-y-5">
    <DashboardStandbyBar canCreateSale={canCreateSale} />

    <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-ui-border bg-ui-surface px-3 py-1 text-xs font-medium text-ui-muted shadow-ui-sm">
          <WorkspaceLiveDot tone="success" />
          <span>{new Date().toLocaleDateString(ar ? 'ar-EG' : 'en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
        </div>
        <h1 className="sr-only">
          {ar ? `لوحة ${runtime.title.ar}` : `${runtime.title.en} Dashboard`}
        </h1>
        {(runtime.description.ar || runtime.description.en) && (
          <p className="sr-only">{ar ? runtime.description.ar : runtime.description.en}</p>
        )}
        {((canCreateSale && !quickRoutes.has(APP_ROUTES.pos)) || (can('sales.view') && canAccessPath(APP_ROUTES.sales) && !quickRoutes.has(APP_ROUTES.sales))) && (
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {canCreateSale && !quickRoutes.has(APP_ROUTES.pos) && (
              <Link
                to={APP_ROUTES.pos}
                className="inline-flex items-center gap-1.5 rounded-full bg-ui-primary px-4 py-2 text-xs font-semibold text-ui-primary-fg shadow-ui-sm transition hover:bg-ui-primary-hover"
              >
                <ShoppingCart className="h-3.5 w-3.5" />
                <span>{ar ? 'طلب جديد' : 'New order'}</span>
              </Link>
            )}
            {can('sales.view') && canAccessPath(APP_ROUTES.sales) && !quickRoutes.has(APP_ROUTES.sales) && (
              <Link
                to={APP_ROUTES.sales}
                className="inline-flex items-center gap-1.5 rounded-full border border-ui-border bg-ui-surface px-4 py-2 text-xs font-semibold text-ui-text shadow-ui-sm transition hover:border-ui-border-strong hover:bg-ui-page-alt"
              >
                <ReceiptText className="h-3.5 w-3.5 text-ui-primary" />
                <span>{ar ? 'سجل الفواتير' : 'View invoices'}</span>
              </Link>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-full border border-ui-border bg-ui-surface p-1 shadow-ui-sm">
          {(Object.keys(rangeLabels) as Range[]).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={range === item}
              onClick={() => updateView('range', item)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-all ${range === item ? 'bg-ui-text text-ui-surface shadow-ui-sm' : 'text-ui-muted hover:text-ui-text'}`}
            >
              {rangeLabels[item][ar ? 0 : 1]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-ui-border bg-ui-surface text-ui-muted shadow-ui-sm transition hover:border-ui-border-strong hover:text-ui-text"
          aria-label={ar ? 'تحديث' : 'Refresh'}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </section>

    {visibleQuickActions.length > 0 && (
      <section data-testid="business-runtime-quick-actions" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {visibleQuickActions.map((action) => (
          <Link
            key={action.id}
            to={action.route}
            className="flex items-center justify-between gap-2 rounded-[18px] border border-ui-border bg-ui-surface px-4 py-3.5 text-sm font-semibold text-ui-text shadow-ui-sm transition hover:-translate-y-0.5 hover:border-ui-primary/40 hover:shadow-ui"
          >
            <span>{ar ? action.ar : action.en}</span>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-ui-primary-soft text-xs font-bold text-ui-primary">→</span>
          </Link>
        ))}
      </section>
    )}

    {error && <div className="rounded-[20px] border border-ui-danger/30 bg-ui-danger-soft p-4 text-sm font-bold text-ui-danger">{error}</div>}

    {(canViewFinancial || canViewInventory) && <Card><div className="mb-4"><h2 className="text-lg font-bold text-ui-text">{ar ? `ملخص ${rangeLabels[range][0]}` : `${rangeLabels[range][1]} summary`}</h2><p className="text-xs text-ui-subtle">{ar ? 'المبيعات صافية بعد المرتجعات، والربح من قائمة الدخل المحاسبية' : 'Sales are net of refunds; profit comes from the accounting income statement'}</p></div><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {canViewFinancial && <div className="min-w-0 rounded-[18px] border border-ui-border bg-ui-page-alt p-4"><p className="truncate text-xs font-medium text-ui-muted">{ar ? 'المصروفات المحاسبية' : 'Accounting expenses'}</p><p className="mt-2 truncate text-xl font-bold text-ui-text tabular-nums">{quick(quickStats.expenses, money)}</p></div>}
      {canViewFinancial && <div className="min-w-0 rounded-[18px] border border-ui-border bg-ui-page-alt p-4"><p className="truncate text-xs font-medium text-ui-muted">{ar ? 'صافي الربح المحاسبي' : 'Accounting net profit'}</p><p className="mt-2 truncate text-xl font-bold text-ui-text tabular-nums">{quick(quickStats.profit, money)}</p></div>}
      {canViewInventory && <div className="min-w-0 rounded-[18px] border border-ui-border bg-ui-page-alt p-4"><p className="truncate text-xs font-medium text-ui-muted">{ar ? 'تنبيهات المخزون' : 'Low stock alerts'}</p><p className="mt-2 truncate text-xl font-bold text-ui-text tabular-nums">{quick(quickStats.lowStockCount, (value) => formatNumber(value, 0))}</p></div>}
    </div></Card>}

    {loading ? <div className="flex h-64 items-center justify-center rounded-3xl border border-ui-border bg-ui-surface"><RefreshCw className="h-7 w-7 animate-spin text-ui-primary" /></div> : <>
      <section data-testid="dashboard-permission-kpis" className="premier-refresh-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {canViewPos && <Metric testId="kpi-open-order-value" icon={Wallet} title={ar ? 'قيمة الطلبات المفتوحة' : 'Open order value'} value={ops.openOrderValue} display={money(ops.openOrderValue)} previous={0} href={canViewFloorPlan ? '/floor-plan' : undefined} ar={ar} />}
        {canViewSales && <Metric testId="kpi-net-sales" icon={BarChart3} title={ar ? 'صافي المبيعات' : 'Net sales'} value={current.sales} display={money(current.sales)} previous={canCompare ? previous.sales : 0} selected={metric === 'sales'} onSelect={() => updateView('metric', '')} sparkValues={chart.map((p) => p.sales)} ar={ar} />}
        {canViewSales && <Metric testId="kpi-orders" icon={ReceiptText} title={ar ? 'إجمالي الطلبات' : 'Total orders'} value={current.orders} display={formatNumber(current.orders, 0)} previous={canCompare ? previous.orders : 0} selected={metric === 'orders'} onSelect={() => updateView('metric', 'orders')} ar={ar} />}
        {canViewSales && <Metric testId="kpi-average-order" icon={Calculator} title={ar ? 'متوسط قيمة الطلب' : 'Average order'} value={current.orders ? current.sales / current.orders : 0} display={money(current.orders ? current.sales / current.orders : 0)} previous={canCompare && previous.orders ? previous.sales / previous.orders : 0} href={reportLink('sales')} ar={ar} />}
        {canViewSales && <Metric testId="kpi-net-payments" icon={CreditCard} title={ar ? 'صافي المدفوعات' : 'Net payments'} value={current.payments} display={money(current.payments)} previous={canCompare ? previous.payments : 0} selected={metric === 'payments'} onSelect={() => updateView('metric', 'payments')} ar={ar} />}
        {canViewSales && <Metric testId="kpi-discounts" icon={Calculator} title={ar ? 'الخصومات' : 'Discounts'} value={current.discounts} display={money(current.discounts)} previous={canCompare ? previous.discounts : 0} href={reportLink('sales')} ar={ar} />}
        {canViewSales && <Metric testId="kpi-returns" icon={ReceiptText} title={ar ? 'المرتجعات' : 'Returns'} value={current.returns} display={money(current.returns)} previous={canCompare ? previous.returns : 0} href={reportLink('returns')} ar={ar} />}
        {canViewPurchases && <Metric testId="kpi-purchases" icon={ShoppingCart} title={ar ? 'المشتريات' : 'Purchases'} value={ops.purchases} display={money(ops.purchases)} previous={0} href="/purchases" ar={ar} />}
        {canViewExpenses && <Metric testId="kpi-expenses" icon={Wallet} title={ar ? 'المصروفات' : 'Expenses'} value={ops.expenses} display={money(ops.expenses)} previous={0} href="/expenses" ar={ar} />}
        {canViewBusinessRecords && <Metric testId="kpi-business-records" icon={ReceiptText} title={runtime.navigation.menuLabels['business-records']?.[ar ? 'ar' : 'en'] || (ar ? 'سجلات النشاط' : 'Business records')} value={ops.businessRecords} display={formatNumber(ops.businessRecords, 0)} previous={0} href={APP_ROUTES.businessRecords} ar={ar} />}
      </section>

      {canViewSales && (
        <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 aria-live="polite" className="text-lg font-bold text-ui-text">{analysis.title}</h2>
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                {metric === 'sales' && range === 'month' && (
                  <div role="group" aria-label={ar ? 'تجميع الرسم' : 'Chart grouping'} className="flex rounded-full border border-ui-border bg-ui-page-alt p-0.5">
                    <button type="button" aria-pressed={!groupByWeek} onClick={() => updateView('group', '')}
                      className="rounded-full px-3 py-1.5 aria-pressed:bg-ui-surface aria-pressed:text-ui-text aria-pressed:shadow-ui-sm">
                      {ar ? 'يومي' : 'Daily'}
                    </button>
                    <button type="button" aria-pressed={groupByWeek} onClick={() => updateView('group', 'week')}
                      className="rounded-full px-3 py-1.5 aria-pressed:bg-ui-surface aria-pressed:text-ui-text aria-pressed:shadow-ui-sm">
                      {ar ? 'أسبوعي' : 'Weekly'}
                    </button>
                  </div>
                )}
                {metric === 'sales' && canCompare && (
                  <button type="button" aria-pressed={compare} onClick={() => updateView('compare', compare ? '' : '1')}
                    className="rounded-full border border-ui-border px-3 py-1.5 aria-pressed:border-ui-primary aria-pressed:bg-ui-primary-soft aria-pressed:text-ui-primary">
                    {ar ? 'مقارنة بالفترة السابقة' : 'Compare previous period'}
                  </button>
                )}
                <button type="button" onClick={() => setExpanded(true)} className="rounded-full border border-ui-border px-3 py-1.5 hover:bg-ui-page-alt">
                  {ar ? 'توسيع العرض' : 'Expand view'}
                </button>
                {analysis.href && <Link to={analysis.href} className="rounded-full bg-ui-primary-soft px-3 py-1.5 text-ui-primary hover:bg-ui-primary hover:text-ui-primary-fg">{ar ? 'فتح التقرير' : 'Open report'}</Link>}
              </div>
            </div>
            <div aria-hidden={expanded}>{renderAnalysis(false)}</div>
            <Modal manageFocus open={expanded} onClose={() => setExpanded(false)} title={analysis.title} size="xl">
              {expanded && renderAnalysis(true)}
            </Modal>
          </Card>

          <Card className="flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-ui-text">{ar ? 'نظرة التحصيل والمبيعات' : 'Sales & collection'}</h2>
              <span className="rounded-full bg-ui-page-alt px-2.5 py-1 text-[11px] font-semibold text-ui-muted">
                {rangeLabels[range][ar ? 0 : 1]}
              </span>
            </div>
            {(() => {
              const ratio = current.sales > 0 ? Math.min(100, Math.max(0, (current.payments / current.sales) * 100)) : 0;
              const ticks = 36;
              const filled = Math.round((ratio / 100) * ticks);
              return (
                <div className="my-4 flex flex-col items-center">
                  <svg viewBox="0 0 220 124" className="w-full max-w-[240px]" aria-label={formatPercent(ratio, 1)}>
                    {Array.from({ length: ticks }).map((_, idx) => {
                      const angle = Math.PI - (idx / (ticks - 1)) * Math.PI;
                      const r1 = 78;
                      const r2 = 96;
                      const x1 = 110 + Math.cos(angle) * r1;
                      const y1 = 110 - Math.sin(angle) * r1;
                      const x2 = 110 + Math.cos(angle) * r2;
                      const y2 = 110 - Math.sin(angle) * r2;
                      return (
                        <line
                          key={idx}
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          stroke={idx < filled ? 'rgb(var(--ui-primary))' : 'rgb(var(--ui-border-strong))'}
                          strokeWidth="3"
                          strokeLinecap="round"
                          opacity={idx < filled ? 1 : 0.45}
                        />
                      );
                    })}
                    <text
                      x="110"
                      y="102"
                      textAnchor="middle"
                      fill="rgb(var(--ui-text))"
                      style={{ fontSize: '26px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatPercent(ratio, 1)}
                    </text>
                  </svg>
                  <p className="mt-1 text-center text-xs font-medium text-ui-muted">{ar ? 'نسبة المحصل من صافي المبيعات' : 'Collected of net sales'}</p>
                </div>
              );
            })()}
            <div className="grid grid-cols-2 gap-3 border-t border-ui-border pt-4">
              <div>
                <p className="text-xs text-ui-muted">{ar ? 'عدد الطلبات' : 'Orders'}</p>
                <p className="mt-1 text-lg font-bold text-ui-text tabular-nums">{formatNumber(current.orders, 0)}</p>
              </div>
              <div>
                <p className="text-xs text-ui-muted">{ar ? 'صافي المبيعات' : 'Net sales'}</p>
                <p className="mt-1 text-lg font-bold text-ui-text tabular-nums">{money(current.sales)}</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {canViewSales && <section className="grid gap-5 xl:grid-cols-3">{can('branches.manage') && <Card><h2 className="mb-3 font-bold text-ui-text">{ar ? 'الفروع حسب صافي المبيعات' : 'Branches by net sales'}</h2>{branchRows.length ? (() => {
        const maxSales = Math.max(1, ...branchRows.map(([, r]) => r.sales));
        return branchRows.map(([name, row]) => (
          <div key={name} className="mb-3 last:mb-0">
            <div className="mb-1 flex justify-between gap-3 text-sm">
              <span className="font-semibold text-ui-text">{name}</span>
              <span className="text-ui-muted tabular-nums">{formatNumber(row.orders, 0)} · {money(row.sales)}</span>
            </div>
            <WorkspaceMeter value={row.sales} max={maxSales} tone="primary" height="sm" />
          </div>
        ));
      })() : <Empty ar={ar} />}</Card>}
      <Card><h2 className="mb-3 font-black text-ui-text">{ar ? 'أكثر الأصناف مبيعًا' : 'Top selling items'}</h2>{productRows.length ? productRows.map(([name, qty]) => <div key={name} className="mb-3 flex justify-between gap-3 text-sm"><span className="font-semibold text-ui-text">{name}</span><span className="text-ui-muted">{formatNumber(qty, 2)}</span></div>) : <Empty ar={ar} />}</Card>
      <Card><h2 className="mb-3 font-black text-ui-text">{ar ? 'أحدث الطلبات' : 'Recent orders'}</h2>{recent.length ? recent.map((sale) => <div key={sale.id} className="mb-3 flex justify-between gap-3 text-sm"><span className="font-semibold text-ui-text">{sale.invoice_number || '—'}</span><span className="text-ui-muted">{money(netSaleAmount(sale))}</span></div>) : <Empty ar={ar} />}</Card></section>}

      {((canViewKds && !quickRoutes.has(APP_ROUTES.kitchenDisplay)) || (canViewTreasury && !quickRoutes.has(APP_ROUTES.treasury)) || (canViewAudit && !quickRoutes.has(APP_ROUTES.auditLog)) || (canViewSettings && !quickRoutes.has(APP_ROUTES.settings))) && (
        <section data-testid="dashboard-permission-shortcuts" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {canViewKds && !quickRoutes.has(APP_ROUTES.kitchenDisplay) && <Link to={APP_ROUTES.kitchenDisplay} className="ui-accent-card ui-accent-system rounded-2xl border border-ui-border bg-ui-surface p-4 font-extrabold text-ui-text shadow-ui-sm"><ChefHat className="mb-2 h-5 w-5 text-ui-primary" />{ar ? 'شاشة المطبخ' : 'Kitchen display'}</Link>}
          {canViewTreasury && !quickRoutes.has(APP_ROUTES.treasury) && <Link to={APP_ROUTES.treasury} className="ui-accent-card ui-accent-finance rounded-2xl border border-ui-border bg-ui-surface p-4 font-extrabold text-ui-text shadow-ui-sm"><Landmark className="mb-2 h-5 w-5 text-ui-primary" />{ar ? 'الخزينة' : 'Treasury'}</Link>}
          {canViewAudit && !quickRoutes.has(APP_ROUTES.auditLog) && <Link to={APP_ROUTES.auditLog} className="ui-accent-card ui-accent-neutral rounded-2xl border border-ui-border bg-ui-surface p-4 font-extrabold text-ui-text shadow-ui-sm"><HistoryIcon className="mb-2 h-5 w-5 text-ui-primary" />{ar ? 'سجل العمليات' : 'Audit log'}</Link>}
          {canViewSettings && !quickRoutes.has(APP_ROUTES.settings) && <Link to={APP_ROUTES.settings} className="ui-accent-card ui-accent-system rounded-2xl border border-ui-border bg-ui-surface p-4 font-extrabold text-ui-text shadow-ui-sm"><Settings className="mb-2 h-5 w-5 text-ui-primary" />{ar ? 'الإعدادات' : 'Settings'}</Link>}
        </section>
      )}

      {canViewInventory && lowStock.length > 0 && <Card className="ui-accent-alert border-ui-warning/30"><div className="mb-3 flex items-center gap-2 font-black text-ui-warning"><AlertTriangle className="h-5 w-5" />{ar ? 'تنبيه المخزون المنخفض' : 'Low stock alert'}</div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{lowStock.map((row) => <Link key={row.key} to={canAccessPath(APP_ROUTES.stockBalances) ? `${APP_ROUTES.stockBalances}?record=${row.itemId}` : APP_ROUTES.inventory} className="rounded-xl bg-ui-page-alt p-3"><p className="truncate text-sm font-bold text-ui-text">{row.name || '—'}</p><p className="mt-1 text-xs text-ui-warning">{formatNumber(row.quantity, 3)} / {formatNumber(row.threshold, 3)}</p></Link>)}</div></Card>}
    </>}
  </div></div>;
}