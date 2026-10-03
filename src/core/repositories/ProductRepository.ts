import { supabase } from '@/api';
import { dbGetAll, dbReplaceAll, getLocalDb } from './LocalDatabase';
import type { Product, Category } from '@/lib/types';

export class ProductRepository {
  /**
   * Get products with Stale-While-Revalidate:
   * Returns locally cached products immediately, then fetches fresh data in background if online.
   */
  public static async getProducts(
    branchId?: string,
    options: { forceNetwork?: boolean; onBackgroundUpdate?: (products: Product[]) => void } = {}
  ): Promise<Product[]> {
    const cached = await this.getLocalProducts(branchId);

    // If online, perform background or forced revalidation
    const shouldFetchNetwork = options.forceNetwork || typeof navigator === 'undefined' || navigator.onLine;

    if (shouldFetchNetwork) {
      const fetchPromise = this.fetchAndCacheProducts(branchId).catch((err) => {
        console.warn('[ProductRepository] Network fetch error, using cache:', err);
        return cached;
      });

      if (options.forceNetwork || cached.length === 0) {
        return await fetchPromise;
      } else {
        // Stale-while-revalidate in background
        void fetchPromise.then((fresh) => {
          if (options.onBackgroundUpdate && fresh.length > 0) {
            options.onBackgroundUpdate(fresh);
          }
        });
      }
    }

    return cached;
  }

  public static async getLocalProducts(branchId?: string): Promise<Product[]> {
    const all = await dbGetAll<Product>('products');
    if (!branchId) return all;
    return all.filter((p) => p.branch_id === branchId || !p.branch_id);
  }

  public static async getCategories(
    branchId?: string,
    options: { forceNetwork?: boolean } = {}
  ): Promise<Category[]> {
    const cached = await dbGetAll<Category>('categories');
    const filtered = branchId ? cached.filter((c) => c.branch_id === branchId || !c.branch_id) : cached;

    if (options.forceNetwork || (filtered.length === 0 && (typeof navigator === 'undefined' || navigator.onLine))) {
      return await this.fetchAndCacheCategories(branchId);
    }
    return filtered;
  }

  public static async getProductByBarcode(barcode: string, branchId?: string): Promise<Product | null> {
    const trimmed = barcode.trim();
    if (!trimmed) return null;

    try {
      const db = await getLocalDb();
      return await new Promise<Product | null>((resolve) => {
        const tx = db.transaction('products', 'readonly');
        const store = tx.objectStore('products');
        const index = store.index('barcode');
        const req = index.get(trimmed);
        req.onsuccess = () => {
          const prod = (req.result as Product) || null;
          if (prod && branchId && prod.branch_id && prod.branch_id !== branchId) {
            resolve(null);
          } else {
            resolve(prod);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch {
      // Fallback in-memory search
      const prods = await this.getLocalProducts(branchId);
      return prods.find((p) => p.barcode === trimmed || p.sku === trimmed) || null;
    }
  }

  public static async cacheCatalog(branchId: string, products: Product[], categories: Category[]): Promise<void> {
    try {
      await Promise.all([
        dbReplaceAll('products', products),
        dbReplaceAll('categories', categories),
      ]);
    } catch (err) {
      console.warn('[ProductRepository] Failed to cache catalog', err);
    }
  }

  private static async fetchAndCacheProducts(branchId?: string): Promise<Product[]> {
    let q = supabase.from('products').select('*').eq('is_active', true);
    if (branchId) {
      q = q.eq('branch_id', branchId);
    }
    const { data, error } = await q.order('name');
    if (error) throw error;
    const prods = (data as Product[]) || [];
    if (prods.length > 0) {
      await dbReplaceAll('products', prods);
    }
    return prods;
  }

  private static async fetchAndCacheCategories(branchId?: string): Promise<Category[]> {
    let q = supabase.from('categories').select('*');
    if (branchId) {
      q = q.eq('branch_id', branchId);
    }
    const { data, error } = await q.order('name');
    if (error) throw error;
    const cats = (data as Category[]) || [];
    if (cats.length > 0) {
      await dbReplaceAll('categories', cats);
    }
    return cats;
  }
}
