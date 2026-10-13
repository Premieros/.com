import { supabase } from '@/api';
import { getLocalDb } from './LocalDatabase';
import type { CachedStockEntry } from './types';

export interface WarehouseInventoryRow {
  product_id: string | null;
  branch_id: string | null;
  warehouse_id: string | null;
  quantity: number | string | null;
}

/** Validate all backend rows before persisting ANY snapshot. Never synthesize
 * zero balances for products missing from inventory, and never import another
 * warehouse's data into the selected warehouse.
 */
export function aggregateVerifiedWarehouseRows(
  branchId: string,
  warehouseId: string,
  rows: WarehouseInventoryRow[],
  snapshotAt: string,
): CachedStockEntry[] {
  if (!branchId?.trim() || !warehouseId?.trim() || !Number.isFinite(Date.parse(snapshotAt))) {
    throw new Error('WAREHOUSE_SNAPSHOT_SCOPE_REQUIRED');
  }
  const quantities = new Map<string, number>();
  for (const row of rows) {
    if (row.branch_id !== branchId || row.warehouse_id !== warehouseId
      || !row.product_id?.trim() || row.quantity === null) {
      throw new Error('WAREHOUSE_SNAPSHOT_ROW_SCOPE_MISMATCH');
    }
    const quantity = Number(row.quantity);
    if (!Number.isFinite(quantity)) throw new Error('WAREHOUSE_SNAPSHOT_INVALID_QUANTITY');
    const total = (quantities.get(row.product_id) || 0) + quantity;
    if (!Number.isFinite(total)) throw new Error('WAREHOUSE_SNAPSHOT_INVALID_QUANTITY');
    quantities.set(row.product_id, total);
  }
  return Array.from(quantities, ([productId, serverQuantity]) => ({
    id: JSON.stringify([branchId, warehouseId, productId]),
    branchId, warehouseId, productId, serverQuantity,
    lastSyncedAt: snapshotAt,
  }));
}

/** Replace exactly ONE warehouse's cached rows in ONE IDB transaction.
 * Other warehouses and legacy branch totals are preserved. An abort leaves
 * the previous warehouse snapshot untouched instead of half-refreshed.
 */
export async function replaceWarehouseSnapshots(
  branchId: string,
  warehouseId: string,
  entries: CachedStockEntry[],
): Promise<void> {
  const db = await getLocalDb();
  return new Promise<void>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction('stock_balances', 'readwrite');
      const store = transaction.objectStore('stock_balances');
      const read = store.getAll();
      read.onsuccess = () => {
        const existing = (read.result as CachedStockEntry[]) || [];
        for (const row of existing) {
          if (row.branchId === branchId && row.warehouseId === warehouseId) store.delete(row.id);
        }
        for (const entry of entries) store.put(entry);
      };
      read.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('WAREHOUSE_SNAPSHOT_WRITE_FAILED'));
      transaction.onabort = () => reject(transaction.error || new Error('WAREHOUSE_SNAPSHOT_WRITE_ABORTED'));
    } catch (error) {
      if (typeof transaction !== 'undefined') transaction.abort();
      reject(error);
    }
  });
}

const PAGE_SIZE = 500;
const MAX_PAGES = 100;

/** Fetch a permission-scoped, warehouse-specific inventory projection while
 * online. Query ALL pages before touching local cache; a failed/partial
 * response must never overwrite a previously stored complete snapshot.
 *
 * A zero-row response results in NO fabricated product balance; it clears
 * any previous snapshots for that warehouse so they become 'unknown'.
 */
export async function refreshVerifiedWarehouseStock(
  branchId: string,
  warehouseId: string,
): Promise<{ rows: number; products: number }> {
  if (!branchId?.trim() || !warehouseId?.trim()) {
    throw new Error('WAREHOUSE_SNAPSHOT_SCOPE_REQUIRED');
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('WAREHOUSE_SNAPSHOT_ONLINE_REQUIRED');
  }

  const records: WarehouseInventoryRow[] = [];
  let complete = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from('inventory')
      .select('product_id,branch_id,warehouse_id,quantity')
      .eq('branch_id', branchId)
      .eq('warehouse_id', warehouseId)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error('WAREHOUSE_SNAPSHOT_FETCH_FAILED: ' + error.message);
    if (!Array.isArray(data)) throw new Error('WAREHOUSE_SNAPSHOT_FETCH_FAILED');
    records.push(...(data as WarehouseInventoryRow[]));
    if (data.length < PAGE_SIZE) { complete = true; break; }
  }
  if (!complete) throw new Error('WAREHOUSE_SNAPSHOT_PAGE_LIMIT');

  const entries = aggregateVerifiedWarehouseRows(
    branchId, warehouseId, records, new Date().toISOString(),
  );
  await replaceWarehouseSnapshots(branchId, warehouseId, entries);
  return { rows: records.length, products: entries.length };
}
