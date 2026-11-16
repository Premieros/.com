import { describe, expect, it } from 'vitest';
import { projectWarehouseStock } from '@/core/repositories/warehouseStockProjection';
import { getUnrecordedQueuedSaleDeductions, saleMovementIdsForCleanup } from '@/core/repositories/stockProjection';
import { decideOfflineSaleInsert } from '@/core/offline/offlineSaleIdempotency';
import { getReplayPinnedWarehouse } from '@/core/offline/warehouseBinding';
import type { OfflineSaleQueueItem } from '@/core/offline/offlineStorage';
import type { CachedStockEntry, LocalStockMovement } from '@/core/repositories/types';

const NOW = Date.parse('2026-11-16T06:00:00.000Z');
const at = new Date(NOW).toISOString();
const balance = (branchId: string, warehouseId: string, quantity: number): CachedStockEntry => ({
  id: JSON.stringify([branchId, warehouseId, 'p']),
  branchId, warehouseId, productId: 'p', serverQuantity: quantity, lastSyncedAt: at,
});
const sale = (id: string, branchId: string, warehouseId: string, quantity: number,
  invoice = 'SHARED', cashier = 'cashier-1'): OfflineSaleQueueItem => ({
  id, client_id: id, invoice_number: invoice, created_at: at,
  created_by_user_id: cashier, status: 'pending', retry_count: 0,
  payload: {
    p_branch_id: branchId, p_warehouse_id: warehouseId,
    p_invoice_number: invoice, p_client_operation_key: 'op:' + id,
    p_items: [{ product_id: 'p', quantity }],
  },
});
const movement = (id: string, saleId: string, branchId: string, warehouseId: string,
  quantity: number): LocalStockMovement => ({
  id, referenceId: saleId, branchId, warehouseId, productId: 'p',
  quantityDelta: -quantity, reason: 'sale', synced: false, createdAt: at,
});
const available = (branchId: string, warehouseId: string,
  balances: CachedStockEntry[], sales: OfflineSaleQueueItem[], movements: LocalStockMovement[] = []) =>
  projectWarehouseStock({
    branchId, warehouseId, productId: 'p', balances, sales, movements, now: NOW,
  });

describe('issue #213: warehouse replay and concurrent checkout accounting', () => {
  it('does not borrow warehouse B stock when warehouse A is empty', () => {
    const snapshots = [balance('b1', 'wa', 0), balance('b1', 'wb', 9)];
    expect(available('b1', 'wa', snapshots, [])).toMatchObject({ status: 'known', quantity: 0 });
    expect(available('b1', 'wb', snapshots, [])).toMatchObject({ status: 'known', quantity: 9 });
    expect(available('b1', 'wc', snapshots, []))
      .toEqual({ status: 'unknown', reason: 'WAREHOUSE_STOCK_SNAPSHOT_MISSING' });
  });

  it('accounts for two distinct pending sales even when they share invoice, branch and warehouse', () => {
    const snapshots = [balance('b1', 'wa', 5)];
    const first = sale('local-a', 'b1', 'wa', 3, 'SHARED', 'cashier-1');
    const second = sale('local-b', 'b1', 'wa', 4, 'SHARED', 'cashier-2');
    expect(available('b1', 'wa', snapshots, [first, second]))
      .toMatchObject({ status: 'known', quantity: -2 });
    // Both offline devices can have read the same initial snapshot. The
    // negative projected balance is observable AFTER capture, not proof of
    // atomic admission control or server-side oversell prevention.
  });

  it('survives a restart between durable outbox and partial movement writes without double deduction', () => {
    const pending = sale('local-a', 'b1', 'wa', 4);
    const snapshots = [balance('b1', 'wa', 10)];
    // Crash immediately after outbox commit: no movement was recorded.
    expect(available('b1', 'wa', snapshots, [pending]))
      .toMatchObject({ status: 'known', quantity: 6 });
    // Restart with only one of the per-line movements persisted.
    expect(available('b1', 'wa', snapshots, [pending],
      [movement('partial', 'local-a', 'b1', 'wa', 1)]))
      .toMatchObject({ status: 'known', quantity: 6 });
    // Full movement recorded: outbox deduction is consumed exactly once.
    expect(available('b1', 'wa', snapshots, [pending],
      [movement('complete', 'local-a', 'b1', 'wa', 4)]))
      .toMatchObject({ status: 'known', quantity: 6 });
  });

  it('keeps equal invoices and movements isolated by branch and warehouse', () => {
    const allBalances = [balance('b1', 'wa', 10), balance('b1', 'wb', 20), balance('b2', 'wa', 30)];
    const s1 = sale('local-a', 'b1', 'wa', 3);
    const s2 = sale('local-b', 'b1', 'wb', 5);
    const s3 = sale('local-c', 'b2', 'wa', 7);
    const allSales = [s1, s2, s3];
    const allMovements = [movement('movement-b', 'local-b', 'b1', 'wb', 2)];
    expect(available('b1', 'wa', allBalances, allSales, allMovements))
      .toMatchObject({ status: 'known', quantity: 7 });
    expect(available('b1', 'wb', allBalances, allSales, allMovements))
      .toMatchObject({ status: 'known', quantity: 15 });
    expect(available('b2', 'wa', allBalances, allSales, allMovements))
      .toMatchObject({ status: 'known', quantity: 23 });
    expect(getUnrecordedQueuedSaleDeductions('b1', [s1], [movement('wrong', 'local-a', 'b2', 'wa', 3)]))
      .toEqual({ p: 3 });
    expect(saleMovementIdsForCleanup(allMovements, allSales, 'local-a', 'SHARED', 'b1'))
      .toEqual([]);
  });

  it('ties retries to the original warehouse, cashier and financial operation', () => {
    const original = sale('local-a', 'b1', 'wa', 2);
    const retry = {
      ...sale('retry-id', 'b1', 'wa', 2, 'NEW-INVOICE'),
      payload: { ...original.payload, p_invoice_number: 'NEW-INVOICE' },
    };
    expect(decideOfflineSaleInsert([original], retry))
      .toEqual({ id: 'local-a', inserted: false });
    expect(getReplayPinnedWarehouse(original.payload)).toBe('wa');

    const changedWarehouse = {
      ...retry, payload: { ...retry.payload, p_warehouse_id: 'wb' },
    };
    expect(() => decideOfflineSaleInsert([original], changedWarehouse))
      .toThrow('OFFLINE_SALE_OPERATION_KEY_CONFLICT');

    const changedCashier = { ...retry, created_by_user_id: 'cashier-2' };
    expect(() => decideOfflineSaleInsert([original], changedCashier))
      .toThrow('OFFLINE_SALE_OPERATION_KEY_CONFLICT');
    expect(getReplayPinnedWarehouse({ p_warehouse_id: null })).toBeNull();
  });
});
