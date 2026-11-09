import { describe, expect, it } from 'vitest';
import { decideOfflineSaleInsert } from '@/core/offline/offlineSaleIdempotency';
import type { OfflineSaleQueueItem } from '@/core/offline/offlineStorage';

const original = {
  id: 'queued-a',
  client_id: 'queued-a',
  invoice_number: 'INV-001',
  created_at: '2026-11-09T00:00:00Z',
  created_by_user_id: 'cashier-1',
  payload: {
    p_client_operation_key: 'op-1',
    p_branch_id: 'branch-1',
    p_invoice_number: 'INV-001',
    p_order_id: 'order-1',
    p_total: 150,
    p_items: [{ product_id: 'burger', quantity: 2 }],
  },
};
const existing: OfflineSaleQueueItem = { ...original, status: 'pending', retry_count: 0 };

describe('Offline sales financial-operation idempotency', () => {
  it('inserts a first capture', () => {
    expect(decideOfflineSaleInsert([], original)).toEqual({ id: 'queued-a', inserted: true });
  });

  it('returns an existing sale on a legitimate retry with a new invoice number', () => {
    const retry = {
      ...original, id: 'queued-b', invoice_number: 'INV-002',
      payload: { ...original.payload, p_invoice_number: 'INV-002' },
    };
    expect(decideOfflineSaleInsert([existing], retry)).toEqual({ id: 'queued-a', inserted: false });
  });

  for (const status of ['pending', 'syncing', 'synced', 'failed'] as const) {
    it('does not re-enqueue the same key in status ' + status, () => {
      expect(decideOfflineSaleInsert([{ ...existing, status }], original))
        .toEqual({ id: 'queued-a', inserted: false });
    });
  }

  it('rejects a reused key with a different amount, items or owner', () => {
    for (const change of [
      { payload: { ...original.payload, p_total: 151 } },
      { payload: { ...original.payload, p_items: [{ product_id: 'burger', quantity: 3 }] } },
      { created_by_user_id: 'cashier-2' },
      { payload: { ...original.payload, p_branch_id: 'branch-2' } },
    ]) {
      expect(() => decideOfflineSaleInsert([existing], { ...original, ...change }))
        .toThrow('OFFLINE_SALE_OPERATION_KEY_CONFLICT');
    }
  });

  it('rejects duplicate historical keys rather than silently picking one', () => {
    expect(() => decideOfflineSaleInsert([existing, { ...existing, id: 'queued-duplicate' }], original))
      .toThrow('OFFLINE_SALE_OPERATION_KEY_CONFLICT');
  });

  it('requires originating user, branch and financial key', () => {
    expect(() => decideOfflineSaleInsert([], { ...original, created_by_user_id: '' }))
      .toThrow('OFFLINE_SALE_IDEMPOTENCY_SCOPE_REQUIRED');
    expect(() => decideOfflineSaleInsert([], {
      ...original, payload: { ...original.payload, p_client_operation_key: '' },
    })).toThrow('OFFLINE_SALE_IDEMPOTENCY_SCOPE_REQUIRED');
  });
});
