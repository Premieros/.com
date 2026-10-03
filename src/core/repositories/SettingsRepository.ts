import { dbGet, dbPut } from './LocalDatabase';
import type { Settings, BranchSettings } from '@/lib/types';

export class SettingsRepository {
  public static async getGlobalSettings(): Promise<Settings | null> {
    try {
      const row = await dbGet<{ key: string; value: Settings }>('system_settings', 'global_settings');
      if (row?.value) {
        return row.value;
      }
    } catch {
      // IndexedDB might not be available or initialized yet
    }

    if (typeof localStorage !== 'undefined') {
      try {
        const cached = localStorage.getItem('premier:cached_settings');
        if (cached) {
          const parsed = JSON.parse(cached) as Settings;
          const override = localStorage.getItem('premier:allow_negative_stock:company');
          if (override !== null) {
            parsed.allow_negative_stock = override === 'true';
          }
          return parsed;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  public static async saveGlobalSettings(settings: Settings): Promise<void> {
    try {
      await dbPut('system_settings', { key: 'global_settings', value: settings });
    } catch (e) {
      console.warn('Failed to save global settings to IndexedDB:', e);
    }
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('premier:cached_settings', JSON.stringify(settings));
        if (settings.allow_negative_stock !== undefined) {
          localStorage.setItem('premier:allow_negative_stock:company', String(settings.allow_negative_stock));
        }
      } catch {
        // ignore
      }
    }
  }

  public static async getBranchSettings(branchId: string): Promise<BranchSettings | null> {
    try {
      const row = await dbGet<{ key: string; value: BranchSettings }>('system_settings', `branch_settings_${branchId}`);
      if (row?.value) {
        return row.value;
      }
    } catch {
      // ignore
    }

    if (typeof localStorage !== 'undefined') {
      try {
        const cachedMap = localStorage.getItem('premier:cached_branch_settings_map');
        if (cachedMap) {
          const map = JSON.parse(cachedMap) as Record<string, BranchSettings>;
          const branch = map[branchId];
          if (branch) {
            const override = localStorage.getItem(`premier:allow_negative_stock:branch_${branchId}`);
            if (override !== null) {
              branch.allow_negative_stock = override === 'true';
            }
            return branch;
          }
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  public static async saveBranchSettings(branchId: string, settings: BranchSettings): Promise<void> {
    try {
      await dbPut('system_settings', { key: `branch_settings_${branchId}`, value: settings });
    } catch (e) {
      console.warn('Failed to save branch settings to IndexedDB:', e);
    }
    if (typeof localStorage !== 'undefined') {
      try {
        const cachedMap = localStorage.getItem('premier:cached_branch_settings_map');
        const map = cachedMap ? (JSON.parse(cachedMap) as Record<string, BranchSettings>) : {};
        map[branchId] = settings;
        localStorage.setItem('premier:cached_branch_settings_map', JSON.stringify(map));
        if (settings.allow_negative_stock !== undefined) {
          localStorage.setItem(`premier:allow_negative_stock:branch_${branchId}`, String(settings.allow_negative_stock));
        }
      } catch {
        // ignore
      }
    }
  }
}
