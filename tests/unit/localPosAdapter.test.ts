import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isLocalEngineAvailable,
  localFetchActiveOrders,
  localProcessSaleForOrder,
  localSendOrderToKitchen,
} from '@/features/pos/adapters/localPosAdapter';
import type { LocalEngineAPI } from '@/types/electron.d';

describe('Local POS Data Adapter (Phase C)', () => {
  const originalElectronAPI = window.electronAPI;

  afterEach(() => {
    window.electronAPI = originalElectronAPI;
    vi.restoreAllMocks();
  });

  it('correctly reports engine availability based on window.electronAPI', () => {
    delete (window as { electronAPI?: unknown }).electronAPI;
    expect(isLocalEngineAvailable()).toBe(false);

    window.electronAPI = { isElectron: true, localEngine: {} as unknown as LocalEngineAPI } as unknown as typeof window.electronAPI;
    expect(isLocalEngineAvailable()).toBe(true);

    window.electronAPI = { isElectron: false } as unknown as typeof window.electronAPI;
    expect(isLocalEngineAvailable()).toBe(false);
  });

  it('localFetchActiveOrders formats SQLite rows into PosRealtimeData', async () => {
    const mockGetPosWorkspace = vi.fn().mockResolvedValue({
      success: true,
      tables: [{ id: 't1', branch_id: 'b1', table_number: 'T-01', section: 'main', status: 'available' }],
      orders: [{ id: 'o1', order_number: 'ORD-101', branch_id: 'b1', table_id: 't1', status: 'open', total_amount: 150 }],
      orderItems: [{ id: 'oi1', order_id: 'o1', product_id: 'p1', quantity: 2, unit_price: 75, total_price: 150 }],
      kitchenSends: [{ id: 'ks1', order_id: 'o1', order_item_id: 'oi1', sent_quantity: 2, sent_at: '2026-11-10T00:00:00Z' }],
    });

    window.electronAPI = {
      isElectron: true,
      getPrinters: vi.fn(),
      printSilent: vi.fn(),
      kickDrawer: vi.fn(),
      getSystemInfo: vi.fn(),
      localEngine: {
        getPosWorkspace: mockGetPosWorkspace,
      } as unknown as LocalEngineAPI,
    };

    const data = await localFetchActiveOrders('b1');
    expect(mockGetPosWorkspace).toHaveBeenCalledTimes(1);
    expect(data.tables).toHaveLength(1);
    expect(data.tables[0].name).toBe('T-01');
    expect(data.orders).toHaveLength(1);
    expect(data.orders[0].total).toBe(150);
    expect(data.orderItems).toHaveLength(1);
    expect(data.kitchenSends).toHaveLength(1);
    expect(data.watchedOrderIds).toEqual(['o1']);
  });

  it('localProcessSaleForOrder settles order through SQLite and returns sale confirmation', async () => {
    const mockSettleOrder = vi.fn().mockResolvedValue({
      success: true,
      saleId: 'sale-uuid-123',
      invoiceNumber: 'INV-9999',
      orderId: 'o1',
      totalAmount: 150,
      calculatedCost: 45,
    });

    window.electronAPI = {
      isElectron: true,
      getPrinters: vi.fn(),
      printSilent: vi.fn(),
      kickDrawer: vi.fn(),
      getSystemInfo: vi.fn(),
      localEngine: {
        settleOrder: mockSettleOrder,
      } as unknown as LocalEngineAPI,
    };

    const res = await localProcessSaleForOrder({
      p_invoice_number: 'INV-9999',
      p_branch_id: 'b1',
      p_shift_id: 'shift-1',
      p_warehouse_id: 'wh-1',
      p_customer_id: null,
      p_salesperson_id: 'cashier-1',
      p_subtotal: 150,
      p_discount_amount: 0,
      p_discount_type: 'amount',
      p_tax_amount: 0,
      p_bonus_amount: 0,
      p_total: 150,
      p_paid_amount: 150,
      p_payment_method: 'cash',
      p_status: 'completed',
      p_items: [],
      p_order_type: 'dine_in',
      p_table_id: 't1',
      p_order_id: 'o1',
      p_guest_count: 2,
    });

    expect(res.error).toBeNull();
    expect(res.result?.success).toBe(true);
    expect(res.result?.sale_id).toBe('sale-uuid-123');
    expect(res.result?.invoice_number).toBe('INV-9999');
    expect(mockSettleOrder).toHaveBeenCalledWith({
      orderId: 'o1',
      warehouseId: 'wh-1',
      paymentMethod: 'cash',
      amount: 150,
      idempotencyKey: expect.any(String),
    });
  });

  it('localProcessSaleForOrder fails closed upon error with NO fallback', async () => {
    const mockSettleOrder = vi.fn().mockResolvedValue({
      success: false,
      error: 'ORDER_NOT_FULLY_SENT: Cannot settle order with unsent items',
    });

    window.electronAPI = {
      isElectron: true,
      getPrinters: vi.fn(),
      printSilent: vi.fn(),
      kickDrawer: vi.fn(),
      getSystemInfo: vi.fn(),
      localEngine: {
        settleOrder: mockSettleOrder,
      } as unknown as LocalEngineAPI,
    };

    const res = await localProcessSaleForOrder({
      p_invoice_number: 'INV-9999',
      p_branch_id: 'b1',
      p_shift_id: 'shift-1',
      p_warehouse_id: 'wh-1',
      p_customer_id: null,
      p_salesperson_id: 'cashier-1',
      p_subtotal: 150,
      p_discount_amount: 0,
      p_discount_type: 'amount',
      p_tax_amount: 0,
      p_bonus_amount: 0,
      p_total: 150,
      p_paid_amount: 150,
      p_payment_method: 'cash',
      p_status: 'completed',
      p_items: [],
      p_order_type: 'dine_in',
      p_table_id: 't1',
      p_order_id: 'o1',
      p_guest_count: 2,
    });

    expect(res.result).toBeNull();
    expect(res.error).toContain('ORDER_NOT_FULLY_SENT');
  });

  it('localSendOrderToKitchen dispatches to local engine', async () => {
    const mockSendToKitchen = vi.fn().mockResolvedValue({
      success: true,
      dispatchedCount: 3,
    });

    window.electronAPI = {
      isElectron: true,
      getPrinters: vi.fn(),
      printSilent: vi.fn(),
      kickDrawer: vi.fn(),
      getSystemInfo: vi.fn(),
      localEngine: {
        sendToKitchen: mockSendToKitchen,
      } as unknown as LocalEngineAPI,
    };

    const res = await localSendOrderToKitchen('order-uuid-1');
    expect(res.success).toBe(true);
    expect(res.dispatchedCount).toBe(3);
    expect(mockSendToKitchen).toHaveBeenCalledWith({ orderId: 'order-uuid-1' });
  });
});
