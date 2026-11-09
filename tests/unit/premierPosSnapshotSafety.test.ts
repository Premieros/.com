import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchActiveOrders } from '@/features/pos/services/posOrders';

type MockResult = { data: unknown; error: { code?: string; message: string } | null };
const state = vi.hoisted(() => ({
  responses: {} as Record<string, MockResult>,
  rpc: vi.fn(),
}));

vi.mock('@/api', () => {
  function query(table: string) {
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      then: (resolve: (v: MockResult) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(state.responses[table] ?? { data: [], error: null }).then(resolve, reject),
    };
    return builder;
  }
  return {
    supabase: { from: vi.fn(query), rpc: state.rpc },
    pos: { getActiveShift: vi.fn() },
  };
});

describe('Premier POS live snapshot failure containment', () => {
  beforeEach(() => {
    state.responses = {};
    state.rpc.mockReset();
    state.rpc.mockResolvedValue({ data: [], error: null });
  });

  it('does not portray a failed active order read as an empty restaurant', async () => {
    state.responses.orders = { data: null, error: { code: '57014', message: 'statement timeout' } };
    await expect(fetchActiveOrders('branch-a')).rejects.toMatchObject({ code: '57014' });
  });

  it('does not drop order items after a transient order-line failure', async () => {
    state.responses.orders = { data: [{ id: 'order-1', status: 'open', branch_id: 'branch-a' }], error: null };
    state.responses.order_items = { data: null, error: { message: 'network unavailable' } };
    await expect(fetchActiveOrders('branch-a')).rejects.toMatchObject({ message: 'network unavailable' });
  });

  it('does not treat missing operator labels as trustworthy checkout scope', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(fetchActiveOrders('branch-a')).rejects.toMatchObject({ code: '42501' });
  });

  it('keeps the existing successful snapshot shape', async () => {
    state.responses.orders = { data: [{ id: 'order-1', status: 'open', branch_id: 'branch-a' }], error: null };
    state.responses.dining_tables = { data: [{ id: 'table-1', branch_id: 'branch-a' }], error: null };
    state.responses.order_items = { data: [{ id: 'line-1', order_id: 'order-1', quantity: 1 }], error: null };
    state.responses.order_kitchen_sends = { data: [], error: null };
    await expect(fetchActiveOrders('branch-a')).resolves.toMatchObject({
      orders: [{ id: 'order-1' }],
      tables: [{ id: 'table-1' }],
      watchedOrderIds: ['order-1'],
    });
  });
});
