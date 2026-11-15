import { describe, expect, it } from 'vitest';
import { PERIOD_REVIEW_DOCUMENT_REPORTS } from '../../src/features/reporting/periodReviewDocuments';
import { REPORT_REGISTRY } from '../../src/features/reporting/reportRegistry';
import { monthReviewPeriod } from '../../src/features/reporting/monthCloseReview';

describe('period document review', () => {
  it('only offers Premier report types with view permission', () => {
    for (const document of PERIOD_REVIEW_DOCUMENT_REPORTS) {
      const registered = REPORT_REGISTRY.find(report => report.key === document.key);
      expect(registered).toBeDefined();
      expect(registered?.permissions).toContain('reports.view');
      expect(document.ar).not.toBe('');
      expect(document.en).not.toBe('');
    }
    expect(new Set(PERIOD_REVIEW_DOCUMENT_REPORTS.map(x => x.key)).size)
      .toBe(PERIOD_REVIEW_DOCUMENT_REPORTS.length);
  });

  it('preserves month boundary semantics for review documents', () => {
    expect(monthReviewPeriod('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(() => monthReviewPeriod('2024-13')).toThrow('INVALID_MONTH');
  });
});
