/**
 * Local POS Data Adapter
 *
 * Bridges the Premier OS POS UI directly with the local SQLite engine
 * when running inside the Windows Electron host without internet.
 *
 * Safety & Architecture:
 * - Single source of truth: local SQLite database.
 * - Fail closed: NEVER falls back silently to Supabase upon local error.
 * - Preserves standard Web flow when running outside Electron.
 */

import type { DiningTable, Order, OrderItem } from '@/lib/types';
import type { PosRealtimeData, OrderKitchenSend } from '../types';
import type { ProcessSalePayload, ProcessSaleResult } from '../services/payment';

/**
 * Returns true if running inside Windows Electron with local SQLite engine available.
 */
export function isLocalEngineAvailable(): boolean {
  return typeof window !== 'undefined'
    && Boolean(window.electronAPI?.isElectron)
    && Boolean(window.electronAPI?.localEngine);
}

/**
 * Authoritative local POS workspace data fetch (Tables, Orders, Items, KDS sends).
 */
export async function localFetchActiveOrders(branchId: string): Promise<PosRealtimeData> {
  if (!isLocalEngineAvailable() || !window.electronAPI?.localEngine) {
    throw new Error('LOCAL_ENGINE_UNAVAILABLE');
  }

  const res = await window.electronAPI.localEngine.getPosWorkspace();
  if (!res.success) {
    throw new Error(res.error || 'FAILED_TO_FETCH_LOCAL_WORKSPACE');
  }

  const rawTables = res.tables || [];
  const rawOrders = res.orders || [];
  const rawItems = res.orderItems || [];
  const rawSends = res.kitchenSends || [];

  const nowIso = new Date().toISOString();

  const tables: DiningTable[] = rawTables.map((t: Record<string, unknown>) => ({
    id: String(t.id || ''),
    branch_id: String(t.branch_id || branchId),
    area_id: null,
    name: String(t.table_number || ''),
    capacity: 4,
    status: t.status === 'occupied' ? 'occupied' : 'vacant',
    shape: 'rectangle',
    layout: { x: 0, y: 0, w: 1, h: 1 },
    is_active: true,
    created_at: nowIso,
    updated_at: nowIso,
  }));

  const orders: Order[] = rawOrders.map((o: Record<string, unknown>) => ({
    id: String(o.id || ''),
    order_number: String(o.order_number || ''),
    branch_id: String(o.branch_id || branchId),
    order_type: o.table_id ? 'dine_in' : 'takeaway',
    status: (o.status as Order['status']) || 'open',
    table_id: o.table_id ? String(o.table_id) : null,
    customer_id: null,
    cashier_id: o.created_by ? String(o.created_by) : null,
    guest_count: Number(o.guest_count || 1),
    notes: null,
    subtotal: Number(o.subtotal || 0),
    discount_amount: Number(o.discount_amount || 0),
    discount_type: 'amount',
    tax_amount: Number(o.tax_amount || 0),
    total: Number(o.total_amount || 0),
    created_at: String(o.created_at || nowIso),
    updated_at: String(o.updated_at || nowIso),
    completed_at: o.status === 'completed' ? String(o.updated_at || nowIso) : null,
  }));

  const orderItems: OrderItem[] = rawItems.map((i: Record<string, unknown>) => ({
    id: String(i.id || ''),
    order_id: String(i.order_id || ''),
    product_id: String(i.product_id || ''),
    unit_name: 'piece',
    quantity: Number(i.quantity || 0),
    unit_price: Number(i.unit_price || 0),
    discount_amount: 0,
    bonus_quantity: 0,
    total: Number(i.total_price || 0),
    notes: i.notes ? String(i.notes) : null,
    created_at: String(i.created_at || nowIso),
  }));

  const kitchenSends: OrderKitchenSend[] = rawSends.map((s: Record<string, unknown>) => ({
    id: String(s.id || ''),
    branch_id: branchId,
    order_id: String(s.order_id || ''),
    order_item_id: String(s.order_item_id || ''),
    sent_at: String(s.sent_at || nowIso),
    sent_by: s.sent_by ? String(s.sent_by) : null,
    sent_quantity: Number(s.sent_quantity || 0),
  }));

  return {
    orders,
    tables,
    orderItems,
    kitchenSends,
    watchedOrderIds: orders.map((o) => o.id),
  };
}

/**
 * Fetch authoritative shift status from local SQLite.
 */
export async function localFetchActiveShift(branchId?: string): Promise<{ id: string; expected: number; opened_at: string; opening_amount: number } | null> {
  if (!isLocalEngineAvailable() || !window.electronAPI?.localEngine) {
    return null;
  }

  const res = await window.electronAPI.localEngine.getShiftSummary();
  if (!res.success) {
    return null;
  }

  return {
    id: res.shiftId || branchId || '',
    expected: res.expectedCashInDrawer || 0,
    opened_at: res.openedAt || new Date().toISOString(),
    opening_amount: res.openingFloat || 0,
  };
}

/**
 * Settle order locally using ACID SQLite engine.
 */
export async function localProcessSaleForOrder(p: ProcessSalePayload): Promise<{ result: ProcessSaleResult | null; error: string | null }> {
  if (!isLocalEngineAvailable() || !window.electronAPI?.localEngine) {
    return { result: null, error: 'LOCAL_ENGINE_UNAVAILABLE' };
  }

  if (!p.p_order_id) {
    return { result: null, error: 'ORDER_ID_REQUIRED_FOR_SETTLEMENT' };
  }
  if (!p.p_warehouse_id) {
    return { result: null, error: 'WAREHOUSE_REQUIRED_FOR_SETTLEMENT' };
  }

  const idempotencyKey = p.p_client_operation_key
    || `local_${p.p_order_id}_${Date.now()}`;

  try {
    const res = await window.electronAPI.localEngine.settleOrder({
      orderId: p.p_order_id,
      warehouseId: p.p_warehouse_id,
      paymentMethod: p.p_payment_method || 'cash',
      amount: p.p_paid_amount || p.p_total,
      idempotencyKey,
    });

    if (!res.success) {
      return {
        result: null,
        error: res.error || 'LOCAL_SETTLEMENT_FAILED',
      };
    }

    return {
      result: {
        success: true,
        offline: true,
        pending_sync: true,
        sale_id: res.saleId,
        invoice_number: res.invoiceNumber,
        order_id: res.orderId,
        client_operation_key: idempotencyKey,
      },
      error: null,
    };
  } catch (err) {
    return {
      result: null,
      error: err instanceof Error ? err.message : 'LOCAL_SETTLEMENT_EXCEPTION',
    };
  }
}

/**
 * Dispatch items to local kitchen KDS.
 */
export async function localSendOrderToKitchen(orderId: string): Promise<{ success: boolean; dispatchedCount?: number; error?: string }> {
  if (!isLocalEngineAvailable() || !window.electronAPI?.localEngine) {
    throw new Error('LOCAL_ENGINE_UNAVAILABLE');
  }

  const res = await window.electronAPI.localEngine.sendToKitchen({ orderId });
  if (!res.success) {
    throw new Error(res.error || 'LOCAL_KITCHEN_SEND_FAILED');
  }

  return {
    success: true,
    dispatchedCount: res.dispatchedCount,
  };
}

/**
 * Create a new order in local SQLite.
 */
export async function localCreateOrder(params: { tableId?: string | null; guestCount?: number }): Promise<{ success: boolean; order?: Record<string, unknown>; error?: string }> {
  if (!isLocalEngineAvailable() || !window.electronAPI?.localEngine) {
    throw new Error('LOCAL_ENGINE_UNAVAILABLE');
  }

  const res = await window.electronAPI.localEngine.createOrder(params);
  if (!res.success) {
    throw new Error(res.error || 'LOCAL_ORDER_CREATION_FAILED');
  }

  return res;
}

/**
 * Add item to local order in SQLite.
 */
export async function localAddOrderItem(params: {
  orderId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  stationCode?: string;
  notes?: string | null;
}): Promise<{ success: boolean; item?: Record<string, unknown>; order?: Record<string, unknown>; error?: string }> {
  if (!isLocalEngineAvailable() || !window.electronAPI?.localEngine) {
    throw new Error('LOCAL_ENGINE_UNAVAILABLE');
  }

  const res = await window.electronAPI.localEngine.addOrderItem(params);
  if (!res.success) {
    throw new Error(res.error || 'LOCAL_ADD_ITEM_FAILED');
  }

  return res;
}
