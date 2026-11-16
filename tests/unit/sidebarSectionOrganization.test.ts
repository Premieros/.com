import { describe, expect, it } from 'vitest';
import { MENU_ITEMS, SIDEBAR_SECTION_ORDER, sidebarSectionForItem } from '@/core/navigation/menu.config';

describe('Premier sidebar section organization', () => {
  it('keeps the visual sections in a predictable order', () => {
    expect(SIDEBAR_SECTION_ORDER).toEqual([
      'main', 'orders', 'customers', 'reports', 'inventory', 'catalog', 'centers', 'admin',
    ]);
  });

  it('groups reports and inventory workspaces under their own expandable headings', () => {
    const group = (id: string) => {
      const item = MENU_ITEMS.find((candidate) => candidate.id === id);
      if (!item) throw new Error('Missing menu item: ' + id);
      return sidebarSectionForItem(item);
    };
    expect(group('dashboard')).toBe('main');
    expect(group('pos')).toBe('orders');
    expect(group('kitchen-display')).toBe('orders');
    expect(group('operations-center')).toBe('orders');
    expect(group('customers')).toBe('customers');
    expect(group('people-center')).toBe('customers');
    expect(group('business-records')).toBe('customers');
    expect(group('reports')).toBe('reports');
    expect(group('inventory-center')).toBe('inventory');
    expect(group('stock-counts')).toBe('inventory');
    expect(group('procurement-center')).toBe('inventory');
    expect(group('products')).toBe('catalog');
    expect(group('raw-materials')).toBe('catalog');
    expect(group('finance-center')).toBe('centers');
    expect(MENU_ITEMS.find((item) => item.id === 'customers')).toMatchObject({
      route: '/customers', permission: 'customers.view',
    });
    expect(group('super-admin')).toBe('admin');
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
