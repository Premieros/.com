import { describe, expect, it } from 'vitest';
import { filterQrCustomers, rankWithinCustomerBranch, sortQrCustomersByPurchases } from '../../src/features/qr/qrCustomerRanking';
import type { QrCustomerHistory } from '../../src/features/qr/service';

const make = (id: string, total_spent: number): QrCustomerHistory => ({
  id, branch_id: 'branch-a', name: id, phone: '',
  total_spent, purchase_count: 1, rating_count: 0, average_rating: null,
  orders: [], purchases: [], ratings: [], service_history: [],
});

describe('QR customer purchase leaderboard', () => {
  it('ranks only by server-confirmed settled purchasing totals', () => {
    const rows = [make('low', 10), make('high', 120), make('medium', 50)];
    expect(sortQrCustomersByPurchases(rows).map(row => row.id)).toEqual(['high', 'medium', 'low']);
    expect(rows.map(row => row.id)).toEqual(['low', 'high', 'medium']);
  });
  it('never mixes spending ranks across branches or currencies', () => {
    const a = make('a', 200);
    const b = { ...make('b', 50000), branch_id: 'branch-b' };
    const c = { ...make('c', 800), branch_id: 'branch-b' };
    const rows = sortQrCustomersByPurchases([c, a, b]);
    expect(rows.map(row => row.id)).toEqual(['a', 'b', 'c']);
    expect(rankWithinCustomerBranch(rows, 'a')).toBe(1);
    expect(rankWithinCustomerBranch(rows, 'b')).toBe(1);
    expect(rankWithinCustomerBranch(rows, 'c')).toBe(2);
  });
  it('filters only matching customer profiles without moving ratings or requests', () => {
    const first = {
      ...make('guest-1', 0), name: 'Ahmed', phone: '012345',
      rating_count: 1, orders: [{ id: 'request-1', status: 'pending', created_at: '2026-11-15',
        order_type: 'dine_in', table_name: 'T1', order_number: null, order_status: null, paid_value: null,
        items: [{ name: 'Tea', quantity: '2', price: '10', notes: '' }], items_truncated: false }],
    };
    const second = { ...make('guest-2', 250), name: 'Mona', purchase_count: 1 };
    const rows = [first, second];
    expect(filterQrCustomers(rows, '012', 'all').map(row => row.id)).toEqual(['guest-1']);
    expect(filterQrCustomers(rows, '', 'purchased').map(row => row.id)).toEqual(['guest-2']);
    expect(filterQrCustomers(rows, '', 'rated').map(row => row.id)).toEqual(['guest-1']);
    expect(filterQrCustomers(rows, '', 'pending').map(row => row.id)).toEqual(['guest-1']);
    expect(rows[0].orders[0].items[0].name).toBe('Tea');
  });
  it('retains ratings and order history with their exact customer identity', () => {
    const one = { ...make('guest-1', 0), ratings: [{ overall: 5, food: 4, service: 5, note: 'Great', created_at: '2026-11-15' }], rating_count: 1 };
    const other = make('guest-2', 100);
    const ranked = sortQrCustomersByPurchases([one, other]);
    expect(ranked[0].ratings).toHaveLength(0);
    expect(ranked[1].id).toBe('guest-1');
    expect(ranked[1].ratings[0].note).toBe('Great');
  });
});
