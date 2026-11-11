import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregateIncomeStatements, incomeMargin } from '@/features/reporting/incomeKpiIntegrity';
import { requireFinancialReport } from '@/features/reporting/services/requireFinancialReport';

const income = {
  revenue: 100, discount: 5, net_revenue: 95, cogs: 40,
  gross_profit: 55, expenses: 12, net_income: 43,
};

describe('Premier financial KPI source integrity', () => {
  it('uses the authoritative income statement fields, including negative values', () => {
    const totals = aggregateIncomeStatements([
      income, { revenue: -20, discount: 0, net_revenue: -20, cogs: -4, gross_profit: -16, expenses: 1, net_income: -17 },
    ]);
    expect(totals).toEqual({
      revenue: 80, discount: 5, net_revenue: 75, cogs: 36,
      gross_profit: 39, expenses: 13, net_income: 26,
    });
    expect(income.net_income).toBe(43);
    expect(incomeMargin(26, 75)).toBeCloseTo(34.66666667);
  });

  it('refuses missing, empty, nonfinite and partial branch responses', () => {
    expect(() => aggregateIncomeStatements([])).toThrow('NO_AUTHORIZED_BRANCHES');
    expect(() => aggregateIncomeStatements([income, null])).toThrow('INCOME_STATEMENT_INCOMPLETE');
    expect(() => aggregateIncomeStatements([{ ...income, cogs: undefined }])).toThrow('INCOME_STATEMENT_INCOMPLETE');
    expect(() => aggregateIncomeStatements([{ ...income, net_income: Number.NaN }])).toThrow('INCOME_STATEMENT_INCOMPLETE');
    expect(() => aggregateIncomeStatements([{ ...income, net_income: Number.POSITIVE_INFINITY }])).toThrow('INCOME_STATEMENT_INCOMPLETE');
    expect(() => aggregateIncomeStatements([income, { ...income, net_income: '1000' }])).toThrow('INCOME_STATEMENT_INCOMPLETE');
    expect(incomeMargin(5, 0)).toBeNull();
    expect(incomeMargin(5, -20)).toBeNull();
    expect(() => requireFinancialReport({ data: null, error: null }, 'income', 'branch-id')).toThrow('FINANCIAL_REPORT_INCOMPLETE');
  });

  it('reuses the existing income-statement RPC under financial and organization policy gates', () => {
    const panel = readFileSync(resolve(process.cwd(), 'src/features/reporting/components/ReportsExecutiveKpis.tsx'), 'utf8');
    const center = readFileSync(resolve(process.cwd(), 'src/features/reporting/pages/ReportsCenterPage.tsx'), 'utf8');
    expect(panel).toContain('reporting.getIncomeStatement(');
    expect(panel).toContain('requireFinancialReport(result');
    expect(panel).toContain('aggregateIncomeStatements(');
    expect(panel).toContain("can('reports.financial')");
    expect(panel).toContain("businessFinancialViewAllowed(runtime, 'income')");
    expect(panel).toContain('branchScope.selectedBranchIds');
    expect(panel).toContain('generation.current');
    expect(panel).toContain("throw new Error('INCOMPATIBLE_CURRENCIES')");
    expect(center).toContain('<ReportsExecutiveKpis />');
    expect(panel).not.toContain("supabase.from('sales')");
  });
});
