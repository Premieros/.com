import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDb = vi.hoisted(() => ({
  getAllStrict: vi.fn(),
  remove: vi.fn(),
  getAll: vi.fn(),
  put: vi.fn(),
}));
vi.mock('@/core/repositories/LocalDatabase', () => ({
  dbGetAllStrict: mockDb.getAllStrict,
  dbDelete: mockDb.remove,
  dbGetAll: mockDb.getAll,
  dbPut: mockDb.put,
}));

import { SalesRepository } from '@/core/repositories/SalesRepository';

const queueRow = {
  id: 'client-1', client_id: 'client-1', invoice_number: 'SAME',
  status: 'pending', retry_count: 0, created_at: '2026-10-13T00:00:00Z',
  payload: { p_branch_id: 'branch-1', p_invoice_number: 'SAME' },
};
const stockMovement = {
  id: 'movement-1', branchId: 'branch-1', productId: 'product-1',
  referenceId: 'client-1', quantityDelta: -2, reason: 'sale', synced: false,
  createdAt: '2026-10-13T00:00:00Z',
};

beforeEach(() => { vi.resetAllMocks(); });

describe('confirmed offline sale cleanup order', () => {
  it('cleans only local movement rows before deleting the confirmed sale', async () => {
    const order: string[] = [];
    mockDb.getAllStrict.mockImplementation(async (name: string) =>
      name === 'sales_queue' ? [queueRow] : [stockMovement]);
    mockDb.remove.mockImplementation(async (name: string, key: string) => {
      order.push(name + ':' + key);
    });
    await SalesRepository.markSaleSynced('client-1', 'SAME');
    expect(order).toEqual([
      'local_stock_movements:movement-1',
      'sales_queue:client-1',
    ]);
  });

  it('does not drop the confirmed-sale row when local cleanup cannot finish', async () => {
    mockDb.getAllStrict.mockImplementation(async (name: string) =>
      name === 'sales_queue' ? [queueRow] : [stockMovement]);
    mockDb.remove.mockRejectedValue(new Error('Local write interrupted'));
    await expect(SalesRepository.markSaleSynced('client-1', 'SAME'))
      .rejects.toThrow('Local write interrupted');
    expect(mockDb.remove).toHaveBeenCalledTimes(1);
    expect(mockDb.remove).toHaveBeenCalledWith('local_stock_movements', 'movement-1');
  });

  it('rejects missing branch scope before removing anything', async () => {
    mockDb.getAllStrict.mockResolvedValue([{ ...queueRow, payload: {} }]);
    await expect(SalesRepository.markSaleSynced('client-1', 'SAME'))
      .rejects.toThrow('OFFLINE_SALE_SCOPE_REQUIRED_FOR_CLEANUP');
    expect(mockDb.remove).not.toHaveBeenCalled();
  });
});
