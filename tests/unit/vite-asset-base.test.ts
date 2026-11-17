import { describe, expect, it } from 'vitest';
import { resolveViteAssetBase } from '../../scripts/build/viteAssetBase';

describe('Vite frontend asset URL handling', () => {
  it('uses origin-root absolute assets on Vercel, including direct nested routes', () => {
    const base = resolveViteAssetBase(undefined, '1');
    expect(base).toBe('/');
    const deepPage = new URL('/settings/integrations?utm_source=chatgpt.com',
      'https://premieros-sage.vercel.app');
    const asset = new URL(`${base}assets/index-entry.js`, deepPage);
    expect(asset.pathname).toBe('/assets/index-entry.js');
  });

  it('preserves the relative asset override for GitHub Pages', () => {
    expect(resolveViteAssetBase('./', '1')).toBe('./');
    expect(resolveViteAssetBase('./', undefined)).toBe('./');
  });

  it('retains legacy local relative assets and supports explicit root override', () => {
    expect(resolveViteAssetBase(undefined, undefined)).toBe('./');
    expect(resolveViteAssetBase('/', undefined)).toBe('/');
  });
});
