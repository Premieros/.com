import { describe, expect, it } from 'vitest';
import { APP_ROUTES } from '@/core/navigation/routes';
import { MENU_ITEMS } from '@/core/navigation/menu.config';
import { moduleForRoute } from '@/core/modules/module.config';

describe('stock count and opening balance navigation', () => {
  it('makes stock counts independently visible with inventory permissions', () => {
    const menu = MENU_ITEMS.find(item => item.id === 'stock-counts');
    expect(menu).toMatchObject({
      route: APP_ROUTES.stockCounts,
      permission: 'inventory.view',
      label: { ar: 'الجرد والتسويات', en: 'Stock Counts & Adjustments' },
    });
    expect(moduleForRoute(APP_ROUTES.stockCounts)).toBe('inventory');
  });

  it('makes opening balances independently visible behind accounting permissions', () => {
    const menu = MENU_ITEMS.find(item => item.id === 'opening-balances');
    expect(menu).toMatchObject({
      route: APP_ROUTES.openingBalances,
      permission: 'accounts.view',
      label: { ar: 'الأرصدة الافتتاحية', en: 'Opening Balances' },
    });
    expect(moduleForRoute(APP_ROUTES.openingBalances)).toBe('accounting');
  });
});
