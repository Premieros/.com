import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { APP_ROUTES } from '@/core/navigation/routes';
import { MENU_ITEMS } from '@/core/navigation/menu.config';
import { moduleForRoute } from '@/core/modules/module.config';
import { InventoryCenterPage } from '@/features/inventory/pages/InventoryCenterPage';
import { FinanceCenterPage } from '@/features/accounting/pages/FinanceCenterPage';

const access = vi.hoisted(() => ({ permissions: new Set<string>(), blockedPaths: new Set<string>(), modules: true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => (permission: string) => access.permissions.has(permission) }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'ar' }) }));
vi.mock('@/core/modules/OrganizationModulesContext', () => ({ useOrganizationModules: () => ({
  runtime: { title: { ar: 'الفرع', en: 'Branch' }, navigation: { menuLabels: {} } },
  canAccessPath: (route: string) => !access.blockedPaths.has(route),
  canAccessModule: () => access.modules,
}) }));
// Exercise real center navigation without mounting the unrelated data screens inside its selected tab.
vi.mock('@/components/design/CenterPageContent', () => ({ CenterPageContent: () => null }));
vi.mock('@/features/accounting/components/ErpAgentReadinessPanel', () => ({ ErpAgentReadinessPanel: () => null }));

beforeEach(() => { access.permissions.clear(); access.blockedPaths.clear(); access.modules = true; });
afterEach(cleanup);

describe('stock count and opening balance navigation through management centers', () => {
  it('exposes stock counts from Inventory Center with inventory permission', () => {
    expect(MENU_ITEMS.find(item => item.id === 'inventory-center')).toMatchObject({ route: APP_ROUTES.inventoryCenter, permission: 'inventory.view' });
    access.permissions.add('inventory.view');
    render(<MemoryRouter><InventoryCenterPage /></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'الجرد والتسويات' });
    expect(new URL(link.getAttribute('href')!, 'https://branch.test').searchParams.get('page')).toBe(APP_ROUTES.stockCounts);
    expect(moduleForRoute(APP_ROUTES.stockCounts)).toBe('inventory');
  });

  it('hides stock counts without inventory permission', () => {
    render(<MemoryRouter><InventoryCenterPage /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'الجرد والتسويات' })).not.toBeInTheDocument();
  });

  it('hides stock counts when the active business profile excludes the path', () => {
    access.permissions.add('inventory.view'); access.blockedPaths.add(APP_ROUTES.stockCounts);
    render(<MemoryRouter><InventoryCenterPage /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'الجرد والتسويات' })).not.toBeInTheDocument();
  });

  it('exposes opening balances from Finance Center with accounting permission', () => {
    expect(MENU_ITEMS.find(item => item.id === 'finance-center')?.permissionsAny).toContain('accounts.view');
    access.permissions.add('accounts.view');
    render(<MemoryRouter><FinanceCenterPage /></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'الأرصدة الافتتاحية' });
    expect(new URL(link.getAttribute('href')!, 'https://branch.test').searchParams.get('page')).toBe(APP_ROUTES.openingBalances);
    expect(moduleForRoute(APP_ROUTES.openingBalances)).toBe('accounting');
  });

  it('hides opening balances without accounting permission', () => {
    render(<MemoryRouter><FinanceCenterPage /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'الأرصدة الافتتاحية' })).not.toBeInTheDocument();
  });

  it('hides accounting navigation when its organization module is disabled', () => {
    access.permissions.add('accounts.view'); access.modules = false;
    render(<MemoryRouter><FinanceCenterPage /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'الأرصدة الافتتاحية' })).not.toBeInTheDocument();
  });
});
