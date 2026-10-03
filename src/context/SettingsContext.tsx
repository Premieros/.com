import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { applyBrandColor, applyDefaultSurface, applySurfaceColor, brandFromSettingsValue } from '../lib/brandColor';
import { findUiTheme } from '../lib/themes';
import { hasLockedThemePreference, useTheme } from './ThemeContext';
import { hasLockedLanguagePreference, useLanguage } from './LanguageContext';
import { useAuth } from './AuthContext';
import type { Settings, BranchSettings } from '../lib/types';
import { nextCairoClockInstant } from '../lib/businessTime';
import { SettingsRepository } from '@/core/repositories';

export type EffectiveSettings = Settings;

export function mergeEffectiveSettings(global: Settings, branch?: BranchSettings | null): Settings {
  if (!branch) return global;
  return {
    ...global,
    currency: branch.currency ?? global.currency,
    tax_rate: branch.tax_rate ?? global.tax_rate,
    tax_enabled: branch.tax_enabled ?? global.tax_enabled,
    receipt_header: branch.receipt_header ?? global.receipt_header,
    receipt_footer: branch.receipt_footer ?? global.receipt_footer,
    logo_url: branch.logo_url ?? global.logo_url,
    low_stock_threshold: branch.low_stock_threshold ?? global.low_stock_threshold,
    allow_negative_stock: branch.allow_negative_stock ?? global.allow_negative_stock ?? false,
  };
}

interface SettingsContextValue {
  settings: Settings | null;
  loading: boolean;
  branchSettingsMap: Record<string, BranchSettings>;
  effectiveSettings: (branchId?: string | null) => Settings | null;
  refresh: () => Promise<void>;
  save: (patch: Partial<Settings>) => Promise<boolean>;
  saveBranchSettings: (branchId: string, patch: Partial<BranchSettings>) => Promise<boolean>;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

function getInitialCachedSettings(): { settings: Settings | null; branchMap: Record<string, BranchSettings> } {
  try {
    if (typeof localStorage !== 'undefined') {
      const s = localStorage.getItem('premier:cached_settings');
      const b = localStorage.getItem('premier:cached_branch_settings_map');
      return {
        settings: s ? (JSON.parse(s) as Settings) : null,
        branchMap: b ? (JSON.parse(b) as Record<string, BranchSettings>) : {},
      };
    }
  } catch {
    // ignore
  }
  return { settings: null, branchMap: {} };
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const initialCache = getInitialCachedSettings();
  const [settings, setSettings] = useState<Settings | null>(initialCache.settings);
  const [branchSettingsMap, setBranchSettingsMap] = useState<Record<string, BranchSettings>>(initialCache.branchMap);
  const [loading, setLoading] = useState(!initialCache.settings);
  const { applySystemTheme } = useTheme();
  const { applySystemLang } = useLanguage();
  const { session } = useAuth();

  const sessionUserId = session?.user?.id ?? null;

  const refresh = useCallback(async () => {
    if (!sessionUserId) {
      setSettings(null);
      setBranchSettingsMap({});
      setLoading(false);
      return;
    }
    try {
      const [sRes, bRes] = await Promise.all([
        supabase.from('settings').select('*').maybeSingle(),
        supabase.from('branch_settings').select('*'),
      ]);
      const data = sRes.data as Settings | null;
      if (data) {
        setSettings(data);
        void SettingsRepository.saveGlobalSettings(data);
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('premier:cached_settings', JSON.stringify(data));
          }
        } catch {
          // ignore
        }
        const uiPreset = findUiTheme(data.brand_color);
        if (uiPreset) {
          applyBrandColor(uiPreset.brandHue, uiPreset.brandSat);
          applySurfaceColor(uiPreset.surfaceHue, uiPreset.surfaceSat);
        } else {
          const brand = brandFromSettingsValue(data.brand_color);
          applyBrandColor(brand.hue, brand.sat);
          applyDefaultSurface();
        }
        if (data.theme && !hasLockedThemePreference()) applySystemTheme(data.theme as 'light' | 'dark');
        if (data.language && !hasLockedLanguagePreference()) applySystemLang(data.language as 'ar' | 'en');
      }
      const bMap: Record<string, BranchSettings> = {};
      for (const row of (bRes.data as BranchSettings[]) || []) {
        bMap[row.branch_id] = row;
        void SettingsRepository.saveBranchSettings(row.branch_id, row);
      }
      if (Object.keys(bMap).length > 0) {
        setBranchSettingsMap(bMap);
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('premier:cached_branch_settings_map', JSON.stringify(bMap));
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // offline: maintain current cached settings
    } finally {
      setLoading(false);
    }
  }, [sessionUserId, applySystemTheme, applySystemLang]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!sessionUserId || Object.keys(branchSettingsMap).length === 0) return;

    const eligible = Object.values(branchSettingsMap).filter(
      (row) => row.auto_close_shift_at_day_end && row.business_day_mode === 'fixed_time',
    );
    if (eligible.length === 0) return;

    let cancelled = false;
    const timers = new Map<string, number>();
    const errorRetries = new Map<string, number>();
    const RETRY_AFTER_BLOCK_MS = 5 * 60_000;
    const MAX_ERROR_RETRIES = 3;

    const clearBranchTimer = (branchId: string) => {
      const timer = timers.get(branchId);
      if (timer !== undefined) window.clearTimeout(timer);
      timers.delete(branchId);
    };

    const scheduleAt = (row: BranchSettings, when: Date) => {
      if (cancelled) return;
      clearBranchTimer(row.branch_id);
      const delay = Math.max(1_000, when.getTime() - Date.now() + 1_000);
      const timer = window.setTimeout(() => {
        timers.delete(row.branch_id);
        void run(row);
      }, delay);
      timers.set(row.branch_id, timer);
    };

    const scheduleConfiguredCutoff = (row: BranchSettings) => {
      scheduleAt(row, nextCairoClockInstant(row.business_day_end));
    };

    const scheduleRetry = (row: BranchSettings) => {
      scheduleAt(row, new Date(Date.now() + RETRY_AFTER_BLOCK_MS));
    };

    const run = async (row: BranchSettings) => {
      const { data, error } = await supabase.rpc('try_auto_close_branch_shift', {
        p_branch_id: row.branch_id,
      });
      if (cancelled) return;

      if (error) {
        const retries = (errorRetries.get(row.branch_id) || 0) + 1;
        errorRetries.set(row.branch_id, retries);
        if (retries <= MAX_ERROR_RETRIES) scheduleRetry(row);
        else {
          errorRetries.set(row.branch_id, 0);
          scheduleConfiguredCutoff(row);
        }
        return;
      }

      errorRetries.set(row.branch_id, 0);
      const result = data as {
        success?: boolean;
        closed?: boolean;
        error?: string;
        reason?: string;
        window_end?: string;
      } | null;

      if (result?.closed && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('shift:auto-closed', { detail: { branchId: row.branch_id } }));
      }

      if (result?.reason === 'BUSINESS_DAY_NOT_FINISHED' && result.window_end) {
        const serverCutoff = new Date(result.window_end);
        if (!Number.isNaN(serverCutoff.getTime()) && serverCutoff.getTime() > Date.now()) {
          scheduleAt(row, serverCutoff);
          return;
        }
      }

      if (result?.error === 'OPEN_ORDERS_BLOCK_SHIFT_CLOSE') {
        scheduleRetry(row);
        return;
      }

      scheduleConfiguredCutoff(row);
    };

    // One catch-up check after settings/session bootstrap. After that, schedule
    // directly for the authoritative server cutoff instead of polling every minute.
    for (const row of eligible) void run(row);

    return () => {
      cancelled = true;
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, [sessionUserId, branchSettingsMap]);


  const effectiveSettings = useCallback(
    (branchId?: string | null): Settings | null => {
      if (!settings) return null;
      if (!branchId) return settings;
      return mergeEffectiveSettings(settings, branchSettingsMap[branchId] || null);
    },
    [settings, branchSettingsMap]
  );

  const save = useCallback(async (patch: Partial<Settings>): Promise<boolean> => {
    if (!settings?.id) return false;

    const next = { ...settings, ...patch };
    const { error } = await supabase
      .from('settings')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', settings.id);

    if (error) {
      console.warn('Supabase settings update warning:', error);
      return false;
    }

    setSettings(next);
    await SettingsRepository.saveGlobalSettings(next);
    await refresh();
    return true;
  }, [settings, refresh]);

  const saveBranchSettings = useCallback(async (branchId: string, patch: Partial<BranchSettings>): Promise<boolean> => {
    const hasNegativeStockPatch = Object.prototype.hasOwnProperty.call(patch, 'allow_negative_stock');
    const requestedNegativeStock = patch.allow_negative_stock;

    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'allow_negative_stock') continue;
      if (value !== undefined) clean[key] = value;
    }
    if (hasNegativeStockPatch) {
      clean.allow_negative_stock = typeof requestedNegativeStock === 'boolean'
        ? requestedNegativeStock
        : null;
    }

    const existing = branchSettingsMap[branchId];
    const payload = { ...clean, updated_at: new Date().toISOString() };

    const result = existing
      ? await supabase.from('branch_settings').update(payload).eq('branch_id', branchId)
      : await supabase.from('branch_settings').insert({ branch_id: branchId, ...payload });

    if (result.error) {
      console.warn('Supabase branch_settings update warning:', result.error);
      return false;
    }

    const updatedBranch = {
      ...(existing || ({ branch_id: branchId } as BranchSettings)),
      ...patch,
      allow_negative_stock: hasNegativeStockPatch
        ? (typeof requestedNegativeStock === 'boolean' ? requestedNegativeStock : null)
        : existing?.allow_negative_stock,
    } as BranchSettings;

    setBranchSettingsMap((prev) => ({ ...prev, [branchId]: updatedBranch }));
    await SettingsRepository.saveBranchSettings(branchId, updatedBranch);
    await refresh();
    return true;
  }, [branchSettingsMap, refresh]);

  return (
    <SettingsContext.Provider value={{ settings, loading, branchSettingsMap, effectiveSettings, refresh, save, saveBranchSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
