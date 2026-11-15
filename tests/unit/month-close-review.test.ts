import { describe, expect, it } from 'vitest';
import { MONTH_REVIEW_STEPS, monthReviewPeriod } from '../../src/features/reporting/monthCloseReview';
import { REPORT_REGISTRY } from '../../src/features/reporting/reportRegistry';

describe('month-end review links', () => {
  it('calculates exact Gregorian month boundaries including leap February', () => {
    expect(monthReviewPeriod('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthReviewPeriod('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthReviewPeriod('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('rejects invalid month inputs', () => {
    for (const month of ['2026-00', '2026-13', '2026-2', '2026-02-01', 'not-a-month']) {
      expect(() => monthReviewPeriod(month)).toThrow('INVALID_MONTH');
    }
  });

  it('uses only known, permission-gated Premier operational reports', () => {
    for (const step of MONTH_REVIEW_STEPS) {
      const report = REPORT_REGISTRY.find(item => item.key === step.key);
      expect(report).toBeDefined();
      expect(report?.permissions).toContain('reports.view');
      expect(step.ar.length).toBeGreaterThan(5);
      expect(step.en.length).toBeGreaterThan(5);
    }
    expect(new Set(MONTH_REVIEW_STEPS.map(step => step.key)).size).toBe(MONTH_REVIEW_STEPS.length);
  });
});
