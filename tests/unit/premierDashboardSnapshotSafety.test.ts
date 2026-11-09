import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDashboardSalesSnapshot } from '@/features/dashboard/services/dashboardSnapshot';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/api', () => ({ reporting: { getDashboardSalesSnapshot: mocks.read } }));

const options = {
  branchId: 'branch-1',
  currentFrom: '2026-11-01T00:00:00Z',
  currentTo: '2026-11-09T00:00:00Z',
  previousFrom: '2026-10-23T00:00:00Z',
  previousTo: '2026-10-31T23:59:59Z',
  granularity: 'day' as const,
};

describe('Premier dashboard snapshot failure containment', () => {
  beforeEach(() => mocks.read.mockReset());

  it('keeps compatibility fallback for a missing snapshot RPC only', async () => {
    mocks.read.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } });
    await expect(loadDashboardSalesSnapshot(options)).resolves.toBeNull();
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it('does not treat timeout as an empty snapshot eligible for expensive fallback', async () => {
    mocks.read.mockResolvedValue({ data: null, error: { code: '57014', message: 'statement timeout' } });
    await expect(loadDashboardSalesSnapshot(options)).rejects.toMatchObject({ code: '57014' });
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it('does not convert permission failures to empty financial totals', async () => {
    mocks.read.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(loadDashboardSalesSnapshot(options)).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects a malformed response instead of triggering fallback', async () => {
    mocks.read.mockResolvedValue({ data: null, error: null });
    await expect(loadDashboardSalesSnapshot(options)).rejects.toThrow('DASHBOARD_SNAPSHOT_INVALID');
  });

  it('parses a valid bounded snapshot as a successful result', async () => {
    mocks.read.mockResolvedValue({
      data: {
        current: { orders: 2, sales: 120, payments: 120 },
        previous: { orders: 1, sales: 60, payments: 60 },
        order_types: [],
        branches: [],
        recent_sales: [],
        top_products: [],
        current_series: [],
        previous_series: [],
        payment_methods: [],
        previous_payment_methods: [],
      },
      error: null,
    });
    await expect(loadDashboardSalesSnapshot(options)).resolves.toMatchObject({
      current: { orders: 2, sales: 120 },
      previous: { orders: 1, sales: 60 },
    });
  });
});
