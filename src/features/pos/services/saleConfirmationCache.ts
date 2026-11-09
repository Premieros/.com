/**
 * Best-effort local cache bookkeeping AFTER the server has confirmed a sale.
 * A failed IndexedDB write must never turn a committed payment into a failure.
 * Synced entries are projections; the server remains the source of truth.
 */
export interface ConfirmedSaleItem {
  product_id?: string | null;
  quantity?: number | null;
}

export interface ConfirmedStockMovement {
  id: string;
  productId: string;
  branchId: string;
  warehouseId: string | null;
  quantityDelta: number;
  reason: 'sale';
  referenceId: string;
  createdAt: string;
  synced: true;
}

export async function cacheConfirmedSaleMovements(input: {
  items: ConfirmedSaleItem[];
  branchId: string;
  warehouseId: string | null;
  saleId: string | null | undefined;
  invoiceNumber: string;
  record: (movement: ConfirmedStockMovement) => Promise<void>;
  onFailure?: (failedCount: number) => void;
}): Promise<{ failedCount: number }> {
  // Stable per-sale identifiers also make server idempotent replays safe
  // for the local projection. Never use a fresh random ID on a replay.
  const identity = input.saleId || input.invoiceNumber;
  let failedCount = 0;
  for (const [index, item] of input.items.entries()) {
    if (!item.product_id) continue;
    try {
      await input.record({
        id: `confirmed-sale:${input.branchId}:${identity}:${index}`,
        productId: item.product_id,
        branchId: input.branchId,
        warehouseId: input.warehouseId,
        quantityDelta: -Number(item.quantity || 0),
        reason: 'sale',
        referenceId: identity,
        createdAt: new Date().toISOString(),
        synced: true,
      });
    } catch {
      // Cache projection needs reconciliation later; the already committed
      // server transaction must still return success to the cashier.
      failedCount++;
    }
  }
  if (failedCount) {
    try { input.onFailure?.(failedCount); }
    catch { /* Diagnostics must not change an already committed sale result. */ }
  }
  return { failedCount };
}
