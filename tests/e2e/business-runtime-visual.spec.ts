import { expect, test } from '@playwright/test';

type ProfileCase = {
  profile: string;
  workflow: string;
  catalogMode: 'composition-enabled' | 'simple-item';
  requiredNav: string[];
  forbiddenNav: string[];
  requiredQuickAction: string;
  requiredCapability?: string;
};

const profiles: ProfileCase[] = [
  {
    profile: 'restaurant',
    workflow: 'restaurant_service',
    catalogMode: 'composition-enabled',
    requiredNav: ['pos', 'kitchen-display', 'inventory-center', 'raw-materials'],
    forbiddenNav: [],
    requiredQuickAction: 'new-order',
    requiredCapability: 'tables',
  },
  {
    profile: 'food_manufacturing',
    workflow: 'manufacturing',
    catalogMode: 'composition-enabled',
    requiredNav: ['inventory-center', 'procurement-center', 'products', 'raw-materials'],
    forbiddenNav: ['kitchen-display'],
    requiredQuickAction: 'production',
    requiredCapability: 'raw_materials',
  },
  {
    profile: 'pharmacy',
    workflow: 'pharmacy_retail',
    catalogMode: 'simple-item',
    requiredNav: ['pos', 'inventory-center', 'procurement-center', 'products'],
    forbiddenNav: ['kitchen-display', 'raw-materials', 'operations-center'],
    requiredQuickAction: 'sale',
    requiredCapability: 'batches',
  },
  {
    profile: 'car_showroom',
    workflow: 'vehicle_sales',
    catalogMode: 'simple-item',
    requiredNav: ['products', 'business-records', 'people-center', 'pos'],
    forbiddenNav: ['kitchen-display', 'raw-materials', 'operations-center'],
    requiredQuickAction: 'vehicle',
    requiredCapability: 'reservations',
  },
  {
    profile: 'tourism',
    workflow: 'tourism_bookings',
    catalogMode: 'simple-item',
    requiredNav: ['business-records', 'people-center', 'products', 'finance-center'],
    forbiddenNav: ['pos', 'inventory-center', 'kitchen-display', 'raw-materials'],
    requiredQuickAction: 'booking',
    requiredCapability: 'bookings',
  },
  {
    profile: 'services',
    workflow: 'service_delivery',
    catalogMode: 'simple-item',
    requiredNav: ['business-records', 'people-center', 'products', 'finance-center'],
    forbiddenNav: ['pos', 'inventory-center', 'procurement-center', 'kitchen-display', 'raw-materials'],
    requiredQuickAction: 'appointment',
    requiredCapability: 'services',
  },
  {
    profile: 'retail',
    workflow: 'retail',
    catalogMode: 'simple-item',
    requiredNav: ['pos', 'products', 'inventory-center', 'procurement-center'],
    forbiddenNav: ['kitchen-display', 'raw-materials', 'operations-center'],
    requiredQuickAction: 'sale',
    requiredCapability: 'stock_counts',
  },
];

test.describe('visual business profile matrix', () => {
  for (const scenario of profiles) {
    test(`${scenario.profile} renders the expected operating system shape`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.route('https://hvqlkapynjfjikqithvd.supabase.co/**', async (route) => {
        await route.abort('failed');
      });
      await page.goto(`/__runtime-preview/${scenario.profile}`);
      await expect(page.getByTestId('runtime-preview')).toHaveAttribute('data-profile', scenario.profile);
      await expect(page.getByTestId('workflow')).toHaveText(scenario.workflow);
      await expect(page.getByTestId('catalog-mode')).toHaveText(scenario.catalogMode);

      for (const item of scenario.requiredNav) {
        await expect(page.getByTestId(`nav-item-${item}`), `${scenario.profile}: expected ${item}`).toBeVisible();
      }
      for (const item of scenario.forbiddenNav) {
        await expect(page.getByTestId(`nav-item-${item}`), `${scenario.profile}: ${item} must be hidden`).toHaveCount(0);
      }

      await expect(page.getByTestId(`quick-action-${scenario.requiredQuickAction}`)).toBeVisible();

      if (scenario.requiredCapability) {
        await expect(page.getByTestId(`capability-${scenario.requiredCapability}`)).toBeVisible();
      }

      await page.screenshot({
        path: testInfo.outputPath(`${scenario.profile}.png`),
        fullPage: true,
      });
    });
  }
});
