import { describe, it, expect } from 'vitest';
import { requireSuccessfulMutation, parseNonnegativeQuantity, applyTransferCost, requireCountedQuantity } from '@/lib/operationalWriteGuards';
describe('operational write guards', () => {
  it('rejects transport and business failures', () => {
    expect(() => requireSuccessfulMutation({ data: { success: false, error: 'DENIED' } })).toThrow('DENIED');
    expect(() => requireSuccessfulMutation({ data: { success: true }, error: { message: 'network' } })).toThrow('network');
    expect(() => requireSuccessfulMutation({ data: null })).toThrow('MUTATION_NOT_CONFIRMED');
    expect(requireSuccessfulMutation({ data: { success: true } }).success).toBe(true);
  });
  it('distinguishes zero from uncounted and rejects invalid values', () => {
    expect(parseNonnegativeQuantity('')).toBeNull();
    expect(parseNonnegativeQuantity('0')).toBe(0);
    expect(parseNonnegativeQuantity('0.125')).toBe(.125);
    for (const bad of ['-1', 'NaN', 'Infinity', '2x']) expect(() => parseNonnegativeQuantity(bad)).toThrow();
  });
});

describe('transfer cost request ordering', () => {
  it('never overwrites a newer selection, removed line or edited quantity', () => {
    const rows = [{ lookupToken: 2, quantity: 7, unit_cost: 0 }, { lookupToken: 3, quantity: 9, unit_cost: 0 }];
    expect(applyTransferCost(rows, 1, 14)).toEqual(rows);
    expect(applyTransferCost(rows, 2, 14)).toEqual([{ lookupToken: undefined, quantity: 7, unit_cost: 14, costError: false }, rows[1]]);
    expect(applyTransferCost([], 2, 14)).toEqual([]);
    expect(applyTransferCost(rows, 2, 0, true)[0]).toMatchObject({ costError: true });
  });
});

it('requires explicit physical counts without replacing a blank with system stock', () => {
  expect(() => requireCountedQuantity('')).toThrow('COUNTED_QUANTITY_REQUIRED');
  expect(() => requireCountedQuantity('  ')).toThrow('COUNTED_QUANTITY_REQUIRED');
  expect(requireCountedQuantity('0')).toBe(0);
  expect(requireCountedQuantity('1.25')).toBe(1.25);
});
