import { supabase, pos as posApi } from '@/api';
import type { Branch, Customer, DiningTable, Order, OrderItem, Product } from '@/lib/types';
import type { OrderKitchenSend, PosRealtimeData } from '../types';

export const EMPTY_POS_REALTIME: PosRealtimeData = {
  orders: [],
  tables: [],
  orderItems: [],
  kitchenSends: [],
  watchedOrderIds: [],
};

type PosOrderOperatorLabel = {
  order_id: string;
  cashier_id: string | null;
  operator_name: string | null;
};

type PosOrderAccessResult = {
  success?: boolean;
  error?: string;
  order_id?: string;
  branch_id?: string;
  cashier_id?: string | null;
  managed_other?: boolean;
};

export type MyActiveTableOrderResolution = {
  success?: boolean;
  error?: string;
  resumable?: boolean;
  order_id?: string;
};

export async function fetchActiveOrders(branchId: string, onTables?: (tables: DiningTable[]) => void): Promise<PosRealtimeData> {
  const [tRes, oRes, operatorRes] = await Promise.all([
    Promise.resolve(supabase.from('dining_tables').select('*').eq('branch_id', branchId).eq('is_active', true).order('name'))
      .then(result => {
        if (!result.error) onTables?.((result.data as DiningTable[]) || []);
        return result;
      }),
    supabase.from('orders')
      .select('*')
      .eq('branch_id', branchId)
      .in('status', ['open', 'held'])
      .order('created_at', { ascending: false }),
    // Do not broaden public.users RLS just to show occupied-table ownership.
    // The RPC exposes only a branch-scoped display label for active POS orders.
    supabase.rpc('get_pos_order_operator_labels', { p_branch_id: branchId }),
  ]);
  // Never turn a timeout or permission failure into an apparently empty floor
  // plan: usePosRealtime keeps its last good branch-scoped snapshot on errors.
  // In particular, a failed order read must not erase open checks or table labels.
  if (tRes.error) throw tRes.error;
  if (oRes.error) throw oRes.error;
  if (operatorRes.error) throw operatorRes.error;

  const tables = (tRes.data as DiningTable[]) || [];
  // Reuse active tables for linked orders rather than doing a joined table
  // lookup for every order. Inactive tables with open checks are recovered in a
  // single branch-scoped fallback; they never enter the active floor-plan list.
  const tableById = new Map(tables.map((table) => [table.id, table]));
  const rawOrders = (oRes.data as Order[] | null) || [];
  const missingIds = [...new Set(rawOrders.map(order => order.table_id)
    .filter((id): id is string => !!id && !tableById.has(id)))];
  if (missingIds.length) {
    const missing = await supabase.from('dining_tables').select('*')
      .eq('branch_id', branchId).in('id', missingIds);
    if (missing.error) throw missing.error;
    for (const table of (missing.data as DiningTable[] | null) || []) {
      tableById.set(table.id, table);
    }
  }
  const operatorLabels = (operatorRes.data as PosOrderOperatorLabel[] | null) || [];
  const operatorByOrder = new Map(operatorLabels.map((row) => [row.order_id, row]));
  let orders = rawOrders.map((order): Order => {
    const label = operatorByOrder.get(order.id);
    return {
      ...order,
      table: order.table_id ? tableById.get(order.table_id) : undefined,
      ...(label?.cashier_id ? {
        cashier: { id: label.cashier_id, full_name: label.operator_name, email: null },
      } : {}),
    };
  });
  const watchedOrderIds = orders.map((o) => o.id);
  let orderItems: OrderItem[] = [];
  let kitchenSends: OrderKitchenSend[] = [];
  if (watchedOrderIds.length > 0) {
    const ids = watchedOrderIds;
    const [iRes, kRes] = await Promise.all([
      supabase.from('order_items').select('*').in('order_id', ids),
      supabase.from('order_kitchen_sends').select('*').in('order_id', ids),
    ]);
    if (iRes.error) throw iRes.error;
    if (kRes.error) throw kRes.error;
    orderItems = (iRes.data as OrderItem[]) || [];
    kitchenSends = (kRes.data as OrderKitchenSend[]) || [];

    const effectiveOrderIds = new Set(
      orderItems
        .filter((item) => Number(item.quantity || 0) > 0)
        .map((item) => item.order_id),
    );
    orders = orders.filter((order) => effectiveOrderIds.has(order.id));
    orderItems = orderItems.filter((item) => effectiveOrderIds.has(item.order_id));
    kitchenSends = kitchenSends.filter((send) => effectiveOrderIds.has(send.order_id));
  }
  return { orders, tables, orderItems, kitchenSends, watchedOrderIds };
}

export async function fetchOrderForWorkspace(orderId: string): Promise<{ order: Order | null; items: OrderItem[]; products: Product[]; table: DiningTable | null }> {
  // Opening an order is a server-authorized operation. Branch visibility alone
  // is intentionally not enough because the floor plan may show other users'
  // occupied tables without granting access to their operational workspace.
  const { data: accessData, error: accessError } = await supabase.rpc('authorize_pos_order_access', {
    p_order_id: orderId,
  });
  if (accessError) throw accessError;
  const access = (accessData as PosOrderAccessResult | null) || null;
  if (!access?.success) {
    throw new Error(access?.error || 'ORDER_OPERATOR_REQUIRED');
  }

  if (!access.branch_id) throw new Error('BRANCH_MISMATCH');

  const { data, error } = await supabase.from('orders')
    .select(`
      *,
      items:order_items!order_items_order_id_fkey(*, product:products!order_items_product_id_fkey(*)),
      table:dining_tables!orders_table_id_fkey(*)
    `)
    .eq('id', orderId)
    .eq('branch_id', access.branch_id)
    .eq('items.product.branch_id', access.branch_id)
    .eq('table.branch_id', access.branch_id)
    .maybeSingle();
  if (error) throw error;
  const row = data as (Order & {
    items: Array<OrderItem & { product: Product | null }>;
    table: DiningTable | null;
  }) | null;
  if (!row) return { order: null, items: [], products: [], table: null };
  // An order can close between authorization and the workspace read.
  if (row.status === 'completed') throw new Error('ORDER_CLOSED');
  if (row.status === 'cancelled') throw new Error('ORDER_CANCELLED');

  const { items: rows, table, ...order } = row;
  const products = new Map<string, Product>();
  const items = rows.map(({ product, ...item }) => {
    if (product) products.set(product.id, product);
    return item;
  });
  return { order, items, products: [...products.values()], table };
}

export async function resolveMyActiveTableOrder(tableId: string): Promise<MyActiveTableOrderResolution> {
  const { data, error } = await supabase.rpc('resolve_my_active_table_order', { p_table_id: tableId });
  if (error) return { success: false, error: error.message, resumable: false };
  return (data as MyActiveTableOrderResolution | null) || { success: false, error: 'TABLE_BUSY', resumable: false };
}

export async function fetchBranches(): Promise<Branch[]> {
  const { data } = await supabase.from('branches').select('*').eq('is_active', true).order('name');
  return (data as Branch[]) || [];
}

export async function fetchCustomers(branchId: string): Promise<Customer[]> {
  let q = supabase.from('customers').select('*');
  if (branchId) q = q.eq('branch_id', branchId);
  const { data } = await q.order('name');
  return (data as Customer[]) || [];
}

export async function fetchActiveShift(branchId: string): Promise<{ id: string; expected: number; opened_at: string; opening_amount: number } | null> {
  const { data } = await posApi.getActiveShift({ p_branch_id: branchId });
  const res = data as unknown as { success?: boolean; open?: boolean; shift?: { id: string; expected: number; opened_at: string; opening_amount: number } } | null;
  return res?.open ? (res.shift ?? null) : null;
}
