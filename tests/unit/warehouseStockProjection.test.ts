import { describe, expect, it } from 'vitest';
import { projectWarehouseStock, DEFAULT_WAREHOUSE_SNAPSHOT_MAX_AGE_MS } from '@/core/repositories/warehouseStockProjection';
import type { CachedStockEntry, LocalStockMovement } from '@/core/repositories/types';
import type { OfflineSaleQueueItem } from '@/core/offline/offlineStorage';

const NOW = Date.parse('2026-10-13T08:00:00.000Z');
const snap = (warehouseId: string, qty: number, ageMs = 0): CachedStockEntry => ({
  id: JSON.stringify(['branch-a', warehouseId, 'product-1']),
  branchId: 'branch-a', warehouseId, productId: 'product-1',
  serverQuantity: qty, lastSyncedAt: new Date(NOW - ageMs).toISOString(),
});
const sale = (id: string, warehouseId: string | null, quantity: number): OfflineSaleQueueItem => ({
  id, client_id: id, invoice_number: id, status: 'pending', retry_count: 0,
  created_by_user_id: 'user-1', created_at: '2026-10-13T07:00:00.000Z',
  payload: { p_branch_id:'branch-a',p_warehouse_id:warehouseId,
    p_invoice_number:id,p_items:[{product_id:'product-1',quantity}] },
});
const movement = (id: string, warehouseId: string | null, quantity: number, referenceId = id): LocalStockMovement => ({
  id, productId:'product-1',branchId:'branch-a',warehouseId,
  quantityDelta:-quantity,reason:'sale',referenceId, synced:false,
  createdAt:'2026-10-13T07:00:00.000Z',
});
function check(overrides: Partial<Parameters<typeof projectWarehouseStock>[0]> = {}) {
  return projectWarehouseStock({
    productId:'product-1',branchId:'branch-a',warehouseId:'warehouse-a',
    balances:[snap('warehouse-a', 0),snap('warehouse-b', 100)],
    movements:[],sales:[],now:NOW,...overrides,
  });
}

describe('warehouse-scoped offline inventory', () => {
  it('never borrows stock from the second warehouse in the same branch', () => {
    expect(check()).toEqual({status:'known',quantity:0,snapshotAt:new Date(NOW).toISOString()});
    expect(check({ warehouseId:'warehouse-b' })).toEqual({
      status:'known',quantity:100,snapshotAt:new Date(NOW).toISOString(),
    });
  });

  it('does not convert a legacy branch-wide snapshot into warehouse availability', () => {
    const oldBranchSnapshot: CachedStockEntry = {
      id:'branch-a_product-1',branchId:'branch-a',productId:'product-1',
      serverQuantity:200,lastSyncedAt:new Date(NOW).toISOString(),
    };
    expect(check({balances:[oldBranchSnapshot]})).toEqual({
      status:'unknown',reason:'WAREHOUSE_STOCK_SNAPSHOT_MISSING',
    });
  });

  it('fails closed on a missing or blank warehouse id', () => {
    expect(check({warehouseId:''})).toEqual({status:'unknown',reason:'WAREHOUSE_SCOPE_REQUIRED'});
  });

  it('rejects stale and malformed warehouse-specific snapshots', () => {
    expect(check({balances:[snap('warehouse-a', 12, DEFAULT_WAREHOUSE_SNAPSHOT_MAX_AGE_MS + 1)]}))
      .toEqual({status:'unknown',reason:'WAREHOUSE_STOCK_SNAPSHOT_STALE'});
    expect(check({balances:[{...snap('warehouse-a',12), lastSyncedAt:'invalid'}]}))
      .toEqual({status:'unknown',reason:'WAREHOUSE_STOCK_SNAPSHOT_STALE'});
    expect(check({balances:[{...snap('warehouse-a',12), serverQuantity:Number.NaN}]}))
      .toEqual({status:'unknown',reason:'WAREHOUSE_STOCK_SNAPSHOT_STALE'});
  });

  it('remains unknown when a pending sale has not pinned its warehouse', () => {
    expect(check({sales:[sale('sale-1',null,2)]}))
      .toEqual({status:'unknown',reason:'UNSCOPED_QUEUED_SALE'});
    expect(check({sales:[sale('sale-1','',2)]}))
      .toEqual({status:'unknown',reason:'UNSCOPED_QUEUED_SALE'});
  });

  it('remains unknown when a local movement does not identify a warehouse', () => {
    expect(check({movements:[movement('mov-1',null,2)]}))
      .toEqual({status:'unknown',reason:'UNSCOPED_LOCAL_MOVEMENT'});
  });

  it('deducts queued sales and movements only for the specified warehouse', () => {
    expect(check({
      balances:[snap('warehouse-a',10),snap('warehouse-b',200)],
      sales:[sale('sale-a','warehouse-a',3),sale('sale-b','warehouse-b',100)],
      movements:[movement('mov-a','warehouse-a',1,'sale-a'),movement('mov-b','warehouse-b',100,'sale-b')],
    })).toEqual({status:'known',quantity:7,snapshotAt:new Date(NOW).toISOString()});
  });

  it('counts crash-partial unsynced movements without double-deducting', () => {
    expect(check({
      balances:[snap('warehouse-a',10)],
      sales:[sale('sale-a','warehouse-a',5)],
      movements:[movement('mov-a','warehouse-a',2,'sale-a')],
    })).toEqual({status:'known',quantity:5,snapshotAt:new Date(NOW).toISOString()});
  });

  it('ignores sales already confirmed and unrelated products', () => {
    const completed={...sale('done','warehouse-a',5),status:'synced' as const};
    const other={...sale('other','warehouse-a',4),
      payload:{p_branch_id:'branch-a',p_warehouse_id:'warehouse-a',p_items:[{product_id:'product-2',quantity:4}]}};
    expect(check({sales:[completed,other],balances:[snap('warehouse-a',6)]}))
      .toEqual({status:'known',quantity:6,snapshotAt:new Date(NOW).toISOString()});
  });

  it('does not silently accept a future-dated snapshot beyond clock tolerance', () => {
    expect(check({balances:[{...snap('warehouse-a',10),
      lastSyncedAt:new Date(NOW+6*60*1000).toISOString()}]}))
      .toEqual({status:'unknown',reason:'WAREHOUSE_STOCK_SNAPSHOT_STALE'});
  });
});
