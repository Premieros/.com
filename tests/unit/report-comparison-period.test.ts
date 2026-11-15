import { describe, expect, it } from 'vitest';
import { comparisonPeriod } from '../../src/features/reporting/reportComparison';

describe('report date-only comparison periods', () => {
  it('selects an equal-length previous interval', () => {
    expect(comparisonPeriod({ from: '2026-11-01', to: '2026-11-15' }, 'previous'))
      .toEqual({ from: '2026-10-17', to: '2026-10-31' });
  });

  it('supports one-day and year-boundary comparisons', () => {
    expect(comparisonPeriod({ from: '2026-01-01', to: '2026-01-01' }, 'previous'))
      .toEqual({ from: '2025-12-31', to: '2025-12-31' });
  });

  it('clamps leap day when comparing against the prior non-leap year', () => {
    expect(comparisonPeriod({ from: '2024-02-29', to: '2024-03-01' }, 'year'))
      .toEqual({ from: '2023-02-28', to: '2023-03-01' });
  });

  it('rejects invalid or reversed day-only inputs instead of normalizing dates', () => {
    for (const bad of [
      { from: '2026-02-30', to: '2026-03-01' },
      { from: '2026-03-10', to: '2026-03-01' },
      { from: '2026-1-01', to: '2026-01-31' },
    ]) {
      expect(() => comparisonPeriod(bad, 'previous')).toThrow('INVALID_COMPARISON_PERIOD');
    }
  });
});
