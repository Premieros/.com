import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MENU_ITEMS } from '@/core/navigation/menu.config';

const read = (path: string) => readFileSync(path, 'utf8');

describe('simplified center-based application navigation', () => {
  it('keeps the sidebar compact', () => {
    expect(MENU_ITEMS.length).toBeLessThanOrEqual(12);
    for (const id of [
      'customers', 'suppliers', 'expenses', 'accounts', 'employee-receivables',
      'payments', 'journal', 'treasury', 'reconciliation', 'sales', 'shifts',
      'reports', 'branches', 'import-export', 'users', 'permissions',
      'approvals', 'kitchen-stations', 'audit-log', 'settings',
    ]) {
      expect(MENU_ITEMS.find((item) => item.id === id), `${id} should live inside a center`).toBeUndefined();
    }
  });

  it('exposes one center for each consolidated family', () => {
    expect(MENU_ITEMS.find((item) => item.id === 'people-center')).toBeDefined();
    expect(MENU_ITEMS.find((item) => item.id === 'finance-center')).toBeDefined();
    expect(MENU_ITEMS.find((item) => item.id === 'administration-center')).toBeDefined();
  });

  it('keeps center tiles permission-aware centrally', () => {
    const source = read('src/components/design/CenterTile.tsx');
    expect(source).toContain('item.permission !== false');
    expect(source).toContain('canAccessModule(moduleForPath(item.route))');
  });

  it('does not alter printing or kitchen dispatch behavior', () => {
    for (const path of [
      'src/features/accounting/pages/FinanceCenterPage.tsx',
      'src/features/parties/pages/PeopleCenterPage.tsx',
      'src/features/admin/pages/AdministrationCenterPage.tsx',
    ]) {
      const source = read(path);
      expect(source).not.toContain('cloud_print_jobs');
      expect(source).not.toContain('send_to_kitchen');
      expect(source).not.toContain('print_jobs');
    }
  });
});
