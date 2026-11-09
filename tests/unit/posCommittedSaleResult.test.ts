import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessSalePayload } from '@/features/pos/services/payment';

const mocks = vi.hoisted(() => ({
  processSaleIdempotent: vi.fn(),
  processSaleManualPayment: vi.fn(),
  recordLocalMovement: vi.fn(),
  getBranchSettings: vi.fn(),
  getGlobalSettings: vi.fn(),
  enqueueOfflineSale: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('@/api', () => ({
  pos: {
    processSaleIdempotent: mocks.processSaleIdempotent,
    processSaleManualPayment: mocks.processSaleManualPayment,
  },
  supabase: { auth: { getSession: mocks.getSession } },
}));
vi.mock('@/core/repositories', () => ({
  SettingsRepository: {
    getBranchSettings: mocks.getBranchSettings,
    getGlobalSettings: mocks.getGlobalSettings,
  },
  InventoryRepository: {
    recordLocalMovement: mocks.recordLocalMovement,
  },
}));
vi.mock('@/core/offline/offlineStorage', () => ({ enqueueOfflineSale: mocks.enqueueOfflineSale }));
vi.mock('@/core/offline/warehouseBinding', () => ({ saveVerifiedSaleWarehouse: vi.fn() }));

import {
  armManualPaymentApproval,
  clearArmedManualPaymentApproval,
  clearArmedSplitTender,
  processSaleForOrder,
} from '@/features/pos/services/payment';

const payload = {
  p_client_operation_key: 'operation-a',
  p_invoice_number: 'INV-123',
  p_branch_id: 'branch-1',
  p_shift_id: 'shift-1',
  p_warehouse_id: 'warehouse-1',
  p_customer_id: null,
  p_salesperson_id: null,
  p_subtotal: 100,
  p_discount_amount: 0,
  p_discount_type: 'amount',
  p_tax_amount: 0,
  p_bonus_amount: 0,
  p_total: 100,
  p_paid_amount: 100,
  p_payment_method: 'cash',
  p_status: 'completed',
  p_items: [{ product_id: 'product-1', quantity: 2 }],
  p_order_type: 'dine_in',
  p_table_id: null,
  p_order_id: 'order-1',
  p_guest_count: 1,
} as ProcessSalePayload;

describe('POS confirmed and queued sales survive local projection errors', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.clearAllMocks();
    clearArmedSplitTender();
    clearArmedManualPaymentApproval();
    mocks.getBranchSettings.mockResolvedValue({ allow_negative_stock: true });
    mocks.getGlobalSettings.mockResolvedValue({ allow_negative_stock: true });
    mocks.recordLocalMovement.mockRejectedValue(new Error('IndexedDB unavailable'));
    mocks.enqueueOfflineSale.mockResolvedValue(undefined);
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'cashier-1' } } }, error: null });
  });

  it('returns a real online RPC confirmation for a normal cash sale', async () => {
    mocks.processSaleIdempotent.mockResolvedValue({
      data: { success: true, sale_id: 'sale-1', invoice_number: 'INV-123' },
      error: null,
    });
    const { result, error } = await processSaleForOrder(payload);
    expect(error).toBeNull();
    expect(result?.success).toBe(true);
    expect(mocks.processSaleIdempotent).toHaveBeenCalledTimes(1);
    expect(mocks.recordLocalMovement).toHaveBeenCalledTimes(1);
  });

  it('preserves server success after a manager-approved manual transfer', async () => {
    armManualPaymentApproval({
      requestId: 'approved-1', method: 'bank_transfer',
      amount: 100, reference: 'REF-1',
    });
    mocks.processSaleManualPayment.mockResolvedValue({
      data: { success: true, sale_id: 'sale-2' }, error: null,
    });
    const { result, error } = await processSaleForOrder({
      ...payload,
      p_payment_method: 'bank_transfer',
    });
    expect(error).toBeNull();
    expect(result?.success).toBe(true);
    expect(mocks.processSaleManualPayment).toHaveBeenCalledTimes(1);
    expect(mocks.recordLocalMovement).toHaveBeenCalledTimes(1);
  });

  it('keeps an offline sale pending after its outbox commit even when stock cache fails', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const { result, error } = await processSaleForOrder(payload);
    expect(error).toBeNull();
    expect(result?.success).toBe(true);
    expect(result?.offline).toBe(true);
    expect(result?.pending_sync).toBe(true);
    expect(mocks.enqueueOfflineSale).toHaveBeenCalledTimes(1);
    expect(mocks.recordLocalMovement).toHaveBeenCalledTimes(1);
    expect(mocks.processSaleIdempotent).not.toHaveBeenCalled();
  });

  it('keeps an offline capture when both stock cache and its warning fail', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {
      throw new Error('console unavailable');
    });
    try {
      const { result, error } = await processSaleForOrder(payload);
      expect(error).toBeNull();
      expect(result?.pending_sync).toBe(true);
      expect(mocks.enqueueOfflineSale).toHaveBeenCalledTimes(1);
    } finally {
      warning.mockRestore();
    }
  });

  it('does not generate a local confirmation when the server rejects the sale', async () => {
    mocks.processSaleIdempotent.mockResolvedValue({
      data: { success: false, error: 'ORDER_NOT_FULLY_SENT' },
      error: null,
    });
    const { result, error } = await processSaleForOrder(payload);
    expect(result?.success).toBe(false);
    expect(error).toContain('ORDER_NOT_FULLY_SENT');
    expect(mocks.recordLocalMovement).not.toHaveBeenCalled();
  });
});
