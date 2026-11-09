import { expect, test } from '@playwright/test';

test('browser preloads all lazy route assets and reloads shell without internet', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', (request) => errors.push(`REQUEST_FAILED ${request.url()} ${request.failure()?.errorText || ''}`));
  await page.route('https://hvqlkapynjfjikqithvd.supabase.co/**', (route) => route.abort('failed'));
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, { timeout: 30_000 });
  // The service worker precaches every Vite JS/CSS module, even if no route was visited.
  const assets = await page.evaluate(async () => {
    const keys = await caches.keys();
    const name = keys.find((key) => /^premier-app-shell-v2-[a-f0-9]{16}$/.test(key));
    if (!name) return { count: 0, cachedAll: false };
    const cache = await caches.open(name);
    const entries = await cache.keys();
    const jsCss = entries.filter((entry) => /\/assets\/.*\.(?:js|css)(?:\?|$)/.test(entry.url));
    return { count: jsCss.length, cachedAll: jsCss.length > 1 };
  });
  expect(assets.cachedAll).toBe(true);
  expect(assets.count).toBeGreaterThan(1);

  await context.setOffline(true);
  try {
    await page.goto('/nonexistent-offline-route', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    expect(await page.locator('#root').innerHTML(), `Offline page errors: ${errors.join(' | ')}`).not.toBe('');
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
});
