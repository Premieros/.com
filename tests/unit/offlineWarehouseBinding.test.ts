import { beforeEach, describe, expect, it, vi } from 'vitest';

const local = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(),
}));
vi.mock('@/core/repositories/LocalDatabase', () => ({
  dbGetAllStrict: local.read,
  dbPut: local.write,
}));

import {
  saveVerifiedSaleWarehouse,
  getPinnedSaleWarehouse,
  getReplayPinnedWarehouse,
} from '@/core/offline/warehouseBinding';

const NOW = Date.parse('2026-10-13T12:00:00.000Z');
const row = (
  branchId: string,
  warehouseId: string,
  orderId: string | null,
  verifiedAt = new Date(NOW).toISOString(),
) => ({
  key: 'offline_pos_warehouse:' + JSON.stringify([branchId, orderId]),
  value: {branchId,warehouseId,orderId,verifiedAt},
});

beforeEach(() => { vi.resetAllMocks(); });

describe('offline sale capture keeps origin warehouse pinned', () => {
  it('persists a branch-default warehouse only after verification', async () => {
    local.write.mockResolvedValue(undefined);
    await saveVerifiedSaleWarehouse('branch-a','warehouse-a',null);
    expect(local.write).toHaveBeenCalledWith('system_settings', expect.objectContaining({
      key: 'offline_pos_warehouse:' + JSON.stringify(['branch-a',null]),
      value: expect.objectContaining({
        branchId:'branch-a',warehouseId:'warehouse-a',orderId:null,
      }),
    }));
  });

  it('never saves a binding with missing warehouse or branch', async () => {
    await expect(saveVerifiedSaleWarehouse('branch-a','',null)).rejects.toThrow('WAREHOUSE_SCOPE_REQUIRED');
    await expect(saveVerifiedSaleWarehouse('','warehouse-a',null)).rejects.toThrow('WAREHOUSE_SCOPE_REQUIRED');
    expect(local.write).not.toHaveBeenCalled();
  });

  it('loads an exact branch-specific warehouse within the freshness window', async () => {
    local.read.mockResolvedValue([row('branch-a','warehouse-a',null)]);
    expect(await getPinnedSaleWarehouse('branch-a',null,NOW)).toBe('warehouse-a');
    expect(await getPinnedSaleWarehouse('branch-b',null,NOW)).toBeNull();
  });

  it('cannot substitute a branch default for an active order warehouse', async () => {
    local.read.mockResolvedValue([
      row('branch-a','warehouse-default',null),
      row('branch-a','warehouse-order','order-a'),
    ]);
    expect(await getPinnedSaleWarehouse('branch-a','order-a',NOW)).toBe('warehouse-order');
    expect(await getPinnedSaleWarehouse('branch-a','order-b',NOW)).toBeNull();
  });

  it('rejects stale, invalid and future cached assignments', async () => {
    for (const at of [
      new Date(NOW-25*60*60*1000).toISOString(),
      'invalid',
      new Date(NOW+10*60*1000).toISOString(),
    ]) {
      local.read.mockResolvedValue([row('branch-a','warehouse-a',null,at)]);
      expect(await getPinnedSaleWarehouse('branch-a',null,NOW)).toBeNull();
    }
  });

  it('does not infer a current warehouse if storage is unavailable', async () => {
    local.read.mockRejectedValue(new Error('IDB aborted'));
    await expect(getPinnedSaleWarehouse('branch-a',null,NOW)).rejects.toThrow('IDB aborted');
  });

  it('blocks legacy unpinned financial replay instead of choosing a new default', () => {
    expect(getReplayPinnedWarehouse({p_warehouse_id:' warehouse-a '})).toBe('warehouse-a');
    expect(getReplayPinnedWarehouse({p_warehouse_id:null})).toBeNull();
    expect(getReplayPinnedWarehouse({})).toBeNull();
    expect(getReplayPinnedWarehouse({p_warehouse_id:'  '})).toBeNull();
  });

  it('rejects invalid order IDs rather than falling back to branch-wide state', async () => {
    expect(await getPinnedSaleWarehouse('branch-a','',NOW)).toBeNull();
    await expect(saveVerifiedSaleWarehouse('branch-a','warehouse-a',' ')).rejects.toThrow('WAREHOUSE_SCOPE_REQUIRED');
  });
});
