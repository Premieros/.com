import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // Vercel serves the SPA at root. A relative base breaks direct nested routes:
  // /settings/integrations would resolve ./assets to /settings/assets.
  // GitHub Pages explicitly sets VITE_BASE_PATH='./' in deploy.yml.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
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
