import type { OfflineSaleQueueItem } from '@/core/offline/offlineStorage';
import type { CachedStockEntry, LocalStockMovement } from './types';
import { getUnrecordedQueuedSaleDeductions } from './stockProjection';

export type WarehouseStockAvailability =
  | { status: 'known'; quantity: number; snapshotAt: string }
  | { status: 'unknown'; reason:
    | 'WAREHOUSE_SCOPE_REQUIRED'
    | 'WAREHOUSE_STOCK_SNAPSHOT_MISSING'
    | 'WAREHOUSE_STOCK_SNAPSHOT_STALE'
    | 'UNSCOPED_LOCAL_MOVEMENT'
    | 'UNSCOPED_QUEUED_SALE' };

export const DEFAULT_WAREHOUSE_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * A branch-wide quantity is never evidence of inventory in a specific
 * warehouse. Absent/stale warehouse snapshots and pre-pinning movements
 * remain unknown, not zero or available stock from another warehouse.
 */
export function projectWarehouseStock(input: {
  branchId: string;
  warehouseId: string;
  productId: string;
  balances: CachedStockEntry[];
  movements: LocalStockMovement[];
  sales: OfflineSaleQueueItem[];
  now?: number;
  maxAgeMs?: number;
}): WarehouseStockAvailability {
  const { branchId, warehouseId, productId, balances, movements, sales } = input;
  if (!branchId?.trim() || !warehouseId?.trim() || !productId?.trim()) {
    return { status: 'unknown', reason: 'WAREHOUSE_SCOPE_REQUIRED' };
  }
  const snapshot = balances.find(b => b.branchId === branchId
    && b.warehouseId === warehouseId && b.productId === productId);
  if (!snapshot) return { status: 'unknown', reason: 'WAREHOUSE_STOCK_SNAPSHOT_MISSING' };

  const now = input.now ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_WAREHOUSE_SNAPSHOT_MAX_AGE_MS;
  const timestamp = Date.parse(snapshot.lastSyncedAt);
  const serverQuantity = Number(snapshot.serverQuantity);
  if (!Number.isFinite(timestamp) || !Number.isFinite(serverQuantity)
    || !Number.isFinite(maxAgeMs) || maxAgeMs < 0
    || timestamp > now + 5 * 60 * 1000 || now - timestamp > maxAgeMs) {
    return { status: 'unknown', reason: 'WAREHOUSE_STOCK_SNAPSHOT_STALE' };
  }

  const productMovements = movements.filter(m =>
    !m.synced && m.branchId === branchId && m.productId === productId);
  if (productMovements.some(m =>
    typeof m.warehouseId !== 'string' || !m.warehouseId.trim()
    || typeof m.quantityDelta !== 'number' || !Number.isFinite(m.quantityDelta))) {
    return { status: 'unknown', reason: 'UNSCOPED_LOCAL_MOVEMENT' };
  }

  const candidateSales = sales.filter(s => s.status !== 'synced'
    && s.payload?.p_branch_id === branchId);
  for (const sale of candidateSales) {
    const lines = sale.payload?.p_items;
    if (!Array.isArray(lines)) return { status: 'unknown', reason: 'UNSCOPED_QUEUED_SALE' };
    const productLines = lines.filter(line =>
      line && typeof line === 'object'
      && (line as { product_id?: unknown }).product_id === productId);
    if (productLines.length === 0) continue;
    // A corrupt queued quantity must not disappear from reservations while
    // the UI reports the warehouse's remaining stock as known.
    if (productLines.some(line => {
      const raw = (line as { quantity?: unknown }).quantity;
      const quantity = Number(raw);
      return raw === null || raw === undefined || raw === ''
        || !Number.isFinite(quantity) || quantity <= 0;
    }) || typeof sale.payload.p_warehouse_id !== 'string'
      || !sale.payload.p_warehouse_id.trim()) {
      return { status: 'unknown', reason: 'UNSCOPED_QUEUED_SALE' };
    }
  }

  const scopedMovements = productMovements.filter(m => m.warehouseId === warehouseId);
  const scopedSales = candidateSales.filter(s => s.payload?.p_warehouse_id === warehouseId);
  const delta = scopedMovements.reduce((sum, m) => sum + Number(m.quantityDelta || 0), 0);
  if (!Number.isFinite(delta)) {
    return { status: 'unknown', reason: 'UNSCOPED_LOCAL_MOVEMENT' };
  }
  const missing = getUnrecordedQueuedSaleDeductions(branchId, scopedSales, scopedMovements);
  return {
    status: 'known',
    quantity: serverQuantity + delta - (missing[productId] || 0),
    snapshotAt: snapshot.lastSyncedAt,
  };
}
