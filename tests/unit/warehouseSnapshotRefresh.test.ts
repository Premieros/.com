import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedStockEntry } from '@/core/repositories/types';

const harness = vi.hoisted(() => ({
  range: vi.fn(),
  openLocalDb: vi.fn(),
}));
vi.mock('@/api', () => {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    range: harness.range,
  };
  return { supabase: { from: (table: string) => {
    if (table !== 'inventory') throw new Error('Unexpected table');
    return query;
  } } };
});
vi.mock('@/core/repositories/LocalDatabase', () => ({
  getLocalDb: harness.openLocalDb,
}));

import {
  aggregateVerifiedWarehouseRows,
  refreshVerifiedWarehouseStock,
  replaceWarehouseSnapshots,
} from '@/core/repositories/warehouseSnapshotRefresh';

const TIME = '2026-10-13T12:00:00.000Z';
const row = (product: string, warehouse = 'warehouse-a', qty: number | string = 2) => ({
  product_id: product,
  branch_id: 'branch-a',
  warehouse_id: warehouse,
  quantity: qty,
});

beforeEach(() => { vi.resetAllMocks(); });

describe('validated warehouse-specific server inventory snapshot', () => {
  it('aggregates separate inventory lots for the same product and warehouse', () => {
    const data = aggregateVerifiedWarehouseRows('branch-a','warehouse-a',[
      row('product-1', 'warehouse-a', 2),
      row('product-1', 'warehouse-a', '3.2500'),
      row('product-2','warehouse-a',-1),
    ], TIME);
    expect(data).toEqual([
      {
        id:JSON.stringify(['branch-a','warehouse-a','product-1']),
        branchId:'branch-a',warehouseId:'warehouse-a',productId:'product-1',
        serverQuantity:5.25,lastSyncedAt:TIME,
      },
      {
        id:JSON.stringify(['branch-a','warehouse-a','product-2']),
        branchId:'branch-a',warehouseId:'warehouse-a',productId:'product-2',
        serverQuantity:-1,lastSyncedAt:TIME,
      },
    ]);
  });

  it('refuses rows from another warehouse rather than merging their stock', () => {
    expect(() => aggregateVerifiedWarehouseRows('branch-a','warehouse-a',
      [row('product-1','warehouse-b',100)],TIME))
      .toThrow('WAREHOUSE_SNAPSHOT_ROW_SCOPE_MISMATCH');
  });

  it('refuses rows from another branch even with a matching warehouse string', () => {
    expect(() => aggregateVerifiedWarehouseRows('branch-a','warehouse-a',
      [{...row('product-1'),branch_id:'branch-b'}],TIME))
      .toThrow('WAREHOUSE_SNAPSHOT_ROW_SCOPE_MISMATCH');
  });

  it('rejects corrupted quantities and missing product identities', () => {
    for (const quantity of [null, 'not-a-number']) {
      expect(() => aggregateVerifiedWarehouseRows('branch-a','warehouse-a',
        [{...row('product-1'), quantity}],TIME)).toThrow();
    }
    expect(() => aggregateVerifiedWarehouseRows('branch-a','warehouse-a',
      [{...row('product-1'),product_id:null}],TIME)).toThrow();
  });

  it('never fabricates a zero balance for a product absent from the source', () => {
    expect(aggregateVerifiedWarehouseRows('branch-a','warehouse-a',[],TIME)).toEqual([]);
  });

  it('rejects invalid scope and timestamp rather than trusting a branch total', () => {
    expect(() => aggregateVerifiedWarehouseRows('','warehouse-a',[row('p')],TIME))
      .toThrow('WAREHOUSE_SNAPSHOT_SCOPE_REQUIRED');
    expect(() => aggregateVerifiedWarehouseRows('branch-a','',[],TIME))
      .toThrow('WAREHOUSE_SNAPSHOT_SCOPE_REQUIRED');
    expect(() => aggregateVerifiedWarehouseRows('branch-a','warehouse-a',[],'invalid'))
      .toThrow('WAREHOUSE_SNAPSHOT_SCOPE_REQUIRED');
  });

  it('never opens the cache when the permission-scoped server read fails', async () => {
    harness.range.mockResolvedValue({data:null,error:{message:'permission denied'}});
    await expect(refreshVerifiedWarehouseStock('branch-a','warehouse-a'))
      .rejects.toThrow('WAREHOUSE_SNAPSHOT_FETCH_FAILED');
    expect(harness.openLocalDb).not.toHaveBeenCalled();
  });

  it('refuses to commit a partly fetched multi-page snapshot', async () => {
    harness.range
      .mockResolvedValueOnce({data:Array.from({length:500},()=>row('product-1')),error:null})
      .mockResolvedValueOnce({data:null,error:{message:'connection lost'}});
    await expect(refreshVerifiedWarehouseStock('branch-a','warehouse-a'))
      .rejects.toThrow('WAREHOUSE_SNAPSHOT_FETCH_FAILED');
    expect(harness.openLocalDb).not.toHaveBeenCalled();
    expect(harness.range).toHaveBeenCalledTimes(2);
  });

  it('only writes after complete pagination and keeps no synthetic zero rows', async () => {
    const events: string[] = [];
    const existing: CachedStockEntry[] = [
      {id:'old',branchId:'branch-a',warehouseId:'warehouse-a',productId:'product-1',
        serverQuantity:20,lastSyncedAt:TIME},
      {id:'other',branchId:'branch-a',warehouseId:'warehouse-b',productId:'product-1',
        serverQuantity:30,lastSyncedAt:TIME},
      {id:'branchwide',branchId:'branch-a',productId:'product-1',
        serverQuantity:50,lastSyncedAt:TIME},
    ];
    const state: {
      oncomplete: null | (() => void);
      onerror: null | (() => void);
      onabort: null | (() => void);
      error: Error | null;
    } = {oncomplete:null,onerror:null,onabort:null,error:null};
    const store = {
      getAll: () => {
        const req: { result: CachedStockEntry[]; onsuccess: null | (() => void); onerror: null | (() => void) } =
          { result: existing, onsuccess:null, onerror:null };
        setTimeout(() => {
          req.onsuccess?.();
          setTimeout(() => state.oncomplete?.(), 0);
        }, 0);
        return req;
      },
      delete: (id: string) => events.push('delete:'+id),
      put: (value: CachedStockEntry) => events.push('put:'+value.productId),
    };
    harness.openLocalDb.mockResolvedValue({
      transaction: () => ({
        ...state,
        objectStore: () => store,
        abort: () => { events.push('abort'); state.onabort?.(); },
        get oncomplete() { return state.oncomplete; },
        set oncomplete(cb: null | (() => void)) { state.oncomplete = cb; },
        get onerror() { return state.onerror; },
        set onerror(cb: null | (() => void)) { state.onerror = cb; },
        get onabort() { return state.onabort; },
        set onabort(cb: null | (() => void)) { state.onabort = cb; },
      }),
    });
    harness.range.mockResolvedValue({data:[],error:null});
    expect(await refreshVerifiedWarehouseStock('branch-a','warehouse-a'))
      .toEqual({rows:0,products:0});
    expect(events).toEqual(['delete:old']);
    // Replacing an empty/absent product collection cannot borrow another
    // warehouse's inventory or a legacy branch-wide cache quantity.
    expect(harness.openLocalDb).toHaveBeenCalledTimes(1);
  });
});
