import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ReportsShowcase } from '@/features/reporting/components/ReportsShowcase';
import { DashboardDataPage } from '@/features/dashboard/pages/DashboardDataPage';

const { loadSnapshot } = vi.hoisted(() => ({
  loadSnapshot: vi.fn(async () => ({
    current: { orders: 3, sales: 250, payments: 190, returns: 0, discounts: 0 },
    previous: { orders: 2, sales: 180, payments: 150, returns: 0, discounts: 0 },
    orderTypes: [{ key: 'takeaway', count: 3 }],
    branches: [],
    recentSales: [],
    topProducts: [],
    currentSeries: [],
    previousSeries: [],
    paymentMethods: [{ branchId: 'branch-1', method: 'cash', total: 190, count: 3 }],
    previousPaymentMethods: [],
  })),
}));

vi.mock('@/api', () => ({ supabase: {}, reporting: {} }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en' }) }));
vi.mock('@/context/SettingsContext', () => ({
  useSettings: () => ({ effectiveSettings: () => ({ currency: 'EGP' }) }),
}));
vi.mock('@/lib/permissions', () => ({
  useCan: () => (permission: string) => ['sales.view', 'reports.view', 'history.unlimited'].includes(permission),
}));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => 'branch-1' }));
vi.mock('@/lib/branchScope', () => {
  const scopedBranches = { selectedBranchIds: ['branch-1'], organizationBranches: [], scopeKey: 'branch-1' };
  return { useBranchScope: () => scopedBranches };
});
vi.mock('@/hooks/useBranches', () => {
  const branches: unknown[] = [];
  return { useBranches: () => ({ branches }) };
});
vi.mock('@/core/modules/OrganizationModulesContext', () => ({
  useOrganizationModules: () => ({
    organizationId: 'org-1',
    canAccessPath: () => true,
    canAccessModule: () => true,
    runtime: {
      title: { ar: 'Premier', en: 'Premier' },
      description: { ar: '', en: '' },
      recordTypes: [],
      dashboard: { sections: new Set(['sales']), quickActions: [] },
      reports: { hidden: new Set(), allowedCategories: null },
    },
  }),
}));
vi.mock('@/core/organizations/businessRuntime', () => ({ businessReportAllowed: () => true }));
vi.mock('@/features/dashboard/services/dashboardSnapshot', () => ({
  loadDashboardSalesSnapshot: loadSnapshot,
}));
vi.mock('@/features/dashboard/components/DashboardStandbyBar', () => ({
  DashboardStandbyBar: () => null,
}));
vi.mock('@/features/dashboard/components/DashboardSalesChart', () => ({
  DashboardSalesChart: ({ compare }: { compare: boolean }) => <div data-testid="sales-chart" data-compare={compare} />,
}));

describe('dashboard workspace controls', () => {
  it('selects an analysis, expands it, compares periods and opens a scoped report without refetching on presentation changes', async () => {
    render(<MemoryRouter initialEntries={['/dashboard?range=week']}><DashboardDataPage /></MemoryRouter>);

    const chart = await screen.findByTestId('sales-chart');
    fireEvent.click(screen.getByRole('button', { name: 'Compare previous period' }));
    expect(chart).toHaveAttribute('data-compare', 'true');

    fireEvent.click(screen.getByTestId('kpi-orders'));
    expect(screen.getByTestId('kpi-orders')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Orders by type' })).toBeVisible();
    expect(screen.getByText('Takeaway')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open report' })).toHaveAttribute(
      'href', expect.stringMatching(/^\/reports\/view\?type=detailed_invoices&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/),
    );

    const expand = screen.getByRole('button', { name: 'Expand view' });
    expand.focus();
    fireEvent.click(expand);
    expect(screen.getByRole('dialog', { name: 'Orders by type' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(expand).toHaveFocus();

    fireEvent.click(screen.getByTestId('kpi-net-payments'));
    expect(screen.getByRole('heading', { name: 'Net payments by method' })).toBeVisible();
    expect(screen.getByText('Cash')).toBeVisible();
    expect(loadSnapshot).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /^Month$/ }));
    await waitFor(() => expect(loadSnapshot).toHaveBeenCalledTimes(2));
  });
});

describe('reports overview interactions', () => {
  it('keeps invoice counts and payment amounts distinct while switching analyses locally', async () => {
    loadSnapshot.mockClear();
    render(<MemoryRouter><ReportsShowcase isAr={false} allowedReportTypes={new Set(['sales', 'sales_by_payment', 'detailed_invoices'])}
      onSelectReport={vi.fn()} from="2026-11-19" to="2026-11-25" hasAuthorizedBranches verifiedIncome={null} /></MemoryRouter>);

    expect(await screen.findByText('Cash')).toBeVisible();
    expect(screen.getByText('Takeaway')).toBeVisible();

    fireEvent.click(screen.getByTestId('overview-kpi-orders'));
    expect(screen.getByTestId('overview-kpi-orders')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Takeaway')).toBeVisible();
    expect(screen.queryByText('Cash')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Net payments by method' }));
    expect(screen.getByText('Cash')).toBeVisible();
    expect(screen.queryByText('Takeaway')).toBeNull();
    expect(loadSnapshot).toHaveBeenCalledTimes(1);
  });
});
