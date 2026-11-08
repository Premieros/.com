import { dbGetAll, dbGetAllStrict, dbPut } from './LocalDatabase';
import { enqueueOfflineSaleWithMovements, finalizeConfirmedOfflineSale } from '@/core/offline/offlineStorage';
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

    // Both the pending sale and every local stock movement are saved in ONE
    // IndexedDB transaction; a crash cannot strand partial deductions.
    await enqueueOfflineSaleWithMovements(queueItem);

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
    const queue = await dbGetAllStrict<OfflineSaleQueueItem>('sales_queue');
    const queued = queue.find(s => s.id === id);
    if (!queued) return;
    const branchId = String(queued.payload.p_branch_id || '').trim();
    if (!branchId) throw new Error('OFFLINE_SALE_SCOPE_REQUIRED_FOR_CLEANUP');
    // Both stock deductions and the confirmed invoice disappear atomically.
    await finalizeConfirmedOfflineSale(id, branchId, invoiceNumber);
  }
}
