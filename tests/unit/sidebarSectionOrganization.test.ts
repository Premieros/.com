import { describe, expect, it } from 'vitest';
import { MENU_ITEMS, SIDEBAR_SECTION_ORDER, sidebarSectionForItem } from '@/core/navigation/menu.config';
import { readFileSync } from 'node:fs';

describe('Premier sidebar section organization', () => {
  it('keeps the visual sections in a predictable order', () => {
    expect(SIDEBAR_SECTION_ORDER).toEqual([
      'main', 'orders', 'delivery', 'customers', 'reports', 'inventory', 'catalog', 'centers', 'marketplace', 'admin',
    ]);
  });

  it('groups reports and inventory workspaces under their own expandable headings', () => {
    const group = (id: string) => {
      const item = MENU_ITEMS.find((candidate) => candidate.id === id);
      if (!item) throw new Error('Missing menu item: ' + id);
      return sidebarSectionForItem(item);
    };
    expect(group('dashboard')).toBe('main');
    expect(group('sales-invoices')).toBe('orders');
    expect(group('delivery')).toBe('delivery');
    expect(group('pos')).toBe('centers');
    expect(group('kitchen-display')).toBe('centers');
    expect(group('operations-center')).toBe('centers');
    expect(group('customers')).toBe('customers');
    expect(group('people-center')).toBe('centers');
    expect(group('business-records')).toBe('centers');
    expect(group('reports')).toBe('reports');
    expect(group('inventory-center')).toBe('inventory');
    expect(group('stock-counts')).toBe('inventory');
    expect(group('procurement-center')).toBe('inventory');
    expect(group('products')).toBe('catalog');
    expect(group('raw-materials')).toBe('catalog');
    expect(group('finance-center')).toBe('centers');
    expect(group('integrations-hub')).toBe('marketplace');
    expect(MENU_ITEMS.find((item) => item.id === 'sales-invoices')).toMatchObject({
      route: '/sales', permission: 'sales.view',
    });
    expect(MENU_ITEMS.find((item) => item.id === 'customers')).toMatchObject({
      route: '/customers', permission: 'customers.view',
    });
    expect(group('super-admin')).toBe('admin');
  });

  it('keeps Orders, Delivery and Customers as one-click destinations', () => {
    const layout = readFileSync('src/components/Layout.tsx', 'utf8');
    expect(layout).toContain("group === 'orders' || group === 'delivery' || group === 'customers'");
    expect(MENU_ITEMS.find((item) => item.id === 'delivery')).toMatchObject({
      route: '/delivery', permission: 'pos.view',
    });
    expect(MENU_ITEMS.find((item) => item.id === 'sales-invoices')).toMatchObject({
      label: { ar: 'الطلبات', en: 'Orders' },
      route: '/sales', permission: 'sales.view',
    });
  });

  it('places POS in the top bar, avoiding a duplicate sidebar link', () => {
    const layout = readFileSync('src/components/Layout.tsx', 'utf8');
    expect(layout).toContain('data-testid="header-pos-shortcut"');
    expect(layout).toContain('to={APP_ROUTES.pos}');
    expect(layout).toContain("const canOpenPos = visibleItems.some((item) => item.id === 'pos')");
    expect(layout).toContain("if (item.id === 'pos') return acc");
    expect(layout).toContain("{canOpenPos && (");
    expect(MENU_ITEMS.find((item) => item.id === 'pos')).toMatchObject({
      route: '/pos', permission: 'pos.view',
    });
  });

  it('reorganizes without hiding, duplicating or modifying any link', () => {
    const ids = MENU_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    const routed = MENU_ITEMS.flatMap((item) => SIDEBAR_SECTION_ORDER
      .filter((section) => sidebarSectionForItem(item) === section)
      .map(() => item.id));
    expect(routed).toEqual(ids);
  });
});
