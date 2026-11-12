import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

test('Pages project path loads assets and its offline shell within its own scope', async ({ page, context }) => {
  const dist = resolve('dist');
  const missing: string[] = [];
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.webp': 'image/webp' };
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url!, 'http://localhost').pathname;
    const file = resolve(dist, pathname.slice('/.com/'.length) || 'index.html');
    if (!pathname.startsWith('/.com/') || !file.startsWith(dist + sep)) {
      missing.push(pathname); res.writeHead(404).end(); return;
    }
    try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); res.end(body); }
    catch { missing.push(pathname); res.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/.com/`;
  try {
    await page.route('https://hvqlkapynjfjikqithvd.supabase.co/**', route => route.abort('failed'));
    await page.goto(url);
    await expect(page.locator('#root')).not.toBeEmpty();
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.active && navigator.serviceWorker.controller;
    });
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toBe(url);
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const cache = await caches.open(names.find(name => name.startsWith('premier-app-shell-') && name.endsWith(':/.com/'))!);
      return (await cache.keys()).map(request => new URL(request.url).pathname);
    });
    expect(cached).toContain('/.com/index.html');
    expect(cached.some(item => item.startsWith('/.com/assets/') && item.endsWith('.js'))).toBe(true);
    expect(cached.every(item => item.startsWith('/.com/'))).toBe(true);
    expect(missing).toEqual([]);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#root')).not.toBeEmpty();
  } finally {
    await context.setOffline(false);
    await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); });
  }
});
