import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Theme } from '../lib/types';
import { applySurfaceColor } from '../lib/brandColor';
import { DEFAULT_UI_THEME, findUiTheme, UI_THEME_STORAGE_KEY, applyUiThemePreset } from '../lib/themes';

export const THEME_STORAGE_KEY = 'pos_theme';
export const THEME_PREFERENCE_LOCK_KEY = 'pos_theme_preference_locked';
export const VESSA_ACCENT_STORAGE_KEY = 'vessa_accent';

export type VessaAccent = 'copper' | 'cobalt' | 'ocean' | 'pine' | 'graphite';

const VALID_ACCENTS: ReadonlySet<VessaAccent> = new Set(['copper', 'cobalt', 'ocean', 'pine', 'graphite']);

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  applySystemTheme: (t: Theme) => void;
  toggleTheme: () => void;
  saveThemePreference: () => void;
  uiTheme: string;
  setUiTheme: (key: string) => void;
  accent: VessaAccent;
  setAccent: (accent: VessaAccent) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function hasLockedThemePreference(): boolean {
  return localStorage.getItem(THEME_PREFERENCE_LOCK_KEY) === '1';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return (saved as Theme) || 'light';
  });
  const [uiTheme, setUiThemeState] = useState<string>(() => {
    const saved = localStorage.getItem(UI_THEME_STORAGE_KEY);
    return saved && findUiTheme(saved) ? saved : DEFAULT_UI_THEME;
  });
  const [accent, setAccentState] = useState<VessaAccent>(() => {
    const savedAccent = localStorage.getItem(VESSA_ACCENT_STORAGE_KEY) as VessaAccent | null;
    if (savedAccent && VALID_ACCENTS.has(savedAccent)) return savedAccent;
    const savedTheme = localStorage.getItem(UI_THEME_STORAGE_KEY);
    const preset = findUiTheme(savedTheme) ?? findUiTheme(DEFAULT_UI_THEME);
    return preset?.accent ?? 'cobalt';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const p = findUiTheme(uiTheme);
    if (p) {
      applySurfaceColor(p.surfaceHue, p.surfaceSat);
    }
    document.documentElement.setAttribute('data-accent', accent);
    localStorage.setItem(VESSA_ACCENT_STORAGE_KEY, accent);
  }, [uiTheme, accent]);

  const lockThemePreference = useCallback(() => {
    localStorage.setItem(THEME_PREFERENCE_LOCK_KEY, '1');
  }, []);

  const setTheme = useCallback((t: Theme) => {
    lockThemePreference();
    setThemeState(t);
  }, [lockThemePreference]);

  const applySystemTheme = useCallback((t: Theme) => {
    setThemeState(t);
  }, []);

  const toggleTheme = useCallback(() => {
    lockThemePreference();
    setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, [lockThemePreference]);

  const setAccent = useCallback((nextAccent: VessaAccent) => {
    if (!VALID_ACCENTS.has(nextAccent)) return;
    lockThemePreference();
    setAccentState(nextAccent);
  }, [lockThemePreference]);

  const setUiTheme = useCallback((key: string) => {
    const p = findUiTheme(key);
    if (!p) return;
    lockThemePreference();
    setUiThemeState(key);
    localStorage.setItem(UI_THEME_STORAGE_KEY, key);
    applyUiThemePreset(p);
    if (p.accent) setAccentState(p.accent);
    setThemeState(p.mode);
  }, [lockThemePreference]);

  const saveThemePreference = useCallback(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    localStorage.setItem(UI_THEME_STORAGE_KEY, uiTheme);
    localStorage.setItem(VESSA_ACCENT_STORAGE_KEY, accent);
    lockThemePreference();
  }, [theme, uiTheme, accent, lockThemePreference]);

  const value = useMemo(
    () => ({ theme, setTheme, applySystemTheme, toggleTheme, uiTheme, setUiTheme, saveThemePreference, accent, setAccent }),
    [theme, setTheme, applySystemTheme, toggleTheme, uiTheme, setUiTheme, saveThemePreference, accent, setAccent]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
