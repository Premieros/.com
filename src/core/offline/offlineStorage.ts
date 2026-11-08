import { getLocalDb, dbGetAllStrict } from '@/core/repositories/LocalDatabase';
import type { LocalStockMovement } from '@/core/repositories/types';
import { saleMovementIdsForCleanup } from '@/core/repositories/stockProjection';

/**
 * Premier POS IndexedDB Offline Storage & Local Sync Engine
 * Stores products, categories, customers, dining tables, settings, active shifts,
 * and queues offline sales/orders to sync automatically once back online.
 */

export interface OfflineSaleQueueItem {
  id: string; // client UUID
  client_id: string;
  invoice_number: string;
  created_at: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error?: string;
  retry_count: number;
  /** Required on new sale captures; optional only for pre-fix legacy queue rows. */
  created_by_user_id?: string;
}

export interface OfflineHoldOrderQueueItem {
  id: string;
  created_at: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error?: string;
}

/** All offline data shares the same database name, version and upgrade path.
 * Keep this public alias for existing callers, but NEVER open IndexedDB with
 * an independent version: that can cause VersionError after v4/v5 upgrades.
 */
export const openOfflineDb = getLocalDb;

// ── Cache operations ─────────────────────────────────────────────

export async function saveOfflineCache<T>(storeName: string, items: T[]): Promise<void> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    await new Promise<void>((res, rej) => {
      const clearReq = store.clear();
      clearReq.onsuccess = () => res();
      clearReq.onerror = () => rej(clearReq.error);
    });

    for (const item of items) {
      store.put(item);
    }

    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  } catch (err) {
    console.warn(`[OfflineDB] Failed to cache ${storeName}:`, err);
  }
}

export async function getOfflineCache<T>(storeName: string): Promise<T[]> {
  try {
    const db = await openOfflineDb();
    return await new Promise<T[]>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(storeName, 'readonly');
      } catch (error) {
        reject(error);
        return;
      }
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => resolve([]);
      tx.onabort = () => resolve([]);
    });
  } catch (err) {
    console.warn(`[OfflineDB] Failed to load ${storeName}:`, err);
    return [];
  }
}

export async function saveOfflineSetting(key: string, value: unknown): Promise<void> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction('system_settings', 'readwrite');
    tx.objectStore('system_settings').put({ key, value });
  } catch (e) {
    console.warn('[OfflineDB] save setting error', e);
  }
}

export async function getOfflineSetting<T>(key: string): Promise<T | null> {
  try {
    const db = await openOfflineDb();
    return await new Promise<T | null>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction('system_settings', 'readonly');
      } catch (error) {
        reject(error);
        return;
      }
      const req = tx.objectStore('system_settings').get(key);
      req.onsuccess = () => resolve(req.result ? (req.result.value as T) : null);
      req.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    });
  } catch {
    return null;
  }
}

// ── Outbox / Sync Queue operations ──────────────────────────────

export async function enqueueOfflineSale(sale: Omit<OfflineSaleQueueItem, 'status' | 'retry_count'>): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction('sales_queue', 'readwrite');
  const queueItem: OfflineSaleQueueItem = {
    ...sale,
    status: 'pending',
    retry_count: 0,
  };
  tx.objectStore('sales_queue').put(queueItem);
  return new Promise((res, rej) => {
    tx.oncomplete = () => {
      notifyQueueListeners();
      res();
    };
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('Offline sale queue transaction aborted'));
  });
}

/**
 * A sale and ALL of its offline inventory deductions are one IndexedDB
 * readwrite transaction. Never report a financial offline capture as saved
 * until both object stores have committed. Legacy queue rows are NOT replayed
 * or migrated by this helper.
 */
export async function enqueueOfflineSaleWithMovements(
  sale: Omit<OfflineSaleQueueItem, 'status' | 'retry_count'>,
): Promise<void> {
  const branchId = typeof sale.payload?.p_branch_id === 'string'
    ? sale.payload.p_branch_id.trim() : '';
  const warehouseId = typeof sale.payload?.p_warehouse_id === 'string'
    ? sale.payload.p_warehouse_id.trim() : '';
  const operatorId = typeof sale.created_by_user_id === 'string'
    ? sale.created_by_user_id.trim() : '';
  const invoice = typeof sale.invoice_number === 'string' ? sale.invoice_number.trim() : '';
  const rawItems = sale.payload?.p_items;
  if (!sale.id?.trim() || !sale.client_id?.trim() || !invoice || !operatorId ||
      !branchId || !warehouseId || !Array.isArray(rawItems) ||
      rawItems.length === 0 || rawItems.length > 1000) {
    throw new Error('OFFLINE_SALE_ATOMIC_CAPTURE_SCOPE_INVALID');
  }

  const movements: LocalStockMovement[] = rawItems.map((line: unknown, index: number) => {
    if (!line || typeof line !== 'object') {
      throw new Error('OFFLINE_SALE_ATOMIC_CAPTURE_ITEM_INVALID');
    }
    const item = line as { product_id?: unknown; quantity?: unknown };
    const productId = typeof item.product_id === 'string' ? item.product_id.trim() : '';
    const quantity = Number(item.quantity);
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('OFFLINE_SALE_ATOMIC_CAPTURE_ITEM_INVALID');
    }
    return {
      id: `mov_${sale.id}_${index}`,
      productId,
      branchId,
      warehouseId,
      quantityDelta: -quantity,
      reason: 'sale',
      referenceId: sale.id,
      createdAt: sale.created_at,
      synced: false,
    };
  });

  const db = await openOfflineDb();
  const queueItem: OfflineSaleQueueItem = {
    ...sale,
    created_by_user_id: operatorId,
    status: 'pending',
    retry_count: 0,
    payload: {
      ...sale.payload,
      p_branch_id: branchId,
      p_warehouse_id: warehouseId,
      p_client_operation_key: String(sale.payload.p_client_operation_key || sale.id),
    },
  };

  await new Promise<void>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(['sales_queue', 'local_stock_movements'], 'readwrite');
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('OFFLINE_SALE_ATOMIC_CAPTURE_FAILED'));
    tx.onabort = () => reject(tx.error || new Error('OFFLINE_SALE_ATOMIC_CAPTURE_ABORTED'));
    // A write transaction serializes concurrent captures from multiple tabs.
    // Check both the invoice and client operation key INSIDE the transaction:
    // different random local IDs must not queue the same offline payment twice.
    const queueStore = tx.objectStore('sales_queue');
    const scan = queueStore.getAll();
    scan.onsuccess = () => {
      const prior = (scan.result || []) as OfflineSaleQueueItem[];
      const operationKey = String(queueItem.payload.p_client_operation_key || '');
      const alreadyCaptured = prior.some((row) =>
        row.id === queueItem.id || (
          row.payload?.p_branch_id === branchId && (
            String(row.payload?.p_client_operation_key || '') === operationKey ||
            String(row.payload?.p_invoice_number || row.invoice_number || '') === invoice
          )
        ),
      );
      if (alreadyCaptured) {
        reject(new Error('OFFLINE_SALE_DUPLICATE_LOCAL_CAPTURE'));
        tx.abort();
        return;
      }
      try {
        // add(), not put(), also fails closed on a same-ID collision.
        queueStore.add(queueItem);
        const movementStore = tx.objectStore('local_stock_movements');
        for (const movement of movements) movementStore.add(movement);
      } catch (error) {
        try { tx.abort(); } catch { /* transaction may already be inactive */ }
        reject(error);
      }
    };
    scan.onerror = () => {
      reject(scan.error || new Error('OFFLINE_SALE_ATOMIC_SCAN_FAILED'));
      try { tx.abort(); } catch { /* transaction may already be inactive */ }
    };
  });
  notifyQueueListeners();
}

export async function getPendingSalesCount(): Promise<number> {
  try {
    const db = await openOfflineDb();
    return await new Promise<number>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction('sales_queue', 'readonly');
      } catch (error) {
        reject(error);
        return;
      }
      const req = tx.objectStore('sales_queue').getAll();
      req.onsuccess = () => {
        const items = (req.result as OfflineSaleQueueItem[]) || [];
        // A persisted "syncing" row is still pending financial confirmation.
        // Counting it also prevents a crash/reload from making the queue appear empty.
        resolve(items.filter((i) => i.status !== 'synced').length);
      };
      req.onerror = () => resolve(0);
      tx.onabort = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

export async function getAllOfflineSales(): Promise<OfflineSaleQueueItem[]> {
  try {
    const db = await openOfflineDb();
    return await new Promise<OfflineSaleQueueItem[]>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction('sales_queue', 'readonly');
      } catch (error) {
        reject(error);
        return;
      }
      const req = tx.objectStore('sales_queue').getAll();
      req.onsuccess = () => resolve((req.result as OfflineSaleQueueItem[]) || []);
      req.onerror = () => resolve([]);
      tx.onabort = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/**
 * Financial synchronization must not mistake an IndexedDB read failure for
 * an empty outbox. UI convenience reads retain their legacy tolerant behavior.
 */
export async function getAllOfflineSalesStrict(): Promise<OfflineSaleQueueItem[]> {
  return dbGetAllStrict<OfflineSaleQueueItem>('sales_queue');
}

export async function updateOfflineSaleStatus(
  id: string,
  status: OfflineSaleQueueItem['status'],
  error?: string
): Promise<void> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction('sales_queue', 'readwrite');
    const store = tx.objectStore('sales_queue');
    const req = store.get(id);
    req.onsuccess = () => {
      const item = req.result as OfflineSaleQueueItem | undefined;
      if (item) {
        item.status = status;
        if (error) item.error = error;
        else if (status !== 'failed') delete item.error;
        if (status === 'failed') item.retry_count = (item.retry_count || 0) + 1;
        store.put(item);
      }
    };
    tx.oncomplete = () => {
      notifyQueueListeners();
    };
  } catch (e) {
    console.warn('[OfflineDB] update sale error', e);
  }
}

export async function removeOfflineSale(id: string): Promise<void> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction('sales_queue', 'readwrite');
    tx.objectStore('sales_queue').delete(id);
    tx.oncomplete = () => {
      notifyQueueListeners();
    };
  } catch (e) {
    console.warn('[OfflineDB] remove sale error', e);
  }
}

/**
 * Strict financial dequeue: callers awaiting server-committed sales must
 * know whether the IndexedDB delete transaction actually committed.
 * The legacy convenience remover intentionally remains unchanged for now.
 */
export async function removeOfflineSaleStrict(id: string): Promise<void> {
  const saleId = typeof id === 'string' ? id.trim() : '';
  if (!saleId) throw new Error('OFFLINE_SALE_ID_REQUIRED_FOR_DEQUEUE');
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction('sales_queue', 'readwrite');
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('OFFLINE_SALE_DEQUEUE_FAILED'));
    tx.onabort = () => reject(tx.error || new Error('OFFLINE_SALE_DEQUEUE_ABORTED'));
    try {
      tx.objectStore('sales_queue').delete(saleId);
    } catch (error) {
      try { tx.abort(); } catch { /* no active transaction */ }
      reject(error);
    }
  });
  notifyQueueListeners();
}

/**
 * After an authoritative *server* commit, delete this invoice and only its
 * local inventory deductions in ONE IndexedDB transaction. A power cut or
 * quota error must retain BOTH records so idempotent replay is safe.
 * This function never contacts the server or prints an old ticket.
 */
export async function finalizeConfirmedOfflineSale(
  saleId: string,
  branchId: string,
  invoiceNumber: string,
): Promise<void> {
  const id = typeof saleId === 'string' ? saleId.trim() : '';
  const branch = typeof branchId === 'string' ? branchId.trim() : '';
  const invoice = typeof invoiceNumber === 'string' ? invoiceNumber.trim() : '';
  if (!id || !branch || !invoice) {
    throw new Error('OFFLINE_SALE_SCOPE_REQUIRED_FOR_FINALIZE');
  }
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(['sales_queue', 'local_stock_movements'], 'readwrite');
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('OFFLINE_SALE_FINALIZE_FAILED'));
    tx.onabort = () => reject(tx.error || new Error('OFFLINE_SALE_FINALIZE_ABORTED'));

    const queueStore = tx.objectStore('sales_queue');
    const movementStore = tx.objectStore('local_stock_movements');
    let queueRows: OfflineSaleQueueItem[] | null = null;
    let movements: LocalStockMovement[] | null = null;

    const abortWith = (error: unknown) => {
      reject(error);
      try { tx.abort(); } catch { /* already aborted */ }
    };
    const completeReads = () => {
      if (!queueRows || !movements) return;
      try {
        const sale = queueRows.find(row => row.id === id);
        if (!sale) throw new Error('OFFLINE_SALE_NOT_FOUND_FOR_FINALIZE');
        const capturedBranch = String(sale.payload?.p_branch_id || '').trim();
        const capturedInvoice = String(
          sale.payload?.p_invoice_number || sale.invoice_number || '',
        ).trim();
        if (capturedBranch !== branch || capturedInvoice !== invoice) {
          throw new Error('OFFLINE_SALE_FINALIZE_SCOPE_MISMATCH');
        }
        const warehouse = String(sale.payload?.p_warehouse_id || '').trim();
        const ids = saleMovementIdsForCleanup(
          movements, queueRows, id, invoice, branch,
        );
        // Do not remove a movement from another warehouse accidentally, even
        // when a historical invoice number was reused inside this branch.
        const toRemove = new Set(ids);
        if (warehouse && movements.some(m => toRemove.has(m.id)
          && m.warehouseId && m.warehouseId !== warehouse)) {
          throw new Error('OFFLINE_SALE_FINALIZE_WAREHOUSE_MISMATCH');
        }
        for (const movementId of ids) movementStore.delete(movementId);
        queueStore.delete(id);
      } catch (error) {
        abortWith(error);
      }
    };
    try {
      const queued = queueStore.getAll();
      const localMovements = movementStore.getAll();
      queued.onsuccess = () => {
        queueRows = (queued.result as OfflineSaleQueueItem[]) || [];
        completeReads();
      };
      localMovements.onsuccess = () => {
        movements = (localMovements.result as LocalStockMovement[]) || [];
        completeReads();
      };
      queued.onerror = () =>
        abortWith(queued.error || new Error('OFFLINE_SALE_FINALIZE_READ_FAILED'));
      localMovements.onerror = () =>
        abortWith(localMovements.error || new Error('OFFLINE_SALE_FINALIZE_READ_FAILED'));
    } catch (error) {
      abortWith(error);
    }
  });
  notifyQueueListeners();
}

// ── Queue Change Event Listeners ─────────────────────────────────

type QueueListener = (pendingCount: number) => void;
const queueListeners: Set<QueueListener> = new Set();

export function subscribeToQueueChanges(listener: QueueListener): () => void {
  queueListeners.add(listener);
  // initial broadcast
  void getPendingSalesCount().then((count) => listener(count));
  return () => {
    queueListeners.delete(listener);
  };
}

function notifyQueueListeners() {
  void getPendingSalesCount().then((count) => {
    queueListeners.forEach((l) => l(count));
  });
}
