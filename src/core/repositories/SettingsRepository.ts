import { dbGet, dbPut, getLocalDb } from './LocalDatabase';
import type { Settings, BranchSettings } from '@/lib/types';

export class SettingsRepository {
  /** Replace only the authenticated user's cached rows. Never clear the
   * entire store: other users and unrelated offline settings share it.
   * The localStorage snapshot is published synchronously, and IndexedDB
   * deletes obsolete branch keys and writes replacements in one transaction.
   */
  public static async replaceUserSnapshot(
    userId: string,
    settings: Settings | null,
    branchMap: Record<string, BranchSettings>,
  ): Promise<void> {
    if (!userId) return;
    const globalKey = `global_settings:${userId}`;
    const branchPrefix = `branch_settings:${userId}:`;
    try {
      if (typeof localStorage !== 'undefined') {
        if (settings) localStorage.setItem(`premier:cached_settings:${userId}`, JSON.stringify(settings));
        else localStorage.removeItem(`premier:cached_settings:${userId}`);
        localStorage.setItem(`premier:cached_branch_settings_map:${userId}`, JSON.stringify(branchMap));
        localStorage.removeItem('premier:cached_settings');
        localStorage.removeItem('premier:cached_branch_settings_map');
        for (let index = localStorage.length - 1; index >= 0; index--) {
          const key = localStorage.key(index);
          if (key?.startsWith('premier:allow_negative_stock:')) localStorage.removeItem(key);
        }
      }
    } catch { /* cache unavailable */ }
    try {
      const db = await getLocalDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('system_settings', 'readwrite');
        const store = tx.objectStore('system_settings');
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            if (typeof cursor.key === 'string' && (cursor.key === globalKey || cursor.key.startsWith(branchPrefix)
              || cursor.key === 'global_settings' || cursor.key.startsWith('branch_settings_'))) {
              cursor.delete();
            }
            cursor.continue();
            return;
          }
          if (settings) store.put({ key: globalKey, value: settings });
          for (const [branchId, row] of Object.entries(branchMap)) {
            store.put({ key: branchPrefix + branchId, value: row });
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (error) {
      console.warn('Failed to replace scoped settings snapshot:', error);
    }
  }

  public static async getGlobalSettings(userId: string): Promise<Settings | null> {
    if (!userId) return null;
    try {
      const row = await dbGet<{ key: string; value: Settings }>('system_settings', `global_settings:${userId}`);
      if (row?.value) {
        return row.value;
      }
    } catch {
      // IndexedDB might not be available or initialized yet
    }

    if (typeof localStorage !== 'undefined') {
      try {
        const cached = localStorage.getItem(`premier:cached_settings:${userId}`);
        if (cached) {
          return JSON.parse(cached) as Settings;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  public static async saveGlobalSettings(settings: Settings, userId: string): Promise<void> {
    if (!userId) return;
    try {
      await dbPut('system_settings', { key: `global_settings:${userId}`, value: settings });
    } catch (e) {
      console.warn('Failed to save global settings to IndexedDB:', e);
    }
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(`premier:cached_settings:${userId}`, JSON.stringify(settings));
      } catch {
        // ignore
      }
    }
  }

  public static async getBranchSettings(branchId: string, userId: string): Promise<BranchSettings | null> {
    if (!userId) return null;
    try {
      const row = await dbGet<{ key: string; value: BranchSettings }>('system_settings', `branch_settings:${userId}:${branchId}`);
      if (row?.value) {
        return row.value;
      }
    } catch {
      // ignore
    }

    if (typeof localStorage !== 'undefined') {
      try {
        const cachedMap = localStorage.getItem(`premier:cached_branch_settings_map:${userId}`);
        if (cachedMap) {
          const map = JSON.parse(cachedMap) as Record<string, BranchSettings>;
          const branch = map[branchId];
          if (branch) return branch;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  public static async saveBranchSettings(branchId: string, settings: BranchSettings, userId: string): Promise<void> {
    if (!userId) return;
    try {
      await dbPut('system_settings', { key: `branch_settings:${userId}:${branchId}`, value: settings });
    } catch (e) {
      console.warn('Failed to save branch settings to IndexedDB:', e);
    }
    if (typeof localStorage !== 'undefined') {
      try {
        const cacheKey = `premier:cached_branch_settings_map:${userId}`;
        const cachedMap = localStorage.getItem(cacheKey);
        const map = cachedMap ? (JSON.parse(cachedMap) as Record<string, BranchSettings>) : {};
        map[branchId] = settings;
        localStorage.setItem(cacheKey, JSON.stringify(map));
      } catch {
        // ignore
      }
    }
  }
}
