import { describe, expect, it } from 'vitest';
import { normalizeRecoveryPin } from '@/features/qr/normalizeRecoveryPin';

describe('two-digit customer order recovery PIN', () => {
  it('accepts Western, Arabic-Indic, Persian and full-width numerals', () => {
    expect(normalizeRecoveryPin('07')).toBe('07');
    expect(normalizeRecoveryPin('٠٧')).toBe('07');
    expect(normalizeRecoveryPin('۰۷')).toBe('07');
    expect(normalizeRecoveryPin('０７')).toBe('07');
    expect(normalizeRecoveryPin(' ٠۷ ')).toBe('07');
  });
  it('retains leading zeros without allowing excess digits or markup', () => {
    expect(normalizeRecoveryPin('۰۰')).toBe('00');
    expect(normalizeRecoveryPin('3٣۵')).toBe('33');
    expect(normalizeRecoveryPin('<img>٠٩')).toBe('09');
    expect(normalizeRecoveryPin('anything')).toBe('');
  });
});
