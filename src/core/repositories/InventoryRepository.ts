import { dbGetAll, dbPut, dbDelete } from './LocalDatabase';
import type { LocalStockMovement, CachedStockEntry } from './types';
import type { OfflineSaleQueueItem } from '@/core/offline/offlineStorage';

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

    // Also deduct any pending sales in sales_queue that might not have local movements
    const salesQueue = await dbGetAll<OfflineSaleQueueItem>('sales_queue');
    const pendingSales = salesQueue.filter((s) => s.status !== 'synced');
    const movementRefIds = new Set(allMovements.map((m) => m.referenceId));

    let extraUnsyncedSalesDeductions = 0;
    for (const sale of pendingSales) {
      const invoiceNum = String(sale.payload?.p_invoice_number || sale.invoice_number || '');
      // If this sale's invoice is already accounted for in local_stock_movements, avoid double-deducting
      if (invoiceNum && movementRefIds.has(invoiceNum)) continue;

      if (sale.payload?.p_branch_id === branchId && Array.isArray(sale.payload.p_items)) {
        for (const item of sale.payload.p_items as Array<{ product_id: string; quantity: number }>) {
          if (item.product_id === productId) {
            extraUnsyncedSalesDeductions += Number(item.quantity) || 0;
          }
        }
      }
    }

    return baseQuantity + localMovementDeltas - extraUnsyncedSalesDeductions;
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

    // 4. Subtract any pending sales in outbox not yet in local_stock_movements
    const movementRefIds = new Set(allMovements.map((m) => m.referenceId));
    const salesQueue = await dbGetAll<OfflineSaleQueueItem>('sales_queue');
    const pendingSales = salesQueue.filter((s) => s.status !== 'synced');
    for (const sale of pendingSales) {
      const invoiceNum = String(sale.payload?.p_invoice_number || sale.invoice_number || '');
      if (invoiceNum && movementRefIds.has(invoiceNum)) continue;

      if (sale.payload?.p_branch_id === branchId && Array.isArray(sale.payload.p_items)) {
        for (const item of sale.payload.p_items as Array<{ product_id: string; quantity: number }>) {
          stockMap[item.product_id] = (stockMap[item.product_id] || 0) - (Number(item.quantity) || 0);
        }
      }
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

  /**
   * Mark local movements as synced after their corresponding outbox sale/order is confirmed
   */
  public static async markMovementsSynced(referenceIds: string[]): Promise<void> {
    if (referenceIds.length === 0) return;
    const refSet = new Set(referenceIds);
    const allMovements = await dbGetAll<LocalStockMovement>('local_stock_movements');

    for (const mov of allMovements) {
      if (refSet.has(mov.referenceId) || refSet.has(mov.id)) {
        await dbDelete('local_stock_movements', mov.id);
      }
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
