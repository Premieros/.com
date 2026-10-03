/**
 * Core Local IndexedDB Layer for Premier ERP / POS
 * Versioned schema, handles connection, store creation, generic read/write,
 * indices, and transactions.
 */

const DB_NAME = 'premier_pos_offline_db';
const DB_VERSION = 4;

let dbInstancePromise: Promise<IDBDatabase> | null = null;

export function getLocalDb(): Promise<IDBDatabase> {
  if (dbInstancePromise) return dbInstancePromise;

  dbInstancePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported in this runtime environment'));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;

      // Base catalog & reference stores
      if (!db.objectStoreNames.contains('products')) {
        const prodStore = db.createObjectStore('products', { keyPath: 'id' });
        prodStore.createIndex('branch_id', 'branch_id', { unique: false });
        prodStore.createIndex('barcode', 'barcode', { unique: false });
      }
      if (!db.objectStoreNames.contains('categories')) {
        const catStore = db.createObjectStore('categories', { keyPath: 'id' });
        catStore.createIndex('branch_id', 'branch_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('customers')) {
        const custStore = db.createObjectStore('customers', { keyPath: 'id' });
        custStore.createIndex('branch_id', 'branch_id', { unique: false });
        custStore.createIndex('phone', 'phone', { unique: false });
      }
      if (!db.objectStoreNames.contains('dining_tables')) {
        const tableStore = db.createObjectStore('dining_tables', { keyPath: 'id' });
        tableStore.createIndex('branch_id', 'branch_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('dining_areas')) {
        const areaStore = db.createObjectStore('dining_areas', { keyPath: 'id' });
        areaStore.createIndex('branch_id', 'branch_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('branches')) {
        db.createObjectStore('branches', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('warehouses')) {
        const whStore = db.createObjectStore('warehouses', { keyPath: 'id' });
        whStore.createIndex('branch_id', 'branch_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('system_settings')) {
        db.createObjectStore('system_settings', { keyPath: 'key' });
      }

      // Legacy and current sales queues
      if (!db.objectStoreNames.contains('sales_queue')) {
        const salesStore = db.createObjectStore('sales_queue', { keyPath: 'id' });
        salesStore.createIndex('status', 'status', { unique: false });
        salesStore.createIndex('created_at', 'created_at', { unique: false });
      }
      if (!db.objectStoreNames.contains('orders_queue')) {
        const ordersStore = db.createObjectStore('orders_queue', { keyPath: 'id' });
        ordersStore.createIndex('status', 'status', { unique: false });
      }

      // V4 Additions: Stock movements ledger, outbox operations, auth cache
      if (!db.objectStoreNames.contains('stock_balances')) {
        const stockStore = db.createObjectStore('stock_balances', { keyPath: 'id' }); // `${branchId}_${productId}`
        stockStore.createIndex('branch_id', 'branch_id', { unique: false });
        stockStore.createIndex('productId', 'productId', { unique: false });
      }
      if (!db.objectStoreNames.contains('local_stock_movements')) {
        const movStore = db.createObjectStore('local_stock_movements', { keyPath: 'id' });
        movStore.createIndex('productId', 'productId', { unique: false });
        movStore.createIndex('branchId', 'branchId', { unique: false });
        movStore.createIndex('synced', 'synced', { unique: false });
      }
      if (!db.objectStoreNames.contains('outbox_operations')) {
        const outboxStore = db.createObjectStore('outbox_operations', { keyPath: 'id' });
        outboxStore.createIndex('status', 'status', { unique: false });
        outboxStore.createIndex('idempotencyKey', 'idempotencyKey', { unique: true });
        outboxStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('auth_cache')) {
        db.createObjectStore('auth_cache', { keyPath: 'key' });
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbInstancePromise = null;
      };
      resolve(db);
    };

    req.onerror = () => {
      dbInstancePromise = null;
      reject(req.error);
    };

    req.onblocked = () => {
      dbInstancePromise = null;
      console.warn('[LocalDatabase] Upgrade blocked by another tab');
    };
  }).catch((err) => {
    dbInstancePromise = null;
    throw err;
  });

  return dbInstancePromise;
}

/**
 * Generic transactional helper to get a single item by key
 */
export async function dbGet<T>(storeName: string, key: IDBValidKey): Promise<T | null> {
  try {
    const db = await getLocalDb();
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Generic transactional helper to get all items from a store
 */
export async function dbGetAll<T>(storeName: string): Promise<T[]> {
  try {
    const db = await getLocalDb();
    return await new Promise<T[]>((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as T[]) || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/**
 * Generic transactional helper to put/save an item
 */
export async function dbPut<T>(storeName: string, item: T): Promise<void> {
  const db = await getLocalDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Replace entire contents of a store atomically
 */
export async function dbReplaceAll<T>(storeName: string, items: T[]): Promise<void> {
  const db = await getLocalDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Delete item by key
 */
export async function dbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await getLocalDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
