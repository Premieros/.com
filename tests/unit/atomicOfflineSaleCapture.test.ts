import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { id: string; [key: string]: unknown };
const harness = vi.hoisted(() => ({
  current: null as null | { db: IDBDatabase; stores: Record<string, Map<string, Row>>; failAtWrite: number },
}));
vi.mock('@/core/repositories/LocalDatabase', () => ({
  getLocalDb: () => {
    if (!harness.current) throw new Error('TEST_DB_UNAVAILABLE');
    return Promise.resolve(harness.current.db);
  },
}));

import {
  enqueueOfflineSaleWithMovements,
  getAllOfflineSales,
  removeOfflineSaleStrict,
} from '@/core/offline/offlineStorage';

function makeDb() {
  const stores: Record<string, Map<string, Row>> = {
    sales_queue: new Map(),
    local_stock_movements: new Map(),
  };
  const result = {
    stores,
    failAtWrite: -1,
    db: {
      transaction(names: string | string[], mode: IDBTransactionMode) {
        const list = Array.isArray(names) ? names : [names];
        const pending = Object.fromEntries(list.map((name) =>
          [name, new Map(stores[name])])) as Record<string, Map<string, Row>>;
        let writes = 0;
        let aborted = false;
        const tx = {
          oncomplete: null as null | (() => void),
          onerror: null as null | (() => void),
          onabort: null as null | (() => void),
          error: null as Error | null,
          abort() {
            aborted = true;
            setTimeout(() => tx.onabort?.(), 0);
          },
          objectStore(name: string) {
            const target = pending[name];
            if (!target) throw new Error('STORE_SCOPE_INVALID');
            return {
              add(value: Row) {
                if (mode !== 'readwrite') throw new Error('READONLY');
                writes++;
                if (writes === result.failAtWrite) throw new Error('SIMULATED_MID_TRANSACTION_WRITE_FAILURE');
                if (target.has(value.id)) throw new Error('DUPLICATE_LOCAL_SALE_ID');
                target.set(value.id, value);
              },
              delete(key: string) {
                if (mode !== 'readwrite') throw new Error('READONLY');
                writes++;
                if (writes === result.failAtWrite) throw new Error('SIMULATED_MID_TRANSACTION_WRITE_FAILURE');
                target.delete(key);
              },
              getAll() {
                const req = {
                  result: Array.from(target.values()),
                  onsuccess: null as null | (() => void),
                  onerror: null as null | (() => void),
                };
                setTimeout(() => req.onsuccess?.(), 0);
                return req;
              },
            };
          },
        };
        setTimeout(() => {
          if (aborted) return;
          if (mode === 'readwrite') {
            for (const name of list) {
              stores[name].clear();
              for (const [key, row] of pending[name]) stores[name].set(key, row);
            }
          }
          tx.oncomplete?.();
        }, 5);
        return tx;
      },
    } as unknown as IDBDatabase,
  };
  return result;
}

const sale = () => ({
  id: 'cashier-device-001',
  client_id: 'cashier-device-001',
  invoice_number: 'INV-OFF-001',
  created_at: '2026-11-08T10:00:00.000Z',
  created_by_user_id: 'operator-1',
  payload: {
    p_branch_id: 'branch-a',
    p_warehouse_id: 'warehouse-a',
    p_invoice_number: 'INV-OFF-001',
    p_items: [
      { product_id: 'product-a', quantity: 2 },
      { product_id: 'product-b', quantity: 3 },
    ],
  },
});

beforeEach(() => { harness.current = makeDb(); });

describe('atomic local financial outbox capture', () => {
  it('commits one sale and ALL branch/warehouse-scoped movements as one transaction', async () => {
    const original = sale();
    await enqueueOfflineSaleWithMovements(original);
    const rows = await getAllOfflineSales();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: original.id, created_by_user_id: 'operator-1', status: 'pending', retry_count: 0,
    });
    expect(rows[0].payload.p_client_operation_key).toBe(original.id);
    const moves = Array.from(harness.current!.stores.local_stock_movements.values());
    expect(moves).toHaveLength(2);
    expect(moves).toEqual([
      expect.objectContaining({
        branchId: 'branch-a', warehouseId: 'warehouse-a',
        referenceId: original.id, productId: 'product-a', quantityDelta: -2, synced: false,
      }),
      expect.objectContaining({
        branchId: 'branch-a', warehouseId: 'warehouse-a',
        referenceId: original.id, productId: 'product-b', quantityDelta: -3, synced: false,
      }),
    ]);
  });

  it('rolls back the queued invoice and the first deduction if a later write fails', async () => {
    harness.current!.failAtWrite = 3; // queue added, first movement added, second fails
    await expect(enqueueOfflineSaleWithMovements(sale()))
      .rejects.toThrow('SIMULATED_MID_TRANSACTION_WRITE_FAILURE');
    expect(harness.current!.stores.sales_queue.size).toBe(0);
    expect(harness.current!.stores.local_stock_movements.size).toBe(0);

    // Retry after the simulated crash can save one complete transaction.
    harness.current!.failAtWrite = -1;
    await enqueueOfflineSaleWithMovements(sale());
    expect(harness.current!.stores.sales_queue.size).toBe(1);
    expect(harness.current!.stores.local_stock_movements.size).toBe(2);
  });

  it('refuses duplicate local sale IDs rather than overwriting an existing invoice', async () => {
    await enqueueOfflineSaleWithMovements(sale());
    const previous = Array.from(harness.current!.stores.sales_queue.values());
    await expect(enqueueOfflineSaleWithMovements({
      ...sale(), invoice_number: 'DIFFERENT-INVOICE',
    })).rejects.toThrow('OFFLINE_SALE_DUPLICATE_LOCAL_CAPTURE');
    expect(Array.from(harness.current!.stores.sales_queue.values())).toEqual(previous);
    expect(harness.current!.stores.local_stock_movements.size).toBe(2);
  });

  it('rejects duplicate offline invoices or operation keys even with different local IDs', async () => {
    await enqueueOfflineSaleWithMovements({
      ...sale(),
      payload: { ...sale().payload, p_client_operation_key: 'checkout:one' },
    });
    await expect(enqueueOfflineSaleWithMovements({
      ...sale(), id: 'cashier-device-002', client_id: 'cashier-device-002',
      invoice_number: 'INV-OFF-002',
      payload: {
        ...sale().payload,
        p_invoice_number: 'INV-OFF-002',
        p_client_operation_key: 'checkout:one',
      },
    })).rejects.toThrow('OFFLINE_SALE_DUPLICATE_LOCAL_CAPTURE');

    await expect(enqueueOfflineSaleWithMovements({
      ...sale(), id: 'cashier-device-003', client_id: 'cashier-device-003',
      payload: {
        ...sale().payload, p_client_operation_key: 'checkout:other',
      },
    })).rejects.toThrow('OFFLINE_SALE_DUPLICATE_LOCAL_CAPTURE');

    expect(harness.current!.stores.sales_queue.size).toBe(1);
    expect(harness.current!.stores.local_stock_movements.size).toBe(2);
  });

  it('rejects absent tenant scope, warehouse, cashier or invalid quantities before opening a transaction', async () => {
    const bad = [
      { ...sale(), created_by_user_id: '' },
      { ...sale(), payload: { ...sale().payload, p_branch_id: '' } },
      { ...sale(), payload: { ...sale().payload, p_warehouse_id: null } },
      { ...sale(), payload: { ...sale().payload, p_items: [] } },
      { ...sale(), payload: { ...sale().payload, p_items: [{ product_id: 'p', quantity: 0 }] } },
      { ...sale(), payload: { ...sale().payload, p_items: [{ product_id: 'p', quantity: NaN }] } },
    ];
    for (const item of bad) {
      await expect(enqueueOfflineSaleWithMovements(item as Parameters<typeof enqueueOfflineSaleWithMovements>[0]))
        .rejects.toThrow(/OFFLINE_SALE_ATOMIC_CAPTURE_/);
    }
    expect(harness.current!.stores.sales_queue.size).toBe(0);
    expect(harness.current!.stores.local_stock_movements.size).toBe(0);
  });

  it('does not claim dequeue success until the local delete transaction commits', async () => {
    await enqueueOfflineSaleWithMovements(sale());
    harness.current!.failAtWrite = 1;
    await expect(removeOfflineSaleStrict('cashier-device-001'))
      .rejects.toThrow('SIMULATED_MID_TRANSACTION_WRITE_FAILURE');
    expect(harness.current!.stores.sales_queue.size).toBe(1);
    harness.current!.failAtWrite = -1;
    await removeOfflineSaleStrict('cashier-device-001');
    expect(harness.current!.stores.sales_queue.size).toBe(0);
    // Movement cleanup belongs to the reconciliation path, not this helper.
    expect(harness.current!.stores.local_stock_movements.size).toBe(2);
  });

  it('preserves a completed queued sale across simulated module/browser restarts', async () => {
    await enqueueOfflineSaleWithMovements(sale());
    const db = harness.current;
    // Reconnecting to the same IndexedDB origin must not discard outbox rows.
    harness.current = db;
    expect((await getAllOfflineSales()).map(row => row.invoice_number)).toEqual(['INV-OFF-001']);
    expect(harness.current!.stores.local_stock_movements.size).toBe(2);
  });
});
