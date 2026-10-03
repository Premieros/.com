import { dbGetAll, dbPut, dbDelete } from './LocalDatabase';
import { InventoryRepository } from './InventoryRepository';
import type { OfflineSaleQueueItem } from '@/core/offline/offlineStorage';
import type { ProcessSalePayload } from '@/features/pos/services/payment';

export class SalesRepository {
  /**
   * Save an offline sale into the authoritative local outbox and record its
   * inventory deductions in the local ledger.
   */
  public static async enqueueSale(
    payload: ProcessSalePayload,
    originatingUserId: string
  ): Promise<string> {
    const id = `offline_sale_${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const queueItem: OfflineSaleQueueItem & { created_by_user_id: string } = {
      id,
      client_id: id,
      invoice_number: payload.p_invoice_number,
      created_at: now,
      payload: payload as unknown as Record<string, unknown>,
      status: 'pending',
      retry_count: 0,
      created_by_user_id: originatingUserId,
    };

    // 1. Put in IndexedDB sales_queue
    await dbPut('sales_queue', queueItem);

    // 2. Record local stock deduction in local movement ledger so available stock is updated immediately
    if (Array.isArray(payload.p_items) && payload.p_items.length > 0 && payload.p_branch_id) {
      for (const item of payload.p_items) {
        if (item.product_id) {
          await InventoryRepository.recordLocalMovement({
            id: `mov_${id}_${item.product_id}_${Math.random().toString(36).slice(2, 6)}`,
            productId: item.product_id,
            branchId: payload.p_branch_id,
            warehouseId: payload.p_warehouse_id,
            quantityDelta: -Math.abs(Number(item.quantity) || 1),
            reason: 'sale',
            referenceId: payload.p_invoice_number,
            createdAt: now,
          });
        }
      }
    }

    return id;
  }

  public static async getPendingSales(): Promise<OfflineSaleQueueItem[]> {
    const all = await dbGetAll<OfflineSaleQueueItem>('sales_queue');
    return all.filter((s) => s.status !== 'synced');
  }

  public static async getAllSales(): Promise<OfflineSaleQueueItem[]> {
    return await dbGetAll<OfflineSaleQueueItem>('sales_queue');
  }

  public static async updateSaleStatus(
    id: string,
    status: OfflineSaleQueueItem['status'],
    error?: string
  ): Promise<void> {
    const all = await dbGetAll<OfflineSaleQueueItem>('sales_queue');
    const item = all.find((s) => s.id === id);
    if (!item) return;

    item.status = status;
    if (error) {
      item.error = error;
      if (status === 'failed') {
        item.retry_count = (item.retry_count || 0) + 1;
      }
    } else if (status !== 'failed') {
      delete item.error;
    }
    await dbPut('sales_queue', item);
  }

  public static async markSaleSynced(id: string, invoiceNumber: string): Promise<void> {
    await dbDelete('sales_queue', id);
    // Mark local inventory movements as reconciled
    await InventoryRepository.markMovementsSynced([invoiceNumber, id]);
  }
}
