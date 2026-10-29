import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessSalePayload } from '@/features/pos/services/payment';

const h = vi.hoisted(() => ({
  settle: vi.fn(), warehouseStock: vi.fn(), branchStock: vi.fn(),
  movement: vi.fn(), enqueue: vi.fn(),
}));
vi.mock('@/api', () => ({ pos: { processSaleIdempotent: h.settle }, supabase: {} }));
vi.mock('@/core/repositories', () => ({
  SettingsRepository: {
    getBranchSettings: async () => ({ allow_negative_stock: false }),
    getGlobalSettings: async () => ({ allow_negative_stock: false }),
  },
  InventoryRepository: {
    getEffectiveAvailableStock: h.branchStock,
    getWarehouseAvailableStock: h.warehouseStock,
    recordLocalMovement: h.movement,
  },
}));
vi.mock('@/core/offline/offlineStorage', () => ({ enqueueOfflineSale: h.enqueue }));
vi.mock('@/core/offline/warehouseBinding', () => ({ saveVerifiedSaleWarehouse: vi.fn() }));
import { processSaleForOrder } from '@/features/pos/services/payment';

const payload = (): ProcessSalePayload => ({
  p_client_operation_key: 'recipe-settlement-test', p_invoice_number: 'TEST',
  p_branch_id: 'branch-asd', p_warehouse_id: 'warehouse-asd', p_shift_id: 'shift-asd',
  p_customer_id: null, p_salesperson_id: null, p_subtotal: 120,
  p_discount_amount: 0, p_discount_type: 'amount', p_tax_amount: 16.8,
  p_bonus_amount: 0, p_total: 136.8, p_paid_amount: 136.8,
  p_payment_method: 'cash', p_status: 'completed',
  p_items: [{ product_id: 'recipe-burger', quantity: 1, unit_name: 'piece', discount_amount: 0, modifier_option_ids: [] }],
  p_order_type: 'takeaway', p_table_id: null, p_order_id: null, p_guest_count: 1,
});
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  h.branchStock.mockResolvedValue(0);
  h.warehouseStock.mockResolvedValue({ status: 'known', quantity: 0 });
});
describe('recipe and kitchen settlement stock authority', () => {
  it.each([null, 'already-sent-kitchen-order'])('lets the server settle %s despite zero finished-product cache', async orderId => {
    h.settle.mockResolvedValue({ data: { success: true, sale_id: 'sale-1' }, error: null });
    const p = { ...payload(), p_order_id: orderId };
    const result = await processSaleForOrder(p);
    expect(result.result?.success).toBe(true);
    expect(h.settle).toHaveBeenCalledWith(p);
    expect(h.branchStock).not.toHaveBeenCalled();
    expect(h.warehouseStock).not.toHaveBeenCalled();
    expect(h.enqueue).not.toHaveBeenCalled();
  });
  it('preserves a real server stock rejection and never queues it offline', async () => {
    h.settle.mockResolvedValue({ data: { success: false, error: 'INSUFFICIENT_STOCK', detail: 'component exhausted' }, error: null });
    const result = await processSaleForOrder(payload());
    expect(result.result?.success).toBe(false);
    expect(result.error).toBe('component exhausted');
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(h.movement).not.toHaveBeenCalled();
  });
  it('still refuses explicit offline capture without warehouse stock', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const result = await processSaleForOrder(payload());
    expect(result.error).toContain('INSUFFICIENT_STOCK');
    expect(h.warehouseStock).toHaveBeenCalledWith('recipe-burger', 'branch-asd', 'warehouse-asd');
    expect(h.settle).not.toHaveBeenCalled();
    expect(h.enqueue).not.toHaveBeenCalled();
  });
  it('does not turn an unknown offline snapshot into a zero or branch-wide fallback', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    h.warehouseStock.mockResolvedValue({ status: 'unknown', reason: 'missing' });
    const result = await processSaleForOrder(payload());
    expect(result.error).toContain('OFFLINE_WAREHOUSE_STOCK_UNVERIFIED');
    expect(h.branchStock).not.toHaveBeenCalled();
    expect(h.settle).not.toHaveBeenCalled();
    expect(h.enqueue).not.toHaveBeenCalled();
  });
});
