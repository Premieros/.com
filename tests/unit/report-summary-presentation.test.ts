import { describe, expect, it } from 'vitest';
import { reportSummaryPresentation } from '../../src/features/reporting/reportSummaryPresentation';

describe('Premier report summary presentation', () => {
  it('formats inventory quantities without adding currency units', () => {
    const summary = reportSummaryPresentation('inventory', 'ar');
    expect(summary.totalIsQuantity).toBe(true);
    expect(summary.totalLabel).toBe('إجمالي الكمية');
  });

  it('uses the existing group count for top consumed reports, not an invented quantity total', () => {
    const summary = reportSummaryPresentation('top_consumed_products', 'en');
    expect(summary.totalIsQuantity).toBe(true);
    expect(summary.totalLabel).toBe('Displayed product groups');
  });

  it('labels financial reports without changing their numeric values', () => {
    const sales = reportSummaryPresentation('sales', 'en');
    expect(sales.totalLabel).toBe('Net sales');
    expect(sales.totalIsQuantity).toBe(false);
    expect(reportSummaryPresentation('financial_reconciliation', 'ar').countLabel).toBe('عدد الفروق');
  });

  it('explains why payment method allocations are not necessarily cash receipts', () => {
    expect(reportSummaryPresentation('sales_by_payment', 'en').note).toContain('credit');
  });
});
