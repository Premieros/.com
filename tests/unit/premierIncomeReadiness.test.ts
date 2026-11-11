import { describe, expect, it } from 'vitest';
import { assessIncomeReadiness } from '@/features/reporting/incomeReadiness';

const complete = {
  revenue: 100, discount: 10, net_revenue: 90,
  cogs: 40, gross_profit: 50, expenses: 20, net_income: 30,
};
const branch = (branchId: string, report: unknown, currency: string | null = 'EGP', fetchFailed = false) => ({
  branchId, branchName: `Branch ${branchId}`, report, currency, fetchFailed,
});

describe('Income readiness checklist for user completion', () => {
  it('shows missing fields by branch, preserves known values, and never calls missing zero', () => {
    const result = assessIncomeReadiness([
      branch('a', complete),
      branch('b', { ...complete, cogs: undefined, net_income: null }),
    ]);
    expect(result.total).toBeNull();
    expect(result.branches).toHaveLength(2);
    expect(result.branches[0].values.net_income).toBe(30);
    expect(result.branches[1].values.net_revenue).toBe(90);
    expect(result.branches[1].values.cogs).toBeUndefined();
    expect(result.issues).toEqual([
      { branchId: 'b', branchName: 'Branch b', missing: ['cogs', 'net_income'] },
    ]);
  });

  it('shows a whole missing branch as a checklist while preserving the healthy branch amounts', () => {
    const result = assessIncomeReadiness([
      branch('a', complete),
      branch('b', null, 'EGP', true),
    ]);
    expect(result.branches[0].values.revenue).toBe(100);
    expect(result.branches[1].missing).toHaveLength(7);
    expect(result.issues[0].missing).toContain('report_unavailable');
    expect(result.total).toBeNull();
  });

  it('does not consolidate different/unknown currencies and tells user which currency to complete', () => {
    const mixed = assessIncomeReadiness([branch('a', complete, 'EGP'), branch('b', complete, 'USD')]);
    expect(mixed.total).toBeNull();
    expect(mixed.currencyMismatch).toBe(true);
    expect(mixed.issues).toHaveLength(2);
    expect(mixed.branches[0].values.net_income).toBe(30);

    const missingCurrency = assessIncomeReadiness([branch('a', complete, null)]);
    expect(missingCurrency.issues[0].missing).toContain('currency');
    expect(missingCurrency.total).toBeNull();
  });

  it('returns the real total when every authorized branch is complete and uses the same currency', () => {
    const result = assessIncomeReadiness([branch('a', complete), branch('b', complete)]);
    expect(result.issues).toEqual([]);
    expect(result.currency).toBe('EGP');
    expect(result.total).toEqual({
      revenue: 200, discount: 20, net_revenue: 180,
      cogs: 80, gross_profit: 100, expenses: 40, net_income: 60,
    });
  });

  it('keeps the user aware when no branch has been selected', () => {
    const result = assessIncomeReadiness([]);
    expect(result.total).toBeNull();
    expect(result.branches).toHaveLength(0);
  });
});
