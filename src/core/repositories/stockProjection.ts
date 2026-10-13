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
  // A legacy invoice number can appear more than once (including on another
  // cashier's still-pending sale). Track consumed movement quantities so one
  // movement never suppresses deductions for TWO outbox rows.
  const remainingRecorded = new Map<string, number>();
  const movementKey = (reference: string, product: string) =>
    JSON.stringify([reference, product]);
  for (const movement of movements) {
    if (movement.synced || movement.reason !== 'sale' || movement.branchId !== branchId) continue;
    const recorded = Math.max(0, -Number(movement.quantityDelta || 0));
    if (!recorded) continue;
    const key = movementKey(movement.referenceId, movement.productId);
    remainingRecorded.set(key, (remainingRecorded.get(key) || 0) + recorded);
  }

  const consume = (reference: string, product: string, quantity: number) => {
    if (!reference || quantity <= 0) return 0;
    const key = movementKey(reference, product);
    const taken = Math.min(quantity, remainingRecorded.get(key) || 0);
    remainingRecorded.set(key, (remainingRecorded.get(key) || 0) - taken);
    return taken;
  };

  for (const sale of sales) {
    if (sale.status === 'synced' || sale.payload?.p_branch_id !== branchId) continue;
    const invoice = String(sale.payload.p_invoice_number || sale.invoice_number || '').trim();
    const lines = sale.payload.p_items;
    if (!Array.isArray(lines)) continue;

    const requested: Record<string, number> = {};
    for (const line of lines) {
      if (!line || typeof line !== 'object') continue;
      const item = line as { product_id?: unknown; quantity?: unknown };
      const productId = typeof item.product_id === 'string' ? item.product_id.trim() : '';
      const quantity = Number(item.quantity);
      if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue;
      requested[productId] = (requested[productId] || 0) + quantity;
    }

    for (const [productId, qty] of Object.entries(requested)) {
      // New local movements use unique sale IDs; the invoice fallback supports
      // pre-fix legacy movements but cannot be reused for another queued sale.
      let unrecorded = qty - consume(sale.id, productId, qty);
      if (invoice !== sale.id && unrecorded > 0) {
        unrecorded -= consume(invoice, productId, unrecorded);
      }
      if (unrecorded > 0) missing[productId] = (missing[productId] || 0) + unrecorded;
    }
  }

  return missing;
}

/** Select only the sale's local stock movements, never another branch's.
 * Legacy invoice-based movements are ambiguous if a second outstanding sale
 * has the same invoice in the same branch; preserve them pending reconciliation.
 */
export function saleMovementIdsForCleanup(
  movements: LocalStockMovement[],
  queuedSales: OfflineSaleQueueItem[],
  saleId: string,
  invoiceNumber: string,
  branchId: string,
): string[] {
  if (!saleId || !branchId) throw new Error('OFFLINE_SALE_SCOPE_REQUIRED_FOR_CLEANUP');
  const ambiguousLegacyInvoice = queuedSales.some(s =>
    s.id !== saleId && s.status !== 'synced'
    && s.payload?.p_branch_id === branchId
    && String(s.payload.p_invoice_number || s.invoice_number || '').trim() === invoiceNumber
  );
  return movements
    .filter(m => !m.synced && m.reason === 'sale'
      && m.branchId === branchId
      && (m.referenceId === saleId
        || (!ambiguousLegacyInvoice && invoiceNumber !== '' && m.referenceId === invoiceNumber)))
    .map(m => m.id);
}
