import { expect, test } from '@playwright/test';

test('application shell renders when Supabase is unreachable', async ({ page }) => {
  await page.route('https://cuitndfayupfysejlpda.supabase.co/**', async (route) => {
    await route.abort('failed');
  });

  await page.goto('/');

  const root = page.locator('#root');
  await expect(root).toBeVisible();
  await expect(root).not.toBeEmpty();

  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  await expect(page.getByText('حدث خطأ')).toHaveCount(0);
});
