import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchActiveOrders } from '@/features/pos/services/posOrders';

const mock = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(),
  activeTables: [] as unknown[], inactiveTables: [] as unknown[],
  orders: [] as unknown[], items: [] as unknown[], sends: [] as unknown[],
  fallbackError: null as unknown,
  queries: [] as { entity: string; select: string; filters: [string, unknown][] }[],
}));

vi.mock('@/api', () => ({ supabase: { from: mock.from, rpc: mock.rpc }, pos: {} }));

beforeEach(() => {
  mock.queries = []; mock.activeTables = []; mock.inactiveTables = [];
  mock.orders = []; mock.items = []; mock.sends = []; mock.fallbackError = null;
  mock.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  mock.from.mockReset().mockImplementation((entity: string) => {
    const record = { entity, select: '', filters: [] as [string, unknown][] };
    mock.queries.push(record);
    const query = {
      select: vi.fn((value: string) => { record.select = value; return query; }),
      eq: vi.fn((key: string, value: unknown) => { record.filters.push([key, value]); return query; }),
      in: vi.fn((key: string, value: unknown) => { record.filters.push([key, value]); return query; }),
      order: vi.fn(() => query),
      then: (resolve: (value: unknown) => void) => {
        const fallback = entity === 'dining_tables' && record.filters.some(([key]) => key === 'id');
        const data = entity === 'dining_tables' ? fallback ? mock.inactiveTables : mock.activeTables
          : entity === 'orders' ? mock.orders
          : entity === 'order_items' ? mock.items : mock.sends;
        return Promise.resolve({ data, error: fallback ? mock.fallbackError : null }).then(resolve);
      },
    };
    return query;
  });
});

const makeOrder = (id: string, tableId: string | null) =>
  ({ id, branch_id: 'branch', table_id: tableId, status: 'open', cashier_id: null });

describe('POS branch-scoped table snapshot reuse', () => {
  it('reuses active table rows for multiple orders without an embedded table join', async () => {
    const table = { id: 't', branch_id: 'branch', name: 'Table 1', is_active: true };
    mock.activeTables = [table];
    mock.orders = [makeOrder('o1', 't'), makeOrder('o2', 't')];
    mock.items = [{ id: 'i1', order_id: 'o1', quantity: 1 }, { id: 'i2', order_id: 'o2', quantity: 1 }];
    const result = await fetchActiveOrders('branch');
    expect(mock.queries.filter(q => q.entity === 'dining_tables')).toHaveLength(1);
    expect(mock.queries.find(q => q.entity === 'orders')?.select).not.toContain('dining_tables');
    expect(result.orders.map(order => order.table)).toEqual([table, table]);
    expect(result.orderItems).toHaveLength(2);
    expect(result.watchedOrderIds).toEqual(['o1', 'o2']);
    expect(mock.rpc).toHaveBeenCalledWith('get_pos_order_operator_labels', { p_branch_id: 'branch' });
  });
  it('resolves inactive table names with a single distinct scoped fallback', async () => {
    const inactive = { id: 'inactive', branch_id: 'branch', name: 'Hidden Table', is_active: false };
    mock.orders = [makeOrder('o1', 'inactive'), makeOrder('o2', 'inactive')];
    mock.items = [{ id: 'i1', order_id: 'o1', quantity: 1 }, { id: 'i2', order_id: 'o2', quantity: 1 }];
    mock.inactiveTables = [inactive];
    const result = await fetchActiveOrders('branch');
    const reads = mock.queries.filter(q => q.entity === 'dining_tables');
    expect(reads).toHaveLength(2);
    expect(reads[1].filters).toEqual([['branch_id', 'branch'], ['id', ['inactive']]]);
    expect(result.orders.map(order => order.table)).toEqual([inactive, inactive]);
    expect(result.tables).toEqual([]);
  });
  it('never turns fallback permission failure into a successful incomplete floor snapshot', async () => {
    mock.orders = [makeOrder('o1', 'inactive')];
    mock.fallbackError = { code: '42501', message: 'permission denied' };
    await expect(fetchActiveOrders('branch')).rejects.toBe(mock.fallbackError);
  });
  it('preserves takeaway and missing-table orders without exposing other branch details', async () => {
    mock.orders = [makeOrder('o1', null), makeOrder('o2', 'hidden')];
    mock.items = [{ id: 'i1', order_id: 'o1', quantity: 1 }, { id: 'i2', order_id: 'o2', quantity: 1 }];
    const result = await fetchActiveOrders('branch');
    expect(result.orders.map(order => order.table)).toEqual([undefined, undefined]);
    expect(mock.queries.filter(q => q.entity === 'dining_tables').slice(-1)[0]?.filters)
      .toEqual([['branch_id', 'branch'], ['id', ['hidden']]]);
  });
});
