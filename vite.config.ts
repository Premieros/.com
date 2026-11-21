import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { resolveViteAssetBase } from './scripts/build/viteAssetBase';
import { bunkerInlineEditor } from './scripts/build/bunkerInlineEditor';

export default defineConfig({
  // Vercel serves the SPA at root. A relative base breaks direct nested routes:
  // /settings/integrations would resolve ./assets to /settings/assets.
  // Vercel sets VERCEL=1; GitHub Pages explicitly opts into './'.
  // Local/GitHub Pages compatibility retains the legacy relative base.
  base: resolveViteAssetBase(process.env.VITE_BASE_PATH, process.env.VERCEL),
  plugins: [react(), bunkerInlineEditor()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
});
