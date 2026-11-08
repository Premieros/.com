import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  getAllStrict: vi.fn(),
  finalize: vi.fn(),
}));
vi.mock('@/core/repositories/LocalDatabase', () => ({
  dbGetAllStrict: mocked.getAllStrict,
  dbGetAll: vi.fn(),
  dbPut: vi.fn(),
}));
vi.mock('@/core/offline/offlineStorage', () => ({
  enqueueOfflineSaleWithMovements: vi.fn(),
  finalizeConfirmedOfflineSale: mocked.finalize,
}));

import { SalesRepository } from '@/core/repositories/SalesRepository';

const queuedSale = {
  id: 'client-1',client_id: 'client-1',invoice_number:'INV-OFF-1',
  status:'pending',retry_count:0,created_at:'2026-11-08T00:00:00Z',
  payload:{p_branch_id:'branch-1',p_invoice_number:'INV-OFF-1'},
};

beforeEach(() => {
  vi.resetAllMocks();
  mocked.getAllStrict.mockResolvedValue([queuedSale]);
  mocked.finalize.mockResolvedValue(undefined);
});

describe('confirmed offline sale atomic finalization', () => {
  it('uses one branch-scoped transaction for the invoice and its movements', async () => {
    await SalesRepository.markSaleSynced('client-1','INV-OFF-1');
    expect(mocked.finalize).toHaveBeenCalledExactlyOnceWith(
      'client-1','branch-1','INV-OFF-1',
    );
  });

  it('preserves the caller error when finalization fails and never assumes success', async () => {
    mocked.finalize.mockRejectedValue(new Error('SIMULATED_TRANSACTION_ABORT'));
    await expect(SalesRepository.markSaleSynced('client-1','INV-OFF-1'))
      .rejects.toThrow('SIMULATED_TRANSACTION_ABORT');
    expect(mocked.finalize).toHaveBeenCalledTimes(1);
  });

  it('rejects missing branch scope before any delete', async () => {
    mocked.getAllStrict.mockResolvedValue([{...queuedSale,payload:{}}]);
    await expect(SalesRepository.markSaleSynced('client-1','INV-OFF-1'))
      .rejects.toThrow('OFFLINE_SALE_SCOPE_REQUIRED_FOR_CLEANUP');
    expect(mocked.finalize).not.toHaveBeenCalled();
  });

  it('never attempts a delete for a missing local sale', async () => {
    mocked.getAllStrict.mockResolvedValue([]);
    await SalesRepository.markSaleSynced('client-1','INV-OFF-1');
    expect(mocked.finalize).not.toHaveBeenCalled();
  });
});
