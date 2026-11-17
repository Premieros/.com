import { afterEach, describe, expect, it } from 'vitest';
import { loadConfigFromFile } from 'vite';

const originalVercel = process.env.VERCEL;
const originalBase = process.env.VITE_BASE_PATH;

afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
  if (originalBase === undefined) delete process.env.VITE_BASE_PATH;
  else process.env.VITE_BASE_PATH = originalBase;
});

async function builtBase(): Promise<string | undefined> {
  const loaded = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    'vite.config.ts',
    process.cwd(),
  );
  return loaded?.config.base;
}

describe('Vite deployment base paths and deep-link JS assets', () => {
  it('uses origin-root absolute assets on Vercel, including nested /settings/integrations', async () => {
    process.env.VERCEL = '1';
    delete process.env.VITE_BASE_PATH;
    expect(await builtBase()).toBe('/');
    const resolvedAsset = new URL('/assets/entry.js', 'https://premieros-sage.vercel.app/settings/integrations');
    expect(resolvedAsset.pathname).toBe('/assets/entry.js');
  });

  it('preserves relative assets for the existing GitHub Pages subpath deployment', async () => {
    delete process.env.VERCEL;
    process.env.VITE_BASE_PATH = './';
    expect(await builtBase()).toBe('./');
  });

  it('retains the default local relative mode without Vercel metadata', async () => {
    delete process.env.VERCEL;
    delete process.env.VITE_BASE_PATH;
    expect(await builtBase()).toBe('./');
  });
});
