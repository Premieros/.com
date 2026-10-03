/**
 * Offline POS Manager
 * Handles local caching of products/settings, queueing offline transactions,
 * and background / on-demand syncing when internet connection is restored.
 */
import type { ProcessSalePayload } from '../services/payment';
import type { Product, Category } from '@/lib/types';
import { offlineSyncEngine } from '@/core/offline/syncEngine';
import { removeOfflineSale, getPendingSalesCount } from '@/core/offline/offlineStorage';
import { ProductRepository } from '@/core/repositories/ProductRepository';

const OFFLINE_QUEUE_KEY = 'pos_offline_sales_queue_v1';
const OFFLINE_PRODUCTS_CACHE_KEY = 'pos_offline_products_cache_v1';
const OFFLINE_CATEGORIES_CACHE_KEY = 'pos_offline_categories_cache_v1';

export interface QueuedSale {
  localId: string;
  payload: ProcessSalePayload;
  queuedAt: string;
  synced: boolean;
  syncError?: string;
}

let cachedPendingCount = 0;
// Subscribe to authoritative IndexedDB sync engine changes
offlineSyncEngine.subscribe((status) => {
  cachedPendingCount = status.pendingCount;
});

export const offlinePosManager = {
  // 1. Local Cache of Catalog
  saveCatalogCache(branchId: string, products: Product[], categories: Category[]) {
    try {
      localStorage.setItem(`${OFFLINE_PRODUCTS_CACHE_KEY}_${branchId}`, JSON.stringify(products));
      localStorage.setItem(`${OFFLINE_CATEGORIES_CACHE_KEY}_${branchId}`, JSON.stringify(categories));
    } catch (e) {
      console.warn('Failed to cache catalog in localStorage', e);
    }
    // Also persist into authoritative IndexedDB product repository
    void ProductRepository.cacheCatalog(branchId, products, categories);
  },

  getCatalogCache(branchId: string): { products: Product[]; categories: Category[] } | null {
    try {
      const p = localStorage.getItem(`${OFFLINE_PRODUCTS_CACHE_KEY}_${branchId}`);
      const c = localStorage.getItem(`${OFFLINE_CATEGORIES_CACHE_KEY}_${branchId}`);
      if (p && c) {
        return {
          products: JSON.parse(p),
          categories: JSON.parse(c),
        };
      }
    } catch (e) {
      console.warn('Failed to read cached catalog', e);
    }
    return null;
  },

  // 2. Queue Operations (backed by authoritative IndexedDB queue)
  getQueue(): QueuedSale[] {
    try {
      const data = localStorage.getItem(OFFLINE_QUEUE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  getPendingCount(): number {
    return cachedPendingCount || offlineSyncEngine.getStatus().pendingCount;
  },

  async refreshPendingCountAsync(): Promise<number> {
    const count = await getPendingSalesCount();
    cachedPendingCount = count;
    return count;
  },

  enqueueSale(payload: ProcessSalePayload): QueuedSale {
    const queue = this.getQueue();
    const queuedItem: QueuedSale = {
      localId: `offline_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      payload,
      queuedAt: new Date().toISOString(),
      synced: false,
    };
    queue.push(queuedItem);
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.error('Failed to store offline sale in localStorage', e);
    }
    return queuedItem;
  },

  removeSale(localId: string) {
    const queue = this.getQueue().filter((q) => q.localId !== localId);
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.error(e);
    }
    void removeOfflineSale(localId);
  },

  clearSyncedSales() {
    const queue = this.getQueue().filter((q) => !q.synced);
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.error(e);
    }
  },

  // 3. Sync Process (delegates to the authoritative sync engine)
  async syncAllPending(onProgress?: (synced: number, total: number) => void): Promise<{ success: number; failed: number; errors: string[] }> {
    const result = await offlineSyncEngine.syncAll();
    const errors: string[] = [];
    if (result.failedCount > 0) {
      const status = offlineSyncEngine.getStatus();
      if (status.lastError) errors.push(status.lastError);
    }
    if (onProgress) {
      onProgress(result.successCount, result.successCount + result.failedCount);
    }
    return {
      success: result.successCount,
      failed: result.failedCount,
      errors,
    };
  },
};
