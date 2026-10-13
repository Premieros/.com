import { afterEach, describe, expect, it, vi } from 'vitest';

/** Minimal stateful IndexedDB request/transaction emulator to exercise the
 * actual upgrade, queue persistence and cross-module connection logic.
 * It intentionally retains the stored rows between simulated tab reloads.
 */
function legacyIndexedDB(version: number) {
  type Row = Record<string, unknown>;
  const stores = new Map<string, { keyPath: string; rows: Map<unknown, Row> }>();

  function seed(name: string, keyPath = 'id', rows: Row[] = []) {
    stores.set(name, {
      keyPath,
      rows: new Map(rows.map(row => [row[keyPath], row])),
    });
  }
  seed('sales_queue', 'id', [{
    id: 'legacy-sale', client_id: 'legacy-sale',
    invoice_number: 'LEGACY-1', created_at: '2026-09-01T00:00:00Z',
    payload: { p_invoice_number: 'LEGACY-1', p_branch_id: 'b1', p_items: [] },
    status: 'pending', retry_count: 0,
  }]);
  seed('products');
  seed('system_settings', 'key');
  if (version >= 4) {
    seed('local_stock_movements');
    seed('stock_balances');
  }

  const db = {
    get version() { return version; },
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string, options: { keyPath: string }) => {
      seed(name, options.keyPath);
      return { createIndex: () => undefined };
    },
    onversionchange: null as null | (() => void),
    close: () => undefined,
    transaction(name: string) {
      const store = stores.get(name);
      if (!store) throw new Error('NotFoundError: ' + name);
      const tx = {
        oncomplete: null as null | (() => void),
        onerror: null as null | (() => void),
        onabort: null as null | (() => void),
        error: null,
        objectStore() {
          function request(value: unknown) {
            const req = { result: value, error: null, onsuccess: null as null | (() => void), onerror: null };
            setTimeout(() => req.onsuccess?.(), 0);
            return req;
          }
          return {
            getAll: () => request(Array.from(store.rows.values())),
            get: (key: unknown) => request(store.rows.get(key)),
            put: (row: Row) => { store.rows.set(row[store.keyPath], row); return request(undefined); },
            delete: (key: unknown) => { store.rows.delete(key); return request(undefined); },
            clear: () => { store.rows.clear(); return request(undefined); },
          };
        },
      };
      setTimeout(() => tx.oncomplete?.(), 5);
      return tx;
    },
  };

  const open = vi.fn((_name: string, requestedVersion: number) => {
    const req = {
      result: db, error: null as Error | null,
      onupgradeneeded: null as null | ((event: { target: { result: typeof db } }) => void),
      onsuccess: null as null | (() => void),
      onerror: null as null | (() => void),
      onblocked: null as null | (() => void),
    };
    setTimeout(() => {
      if (requestedVersion < version) {
        req.error = new Error('VersionError');
        req.onerror?.();
        return;
      }
      if (requestedVersion > version) {
        version = requestedVersion;
        req.onupgradeneeded?.({ target: { result: db } });
      }
      req.onsuccess?.();
    }, 0);
    return req;
  });

  return { db, stores, open };
}

afterEach(() => vi.unstubAllGlobals());

describe('shared offline IndexedDB upgrade and restart safety', () => {
  for (const legacy of [3, 4]) {
    it(`upgrades v${legacy} without dropping a queued sale and shares one connection after restart`, async () => {
      const fake = legacyIndexedDB(legacy);
      vi.stubGlobal('indexedDB', { open: fake.open });
      vi.resetModules();

      const local = await import('@/core/repositories/LocalDatabase');
      const offline = await import('@/core/offline/offlineStorage');
      expect(offline.openOfflineDb).toBe(local.getLocalDb);

      const connection = await offline.openOfflineDb();
      expect(connection).toBe(await local.getLocalDb());
      expect(connection.version).toBe(5);
      for (const name of ['sales_queue', 'stock_map', 'stock_balances',
        'local_stock_movements', 'outbox_operations', 'warehouses']) {
        expect(connection.objectStoreNames.contains(name)).toBe(true);
      }

      const preserved = await offline.getAllOfflineSales();
      expect(preserved.map(row => row.id)).toEqual(['legacy-sale']);

      await offline.enqueueOfflineSale({
        id: 'new-sale', client_id: 'new-sale', invoice_number: 'NEW-1',
        created_at: '2026-10-13T00:00:00Z',
        created_by_user_id: 'cashier-1',
        payload: { p_branch_id: 'b1', p_invoice_number: 'NEW-1', p_items: [] },
      });
      expect((await offline.getAllOfflineSales()).map(row => row.id).sort())
        .toEqual(['legacy-sale', 'new-sale']);

      // Simulate reload: both entry points re-open the same existing v5 DB.
      vi.resetModules();
      const restartedOffline = await import('@/core/offline/offlineStorage');
      const restartedLocal = await import('@/core/repositories/LocalDatabase');
      expect(await restartedOffline.openOfflineDb()).toBe(await restartedLocal.getLocalDb());
      expect((await restartedOffline.getAllOfflineSales()).map(row => row.id).sort())
        .toEqual(['legacy-sale', 'new-sale']);
      expect(fake.open.mock.calls.every(args => args[1] === 5)).toBe(true);
    });
  }
});
