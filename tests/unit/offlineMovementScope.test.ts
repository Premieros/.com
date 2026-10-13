import { describe, expect, it } from 'vitest';
import { getUnrecordedQueuedSaleDeductions, saleMovementIdsForCleanup } from '@/core/repositories/stockProjection';
import type { OfflineSaleQueueItem } from '@/core/offline/offlineStorage';
import type { LocalStockMovement } from '@/core/repositories/types';

const sale = (id: string, branch: string, invoice: string): OfflineSaleQueueItem => ({
  id, client_id: id, invoice_number: invoice,
  created_at: '2026-10-13T00:00:00Z', retry_count: 0, status: 'pending',
  created_by_user_id: 'cashier-1',
  payload: { p_branch_id: branch, p_invoice_number: invoice,
    p_items: [{ product_id: 'product-1', quantity: 2 }] },
});

const movement = (id: string, reference: string, branch: string,
  overrides: Partial<LocalStockMovement> = {}): LocalStockMovement => ({
  id, referenceId: reference, branchId: branch, productId: 'product-1',
  quantityDelta: -2, reason: 'sale', synced: false,
  createdAt: '2026-10-13T00:00:00Z', ...overrides,
});

describe('offline sale movement scope', () => {
  it('counts one legacy movement only once when two queued sales share a number', () => {
    const queue = [sale('client-1', 'branch-1', 'SAME'), sale('client-2', 'branch-1', 'SAME')];
    expect(getUnrecordedQueuedSaleDeductions('branch-1', queue,
      [movement('legacy', 'SAME', 'branch-1')])).toEqual({ 'product-1': 2 });
  });

  it('keeps movements for another queued sale with the same invoice', () => {
    const queue = [sale('client-1', 'branch-1', 'SAME'), sale('client-2', 'branch-1', 'SAME')];
    expect(saleMovementIdsForCleanup([
      movement('own', 'client-1', 'branch-1'),
      movement('legacy', 'SAME', 'branch-1'),
      movement('other', 'client-2', 'branch-1'),
      movement('outside', 'SAME', 'branch-2'),
    ], queue, 'client-1', 'SAME', 'branch-1')).toEqual(['own']);
  });

  it('clears only matching legacy invoices when they are unambiguous', () => {
    expect(saleMovementIdsForCleanup([
      movement('own', 'client-1', 'branch-1'),
      movement('legacy', 'SAME', 'branch-1'),
      movement('outside', 'SAME', 'branch-2'),
      movement('unrelated', 'SAME', 'branch-1', { reason: 'adjustment' }),
      movement('posted', 'SAME', 'branch-1', { synced: true }),
    ], [sale('client-1', 'branch-1', 'SAME')], 'client-1', 'SAME', 'branch-1'))
      .toEqual(['own', 'legacy']);
  });

  it('requires both a sale ID and a branch scope', () => {
    expect(() => saleMovementIdsForCleanup([], [], '', 'SAME', 'branch-1'))
      .toThrow('OFFLINE_SALE_SCOPE_REQUIRED_FOR_CLEANUP');
    expect(() => saleMovementIdsForCleanup([], [], 'client-1', 'SAME', ''))
      .toThrow('OFFLINE_SALE_SCOPE_REQUIRED_FOR_CLEANUP');
  });
});
