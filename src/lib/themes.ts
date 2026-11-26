import { applyBrandColor, applySurfaceColor } from './brandColor';

export type UiThemeMode = 'light' | 'dark';

export interface UiThemePreset {
  key: string;
  ar: string;
  en: string;
  mode: UiThemeMode;
  brandHue: number;
  brandSat: number;
  surfaceHue: number;
  surfaceSat: number;
  accent?: 'copper' | 'cobalt' | 'ocean' | 'pine' | 'graphite';
  swatch?: string;
}

export const UI_THEME_STORAGE_KEY = 'pos_ui_theme';
export const DEFAULT_UI_THEME = 'premier-refresh-cobalt';

export const UI_THEMES: UiThemePreset[] = [
  { key: 'premier-refresh-copper', ar: 'نحاسي دافئ', en: 'Premier Copper', mode: 'light', brandHue: 19, brandSat: 72, surfaceHue: 100, surfaceSat: 14, accent: 'copper', swatch: '#a8481c' },
  { key: 'premier-refresh-copper-dark', ar: 'نحاسي داكن', en: 'Premier Copper Dark', mode: 'dark', brandHue: 19, brandSat: 82, surfaceHue: 150, surfaceSat: 16, accent: 'copper', swatch: '#ffa77a' },
  { key: 'premier-refresh-cobalt', ar: 'كوبالت', en: 'Premier Cobalt', mode: 'light', brandHue: 228, brandSat: 67, surfaceHue: 215, surfaceSat: 18, accent: 'cobalt', swatch: '#2747c4' },
  { key: 'premier-refresh-ocean', ar: 'محيطي', en: 'Premier Ocean', mode: 'light', brandHue: 194, brandSat: 69, surfaceHue: 190, surfaceSat: 16, accent: 'ocean', swatch: '#16627a' },
  { key: 'premier-refresh-pine', ar: 'صنوبري', en: 'Premier Pine', mode: 'light', brandHue: 155, brandSat: 66, surfaceHue: 140, surfaceSat: 16, accent: 'pine', swatch: '#17704b' },
  { key: 'premier-refresh-graphite', ar: 'جرافيت', en: 'Premier Graphite', mode: 'light', brandHue: 240, brandSat: 8, surfaceHue: 220, surfaceSat: 8, accent: 'graphite', swatch: '#2c2c33' },
  { key: 'premier-dark', ar: 'بريمير داكنة', en: 'Premier Dark', mode: 'dark', brandHue: 222, brandSat: 72, surfaceHue: 222, surfaceSat: 50, swatch: '#3b5bdb' },
  { key: 'premier-light', ar: 'بريمير فاتحة', en: 'Premier Light', mode: 'light', brandHue: 222, brandSat: 72, surfaceHue: 222, surfaceSat: 50, swatch: '#2747c4' },
  { key: 'ocean', ar: 'المحيط', en: 'Ocean', mode: 'dark', brandHue: 205, brandSat: 85, surfaceHue: 210, surfaceSat: 55, swatch: '#0ea5e9' },
  { key: 'midnight', ar: 'منتصف الليل', en: 'Midnight', mode: 'dark', brandHue: 198, brandSat: 85, surfaceHue: 205, surfaceSat: 60, swatch: '#0284c7' },
  { key: 'emerald', ar: 'الزمرد', en: 'Emerald', mode: 'dark', brandHue: 160, brandSat: 72, surfaceHue: 165, surfaceSat: 55, swatch: '#10b981' },
  { key: 'royal-purple', ar: 'البنفسجي الملكي', en: 'Royal Purple', mode: 'dark', brandHue: 268, brandSat: 72, surfaceHue: 262, surfaceSat: 55, swatch: '#7c3aed' },
  { key: 'ruby', ar: 'الياقوتي', en: 'Ruby', mode: 'dark', brandHue: 345, brandSat: 75, surfaceHue: 335, surfaceSat: 55, swatch: '#e11d48' },
  { key: 'sunset', ar: 'الغروب', en: 'Sunset', mode: 'dark', brandHue: 20, brandSat: 80, surfaceHue: 25, surfaceSat: 55, swatch: '#ea580c' },
  { key: 'slate', ar: 'أردوازي', en: 'Slate', mode: 'dark', brandHue: 215, brandSat: 70, surfaceHue: 215, surfaceSat: 32, swatch: '#64748b' },
  { key: 'paper', ar: 'ورقي', en: 'Paper', mode: 'light', brandHue: 46, brandSat: 74, surfaceHue: 45, surfaceSat: 55, swatch: '#b7952a' },
];

export function findUiTheme(key: string | null | undefined): UiThemePreset | undefined {
  if (!key) return undefined;
  return UI_THEMES.find((t) => t.key === key);
}

/** Apply a full UI theme preset to the DOM (mode class + accent + brand + surface). */
export function applyUiThemePreset(p: UiThemePreset): void {
  const root = document.documentElement;
  root.classList.toggle('dark', p.mode === 'dark');
  if (p.accent) root.setAttribute('data-accent', p.accent);
  else root.removeAttribute('data-accent');
  applyBrandColor(p.brandHue, p.brandSat);
  applySurfaceColor(p.surfaceHue, p.surfaceSat);
}
