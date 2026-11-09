import { describe, expect, it, vi } from 'vitest';
import { cacheConfirmedSaleMovements } from '@/features/pos/services/saleConfirmationCache';

const base = {
  items: [
    { product_id: 'burger', quantity: 2 },
    { product_id: 'fries', quantity: 1 },
  ],
  branchId: 'branch-1',
  warehouseId: 'warehouse-1',
  saleId: 'sale-123',
  invoiceNumber: 'INV-2026-1',
};

describe('POS postcommit local stock projection', () => {
  it('keeps the same movement ids across idempotent server replays', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    await cacheConfirmedSaleMovements({ ...base, record });
    await cacheConfirmedSaleMovements({ ...base, record });
    expect(record).toHaveBeenCalledTimes(4);
    expect(record.mock.calls[0][0]).toEqual(expect.objectContaining({
      id: 'confirmed-sale:branch-1:sale-123:0', warehouseId: 'warehouse-1',
      quantityDelta: -2, synced: true,
    }));
    expect(record.mock.calls[2][0].id).toBe(record.mock.calls[0][0].id);
    expect(record.mock.calls[3][0].id).toBe(record.mock.calls[1][0].id);
  });

  it('does not turn a committed sale into a failure after a local cache error', async () => {
    const record = vi.fn()
      .mockRejectedValueOnce(new Error('IndexedDB quota exceeded'))
      .mockResolvedValueOnce(undefined);
    const onFailure = vi.fn();
    await expect(cacheConfirmedSaleMovements({ ...base, record, onFailure }))
      .resolves.toEqual({ failedCount: 1 });
    expect(record).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledWith(1);
  });

  it('ignores lines without product IDs without writing invalid movements', async () => {
    const record = vi.fn();
    const result = await cacheConfirmedSaleMovements({
      ...base, items: [{ product_id: null, quantity: 4 }], record,
    });
    expect(result.failedCount).toBe(0);
    expect(record).not.toHaveBeenCalled();
  });

  it('uses a stable invoice identity when server omits a sale id', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    await cacheConfirmedSaleMovements({ ...base, saleId: null, record });
    expect(record.mock.calls[0][0].id).toBe('confirmed-sale:branch-1:INV-2026-1:0');
  });
});
