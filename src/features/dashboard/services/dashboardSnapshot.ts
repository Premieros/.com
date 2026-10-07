import { reporting } from '@/api';
import type { PaymentMethodAggregate } from '@/features/reporting/numericIntegrity';

export type DashboardSummary = {
  orders: number;
  sales: number;
  payments: number;
  returns: number;
  discounts: number;
};

export type DashboardSeriesRow = { bucket: string; sales: number };
export type DashboardOrderTypeRow = { key: string; count: number };
export type DashboardBranchRow = { branchId: string; orders: number; sales: number };
export type DashboardProductRow = { name: string; quantity: number };
export type DashboardRecentSale = {
  id: string;
  invoice_number: string | null;
  branch_id: string | null;
  created_at: string;
  order_type: string | null;
  total: number | null;
  refunded_amount: number | null;
};

export type DashboardSalesSnapshot = {
  current: DashboardSummary;
  previous: DashboardSummary;
  orderTypes: DashboardOrderTypeRow[];
  branches: DashboardBranchRow[];
  recentSales: DashboardRecentSale[];
  topProducts: DashboardProductRow[];
  currentSeries: DashboardSeriesRow[];
  previousSeries: DashboardSeriesRow[];
  paymentMethods: PaymentMethodAggregate[];
  previousPaymentMethods: PaymentMethodAggregate[];
};

type RawSnapshot = {
  current?: Record<string, unknown>;
  previous?: Record<string, unknown>;
  order_types?: Array<Record<string, unknown>>;
  branches?: Array<Record<string, unknown>>;
  recent_sales?: Array<Record<string, unknown>>;
  top_products?: Array<Record<string, unknown>>;
  current_series?: Array<Record<string, unknown>>;
  previous_series?: Array<Record<string, unknown>>;
  payment_methods?: Array<Record<string, unknown>>;
  previous_payment_methods?: Array<Record<string, unknown>>;
};

const n = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function summary(row: Record<string, unknown> | undefined): DashboardSummary {
  return {
    orders: n(row?.orders),
    sales: n(row?.sales),
    payments: n(row?.payments),
    returns: n(row?.returns),
    discounts: n(row?.discounts),
  };
}

function paymentRows(rows: Array<Record<string, unknown>> | undefined): PaymentMethodAggregate[] {
  return (rows || []).map((row) => ({
    branchId: String(row.branch_id || ''),
    method: String(row.method || 'other').toLowerCase(),
    total: n(row.total),
    count: n(row.count),
  }));
}

function parseSnapshot(raw: RawSnapshot): DashboardSalesSnapshot {
  return {
    current: summary(raw.current),
    previous: summary(raw.previous),
    orderTypes: (raw.order_types || []).map((row) => ({ key: String(row.key || 'other'), count: n(row.count) })),
    branches: (raw.branches || []).map((row) => ({ branchId: String(row.branch_id || ''), orders: n(row.orders), sales: n(row.sales) })),
    recentSales: (raw.recent_sales || []).map((row) => ({
      id: String(row.id || ''),
      invoice_number: row.invoice_number == null ? null : String(row.invoice_number),
      branch_id: row.branch_id == null ? null : String(row.branch_id),
      created_at: String(row.created_at || ''),
      order_type: row.order_type == null ? null : String(row.order_type),
      total: row.total == null ? null : n(row.total),
      refunded_amount: row.refunded_amount == null ? null : n(row.refunded_amount),
    })),
    topProducts: (raw.top_products || []).map((row) => ({ name: String(row.name || 'Unknown'), quantity: n(row.quantity) })),
    currentSeries: (raw.current_series || []).map((row) => ({ bucket: String(row.bucket || ''), sales: n(row.sales) })),
    previousSeries: (raw.previous_series || []).map((row) => ({ bucket: String(row.bucket || ''), sales: n(row.sales) })),
    paymentMethods: paymentRows(raw.payment_methods),
    previousPaymentMethods: paymentRows(raw.previous_payment_methods),
  };
}

async function loadSingle(args: {
  branchId: string | null;
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
  granularity: 'hour' | 'day' | 'month';
  timezone?: string;
}): Promise<DashboardSalesSnapshot | null> {
  const result = await reporting.getDashboardSalesSnapshot({
    p_branch_id: args.branchId,
    p_current_from: args.currentFrom,
    p_current_to: args.currentTo,
    p_previous_from: args.previousFrom,
    p_previous_to: args.previousTo,
    p_granularity: args.granularity,
    p_timezone: args.timezone || 'Africa/Cairo',
  });

  if (result.error || !result.data || typeof result.data !== 'object') return null;
  return parseSnapshot(result.data as RawSnapshot);
}

function sumSummary(rows: DashboardSummary[]): DashboardSummary {
  return rows.reduce<DashboardSummary>((acc, row) => ({
    orders: acc.orders + row.orders,
    sales: acc.sales + row.sales,
    payments: acc.payments + row.payments,
    returns: acc.returns + row.returns,
    discounts: acc.discounts + row.discounts,
  }), { orders: 0, sales: 0, payments: 0, returns: 0, discounts: 0 });
}

function mergeByKey<T>(rows: T[], keyFor: (row: T) => string, merge: (left: T, right: T) => T): T[] {
  const map = new Map<string, T>();
  rows.forEach((row) => {
    const key = keyFor(row);
    const current = map.get(key);
    map.set(key, current ? merge(current, row) : row);
  });
  return [...map.values()];
}

function mergeSnapshots(snapshots: DashboardSalesSnapshot[]): DashboardSalesSnapshot {
  return {
    current: sumSummary(snapshots.map((snapshot) => snapshot.current)),
    previous: sumSummary(snapshots.map((snapshot) => snapshot.previous)),
    orderTypes: mergeByKey(
      snapshots.flatMap((snapshot) => snapshot.orderTypes),
      (row) => row.key,
      (left, right) => ({ key: left.key, count: left.count + right.count }),
    ).sort((a, b) => b.count - a.count),
    branches: mergeByKey(
      snapshots.flatMap((snapshot) => snapshot.branches),
      (row) => row.branchId,
      (left, right) => ({ branchId: left.branchId, orders: left.orders + right.orders, sales: left.sales + right.sales }),
    ).sort((a, b) => b.sales - a.sales),
    recentSales: snapshots
      .flatMap((snapshot) => snapshot.recentSales)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, 10),
    topProducts: mergeByKey(
      snapshots.flatMap((snapshot) => snapshot.topProducts),
      (row) => row.name,
      (left, right) => ({ name: left.name, quantity: left.quantity + right.quantity }),
    ).sort((a, b) => b.quantity - a.quantity).slice(0, 10),
    currentSeries: mergeByKey(
      snapshots.flatMap((snapshot) => snapshot.currentSeries),
      (row) => row.bucket,
      (left, right) => ({ bucket: left.bucket, sales: left.sales + right.sales }),
    ).sort((a, b) => a.bucket.localeCompare(b.bucket)),
    previousSeries: mergeByKey(
      snapshots.flatMap((snapshot) => snapshot.previousSeries),
      (row) => row.bucket,
      (left, right) => ({ bucket: left.bucket, sales: left.sales + right.sales }),
    ).sort((a, b) => a.bucket.localeCompare(b.bucket)),
    paymentMethods: mergeByKey(
      snapshots.flatMap((snapshot) => snapshot.paymentMethods),
      (row) => `${row.branchId}:${row.method}`,
      (left, right) => ({ ...left, total: left.total + right.total, count: left.count + right.count }),
    ),
    previousPaymentMethods: mergeByKey(
      snapshots.flatMap((snapshot) => snapshot.previousPaymentMethods),
      (row) => `${row.branchId}:${row.method}`,
      (left, right) => ({ ...left, total: left.total + right.total, count: left.count + right.count }),
    ),
  };
}

export async function loadDashboardSalesSnapshot(args: {
  branchId: string | null;
  branchIds?: string[];
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
  granularity: 'hour' | 'day' | 'month';
  timezone?: string;
}): Promise<DashboardSalesSnapshot | null> {
  const scopedBranchIds = [...new Set((args.branchIds || []).filter(Boolean))];

  if (scopedBranchIds.length <= 1) {
    return loadSingle({
      ...args,
      branchId: scopedBranchIds[0] || args.branchId,
    });
  }

  const snapshots = await Promise.all(
    scopedBranchIds.map((branchId) => loadSingle({ ...args, branchId })),
  );
  if (snapshots.some((snapshot) => !snapshot)) return null;
  return mergeSnapshots(snapshots as DashboardSalesSnapshot[]);
}
