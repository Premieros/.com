import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ORGANIZATION_MODULE_KEYS } from '@/core/modules/module.config';

const mocks = vi.hoisted(() => {
  const state = { role: 'super_admin', expired: true, subscriptionError: false };
  const branches = [{ id: 'branch', name: 'Test branch', organization_id: 'org' }];
  return {
    state, branches,
    rpc: vi.fn(async (name: string) => name === 'subscription_status'
      ? { data: state.subscriptionError ? null : { expired: state.expired }, error: state.subscriptionError ? { message: 'offline' } : null }
      : { data: [{ feature_key: 'catalog', enabled: false }], error: null }),
  };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user', role: mocks.state.role, branch_id: 'branch' } }),
}));
vi.mock('@/hooks/useBranches', () => ({ useBranches: () => ({ branches: mocks.branches, loading: false }) }));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => 'branch' }));
vi.mock('@/api', () => ({ supabase: {
  rpc: mocks.rpc,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
    data: { business_type: 'restaurant', business_profile: null }, error: null,
  }) }) }) }),
} }));

import { OrganizationModulesProvider, useOrganizationModules } from '@/core/modules/OrganizationModulesContext';

function Probe() {
  const value = useOrganizationModules();
  return <>
    <span data-testid="loading">{String(value.loading)}</span>
    <span data-testid="pos-only">{String(value.posOnlyMode)}</span>
    <span data-testid="dashboard">{String(value.canAccessPath('/dashboard'))}</span>
    <span data-testid="admin">{String(value.canAccessPath('/super-admin'))}</span>
    <span data-testid="inventory">{String(value.canAccessModule('inventory'))}</span>
    <span data-testid="catalog">{String(value.canAccessModule('catalog'))}</span>
    <span data-testid="pos">{String(value.canAccessModule('pos'))}</span>
    <span data-testid="projected-access">{String(value.access.inventory)}</span>
  </>;
}
const app = () => <OrganizationModulesProvider><Probe /></OrganizationModulesProvider>;
const ready = async () => waitFor(() => {
  expect(mocks.rpc).toHaveBeenCalledWith('subscription_status', { p_branch_id: 'branch' });
  expect(screen.getByTestId('loading')).toHaveTextContent('false');
});

describe('subscription navigation policy', () => {
  beforeEach(() => {
    cleanup(); localStorage.clear(); mocks.rpc.mockClear();
    mocks.state.role = 'super_admin'; mocks.state.expired = true; mocks.state.subscriptionError = false;
  });

  it('allows super admin navigation for an expired tenant without enabling disabled catalog features', async () => {
    render(app()); await ready();
    expect(screen.getByTestId('pos-only')).toHaveTextContent('false');
    expect(screen.getByTestId('dashboard')).toHaveTextContent('true');
    expect(screen.getByTestId('admin')).toHaveTextContent('true');
    expect(screen.getByTestId('inventory')).toHaveTextContent('true');
    expect(screen.getByTestId('catalog')).toHaveTextContent('false');
    expect(JSON.parse(localStorage.getItem('premier:organization-runtime:org')!).posOnlyMode).toBe(true);
  });

  it.each(['owner', 'branch_manager', 'cashier'])('keeps expired %s accounts in POS only', async (role) => {
    mocks.state.role = role;
    render(app()); await ready();
    expect(screen.getByTestId('pos-only')).toHaveTextContent('true');
    expect(screen.getByTestId('dashboard')).toHaveTextContent('false');
    expect(screen.getByTestId('inventory')).toHaveTextContent('false');
    expect(screen.getByTestId('projected-access')).toHaveTextContent('false');
    expect(screen.getByTestId('pos')).toHaveTextContent('true');
  });

  it('uses cached expiry during a subscription outage without restricting super admin', async () => {
    localStorage.setItem('premier:organization-runtime:org', JSON.stringify({
      access: Object.fromEntries(ORGANIZATION_MODULE_KEYS.map(key => [key, true])),
      businessType: 'restaurant', businessProfile: null, posOnlyMode: true,
    }));
    mocks.state.subscriptionError = true;
    render(app()); await ready();
    expect(screen.getByTestId('pos-only')).toHaveTextContent('false');
    expect(screen.getByTestId('dashboard')).toHaveTextContent('true');
  });

  it('reapplies restriction immediately when the role changes, keeping the raw expiry in cache', async () => {
    const view = render(app()); await ready();
    expect(screen.getByTestId('dashboard')).toHaveTextContent('true');
    mocks.state.role = 'owner'; view.rerender(app());
    expect(screen.getByTestId('dashboard')).toHaveTextContent('false');
    expect(screen.getByTestId('inventory')).toHaveTextContent('false');
    mocks.state.role = 'super_admin'; view.rerender(app());
    expect(screen.getByTestId('dashboard')).toHaveTextContent('true');
    expect(screen.getByTestId('inventory')).toHaveTextContent('true');
    expect(screen.getByTestId('catalog')).toHaveTextContent('false');
  });

  it('does not restrict an active ordinary account', async () => {
    mocks.state.role = 'owner'; mocks.state.expired = false;
    render(app()); await ready();
    expect(screen.getByTestId('pos-only')).toHaveTextContent('false');
    expect(screen.getByTestId('dashboard')).toHaveTextContent('true');
    expect(screen.getByTestId('inventory')).toHaveTextContent('true');
    expect(screen.getByTestId('catalog')).toHaveTextContent('false');
  });
});
