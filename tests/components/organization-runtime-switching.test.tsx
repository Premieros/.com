import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const runtimeMocks = vi.hoisted(() => {
  let activeBranchId = 'branch-restaurant';

  const branches = [
    { id: 'branch-restaurant', name: 'Restaurant', organization_id: 'org-restaurant' },
    { id: 'branch-tourism', name: 'Tourism', organization_id: 'org-tourism' },
  ];

  const moduleCatalog: Record<string, Array<{ feature_key: string; enabled: boolean }>> = {
    'org-restaurant': [
      { feature_key: 'pos', enabled: true },
      { feature_key: 'catalog', enabled: true },
      { feature_key: 'kds', enabled: true },
    ],
    'org-tourism': [
      { feature_key: 'pos', enabled: false },
      { feature_key: 'catalog', enabled: true },
      { feature_key: 'kds', enabled: false },
    ],
  };

  const profiles = {
    'org-restaurant': {
      business_type: 'restaurant',
      business_profile: {
        preset_key: 'restaurant',
        capabilities: ['tables', 'kds'],
        runtime_fields: [],
        record_types: [],
      },
    },
    'org-tourism': {
      business_type: 'tourism',
      business_profile: {
        preset_key: 'tourism',
        capabilities: ['bookings'],
        runtime_fields: [
          { entity: 'customer', key: 'passport_number', ar: 'جواز', en: 'Passport', type: 'text' },
        ],
        record_types: [
          { key: 'booking', ar: 'حجز', en: 'Booking', customerRequired: true },
        ],
      },
    },
  } as const;

  const supabase = {
    rpc: vi.fn(async (_name: string, args: { p_organization_id: string }) => ({
      data: moduleCatalog[args.p_organization_id] || [],
      error: null,
    })),
    from: vi.fn(() => ({
      select: () => ({
        eq: (_column: string, organizationId: string) => ({
          maybeSingle: async () => ({
            data: profiles[organizationId as keyof typeof profiles] || null,
            error: null,
          }),
        }),
      }),
    })),
  };

  return {
    branches,
    supabase,
    get activeBranchId() {
      return activeBranchId;
    },
    setActiveBranchId(value: string) {
      activeBranchId = value;
    },
  };
});

vi.mock('@/api', () => ({ supabase: runtimeMocks.supabase }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'super-admin-user',
      role: 'super_admin',
      branch_id: 'branch-restaurant',
    },
  }),
}));
vi.mock('@/hooks/useBranches', () => ({
  useBranches: () => ({
    branches: runtimeMocks.branches,
    loading: false,
  }),
}));
vi.mock('@/lib/useBranchFilter', () => ({
  useBranchFilter: () => runtimeMocks.activeBranchId,
}));

import {
  OrganizationModulesProvider,
  useOrganizationModules,
} from '@/core/modules/OrganizationModulesContext';

function Probe() {
  const runtime = useOrganizationModules();
  return (
    <div>
      <span data-testid="org">{runtime.organizationId || ''}</span>
      <span data-testid="type">{runtime.businessType || ''}</span>
      <span data-testid="pos">{String(runtime.canAccessModule('pos'))}</span>
      <span data-testid="kds">{String(runtime.canAccessModule('kds'))}</span>
      <span data-testid="records">{String(runtime.businessProfile?.record_types?.[0]?.key || '')}</span>
    </div>
  );
}

describe('organization runtime switching', () => {
  beforeEach(() => {
    localStorage.clear();
    runtimeMocks.setActiveBranchId('branch-restaurant');
    runtimeMocks.supabase.rpc.mockClear();
    runtimeMocks.supabase.from.mockClear();
  });

  it('makes a super admin runtime follow the selected organization instead of enabling everything globally', async () => {
    const view = render(
      <OrganizationModulesProvider>
        <Probe />
      </OrganizationModulesProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('org')).toHaveTextContent('org-restaurant');
      expect(screen.getByTestId('type')).toHaveTextContent('restaurant');
      expect(screen.getByTestId('pos')).toHaveTextContent('true');
      expect(screen.getByTestId('kds')).toHaveTextContent('true');
    });

    runtimeMocks.setActiveBranchId('branch-tourism');
    view.rerender(
      <OrganizationModulesProvider>
        <Probe />
      </OrganizationModulesProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('org')).toHaveTextContent('org-tourism');
      expect(screen.getByTestId('type')).toHaveTextContent('tourism');
      expect(screen.getByTestId('pos')).toHaveTextContent('false');
      expect(screen.getByTestId('kds')).toHaveTextContent('false');
      expect(screen.getByTestId('records')).toHaveTextContent('booking');
    });

    expect(runtimeMocks.supabase.rpc).toHaveBeenCalledWith(
      'get_organization_module_catalog',
      { p_organization_id: 'org-tourism' },
    );
  });
});
