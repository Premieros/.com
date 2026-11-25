import { describe, it, expect } from 'vitest';
import { requireSuccessfulMutation, parseNonnegativeQuantity } from '@/lib/operationalWriteGuards';
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
