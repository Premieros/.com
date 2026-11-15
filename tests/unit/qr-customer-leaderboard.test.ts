import { describe, expect, it } from 'vitest';
import { sortQrCustomersByPurchases } from '../../src/features/qr/qrCustomerRanking';
import type { QrCustomerHistory } from '../../src/features/qr/service';

const make = (id: string, total_spent: number): QrCustomerHistory => ({
  id, branch_id: 'branch-a', name: id, phone: '',
  total_spent, purchase_count: 1, rating_count: 0, average_rating: null,
  orders: [], ratings: [],
});

describe('QR customer purchase leaderboard', () => {
  it('ranks only by server-confirmed settled purchasing totals', () => {
    const rows = [make('low', 10), make('high', 120), make('medium', 50)];
    expect(sortQrCustomersByPurchases(rows).map(row => row.id)).toEqual(['high', 'medium', 'low']);
    expect(rows.map(row => row.id)).toEqual(['low', 'high', 'medium']);
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
