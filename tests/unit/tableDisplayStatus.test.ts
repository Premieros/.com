import { describe, expect, it } from 'vitest';
import { tableDisplayStatus } from '@/features/pos/utils/tableDisplayStatus';

describe('floor-plan effective table status', () => {
  it('shows occupied when the database still says vacant but the table has effective open orders', () => {
    expect(tableDisplayStatus('vacant', 1)).toBe('occupied');
    expect(tableDisplayStatus('vacant', 2)).toBe('occupied');
  });

  it('does not manufacture occupancy from empty order shells', () => {
    expect(tableDisplayStatus('vacant', 0)).toBe('vacant');
  });

  it('preserves manually assigned reserved and closed status (no writes)', () => {
    expect(tableDisplayStatus('reserved', 1)).toBe('reserved');
    expect(tableDisplayStatus('closed', 1)).toBe('closed');
    expect(tableDisplayStatus('occupied', 0)).toBe('occupied');
  });
});
