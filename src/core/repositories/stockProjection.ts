import type { OfflineSaleQueueItem } from '@/core/offline/offlineStorage';
import type { LocalStockMovement } from './types';

/** Returns queued sale deductions not already represented by unsynced local movements.
 *
 * Outbox writes and per-line movement writes are currently separate IndexedDB
 * transactions. A tab crash between them can leave only SOME item movements.
 * Reconcile per branch + invoice + product, not per invoice alone, to avoid
 * hiding unrecorded items and to avoid cross-branch invoice collisions.
 */
export function getUnrecordedQueuedSaleDeductions(
  branchId: string,
  sales: OfflineSaleQueueItem[],
  movements: LocalStockMovement[],
): Record<string, number> {
  const missing: Record<string, number> = {};

  for (const sale of sales) {
    if (sale.status === 'synced' || sale.payload?.p_branch_id !== branchId) continue;
    const invoice = String(sale.payload.p_invoice_number || sale.invoice_number || '').trim();
    const salesLines = sale.payload.p_items;
    if (!Array.isArray(salesLines)) continue;

    const requested: Record<string, number> = {};
    for (const line of salesLines) {
      if (!line || typeof line !== 'object') continue;
      const item = line as { product_id?: unknown; quantity?: unknown };
      const productId = typeof item.product_id === 'string' ? item.product_id.trim() : '';
      const quantity = Number(item.quantity);
      if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue;
      requested[productId] = (requested[productId] || 0) + quantity;
    }

    for (const [productId, qty] of Object.entries(requested)) {
      const alreadyRecorded = movements
        .filter(m => !m.synced
          && m.reason === 'sale'
          && m.branchId === branchId
          && m.productId === productId
          && (m.referenceId === sale.id || (invoice !== '' && m.referenceId === invoice)))
        .reduce((sum, m) => sum + Math.max(0, -Number(m.quantityDelta || 0)), 0);
      const remainder = Math.max(0, qty - alreadyRecorded);
      if (remainder > 0) missing[productId] = (missing[productId] || 0) + remainder;
    }
  }

  return missing;
}
