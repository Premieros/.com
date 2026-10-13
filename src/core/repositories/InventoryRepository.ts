import { dbGetAll, dbGetAllStrict, dbPut, dbDelete } from './LocalDatabase';
import type { LocalStockMovement, CachedStockEntry } from './types';
import type { OfflineSaleQueueItem } from '@/core/offline/offlineStorage';
import { getUnrecordedQueuedSaleDeductions, saleMovementIdsForCleanup } from './stockProjection';

export class InventoryRepository {
  /**
   * Record a local stock movement in the local ledger (e.g. -2 for Sale while offline).
   * Does NOT blindly overwrite product quantity.
   */
  public static async recordLocalMovement(
    movement: Omit<LocalStockMovement, 'synced'> & { synced?: boolean },
  ): Promise<void> {
    const fullMovement: LocalStockMovement = {
      ...movement,
      synced: movement.synced ?? false,
    };
    await dbPut('local_stock_movements', fullMovement);
  }

  /**
   * Calculate effective available stock:
   * (Last known Server Stock Snapshot) - (Sum of Unsynced Local Deductions from local ledger and sales queue)
   */
  public static async getEffectiveAvailableStock(productId: string, branchId: string): Promise<number> {
    const stockKey = `${branchId}_${productId}`;
    const allBalances = await dbGetAll<CachedStockEntry>('stock_balances');
    const balanceEntry = allBalances.find((b) => b.id === stockKey || (b.productId === productId && b.branchId === branchId));

    let baseQuantity = balanceEntry ? Number(balanceEntry.serverQuantity) || 0 : 0;

    // If not found in stock_balances, check fallback stock_map store
    if (!balanceEntry) {
      const stockMapRows = await dbGetAll<{ productId: string; quantity: number; branch_id?: string }>('stock_map');
      const fallbackRow = stockMapRows.find((r) => r.productId === productId && (!r.branch_id || r.branch_id === branchId));
      if (fallbackRow) {
        baseQuantity = Number(fallbackRow.quantity) || 0;
      }
    }

    // Sum uncommitted local movements
    const allMovements = await dbGetAll<LocalStockMovement>('local_stock_movements');
    const localMovementDeltas = allMovements
      .filter((m) => m.productId === productId && m.branchId === branchId && !m.synced)
      .reduce((sum, m) => sum + Number(m.quantityDelta || 0), 0);

    // Compare per branch and product: a partially persisted multi-item sale
    // must still deduct items whose local movement was never written.
    const salesQueue = await dbGetAll<OfflineSaleQueueItem>('sales_queue');
    const missing = getUnrecordedQueuedSaleDeductions(branchId, salesQueue, allMovements);
    return baseQuantity + localMovementDeltas - (missing[productId] || 0);
  }

  /**
   * Get effective stock map for an entire branch
   */
  public static async getBranchStockMap(branchId: string): Promise<Record<string, number>> {
    const stockMap: Record<string, number> = {};

    // 1. Base from stock_balances
    const allBalances = await dbGetAll<CachedStockEntry>('stock_balances');
    const branchBalances = allBalances.filter((b) => b.branchId === branchId);
    for (const b of branchBalances) {
      stockMap[b.productId] = Number(b.serverQuantity) || 0;
    }

    // 2. Fallback from stock_map store for any missing products
    const stockMapRows = await dbGetAll<{ productId: string; quantity: number; branch_id?: string }>('stock_map');
    for (const r of stockMapRows) {
      if ((!r.branch_id || r.branch_id === branchId) && stockMap[r.productId] === undefined) {
        stockMap[r.productId] = Number(r.quantity) || 0;
      }
    }

    // 3. Subtract uncommitted local movements
    const allMovements = await dbGetAll<LocalStockMovement>('local_stock_movements');
    const branchMovements = allMovements.filter((m) => m.branchId === branchId && !m.synced);
    for (const m of branchMovements) {
      stockMap[m.productId] = (stockMap[m.productId] || 0) + Number(m.quantityDelta || 0);
    }

    // 4. Deduct only queued quantities not represented by unsynced movements,
    // including any crash-partial multi-item sale movements.
    const salesQueue = await dbGetAll<OfflineSaleQueueItem>('sales_queue');
    const missing = getUnrecordedQueuedSaleDeductions(branchId, salesQueue, allMovements);
    for (const [productId, quantity] of Object.entries(missing)) {
      stockMap[productId] = (stockMap[productId] || 0) - quantity;
    }

    return stockMap;
  }

  /**
   * Update the authoritative server stock snapshot when online data is fetched
   */
  public static async updateServerStockSnapshot(branchId: string, stockMap: Record<string, number>): Promise<void> {
    const now = new Date().toISOString();
    for (const [productId, quantity] of Object.entries(stockMap)) {
      const entry: CachedStockEntry = {
        id: `${branchId}_${productId}`,
        branchId,
        productId,
        serverQuantity: Number(quantity) || 0,
        lastSyncedAt: now,
      };
      await dbPut('stock_balances', entry);
    }
  }

  /**
   * Set or adjust a product's local stock directly (used in testing and manual adjustments)
   */
  public static async setLocalStock(productId: string, branchId: string, quantity: number): Promise<void> {
    const entry: CachedStockEntry = {
      id: `${branchId}_${productId}`,
      branchId,
      productId,
      serverQuantity: Number(quantity) || 0,
      lastSyncedAt: new Date().toISOString(),
    };
    await dbPut('stock_balances', entry);
  }

  /** Clear ONLY the confirmed sale's local deductions. Fail closed if the
   * branch or IndexedDB read is missing; never drop an outbox after an
   * assumed-empty movement store read.
   */
  public static async markSaleMovementsSynced(
    saleId: string,
    invoiceNumber: string,
    branchId: string,
  ): Promise<void> {
    if (!saleId || !branchId) throw new Error('OFFLINE_SALE_SCOPE_REQUIRED_FOR_CLEANUP');
    const [allMovements, queuedSales] = await Promise.all([
      dbGetAllStrict<LocalStockMovement>('local_stock_movements'),
      dbGetAllStrict<OfflineSaleQueueItem>('sales_queue'),
    ]);
    const movementIds = saleMovementIdsForCleanup(
      allMovements, queuedSales, saleId, invoiceNumber, branchId,
    );
    for (const id of movementIds) {
      await dbDelete('local_stock_movements', id);
    }
  }

  /**
   * Get all unsynced local movements
   */
  public static async getPendingMovements(): Promise<LocalStockMovement[]> {
    const all = await dbGetAll<LocalStockMovement>('local_stock_movements');
    return all.filter((m) => !m.synced);
  }
}
