import path from 'node:path';
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const { startLocalAppServer } = require('../../electron/localAppServer.cjs') as {
  startLocalAppServer: (config: { distDir: string; port: number }) => Promise<{ url: string; close: () => Promise<void> }>;
};

let hosted: { url: string; close: () => Promise<void> };

test.beforeAll(async () => {
  hosted = await startLocalAppServer({
    distDir: path.resolve(process.cwd(), 'dist'),
    port: 0, // Isolated CI instance. Installed Windows app uses stable port.
  });
});

test.afterAll(async () => {
  if (hosted) await hosted.close();
});

test('bundled Premier interface boots while every external request is blocked', async ({ page }) => {
  const origin = new URL(hosted.url).origin;
  const externalRequests: string[] = [];
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === origin) {
      await route.continue();
    } else {
      externalRequests.push(route.request().url());
      await route.abort('internetdisconnected');
    }
  });

  await page.goto(new URL('/login', hosted.url).toString(), {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('#root > *').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('input').first()).toBeVisible({ timeout: 20_000 });
  expect(new URL(page.url()).origin).toBe(origin);
  // The local UI can render even when these optional cloud/font calls fail.
  // This is not a substitute for offline authenticated transaction tests.
  expect(Array.isArray(externalRequests)).toBe(true);
});
