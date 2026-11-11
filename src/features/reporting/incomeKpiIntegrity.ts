import type { IncomeStatementResult } from '@/lib/types';

export const INCOME_KEYS = [
  'revenue', 'discount', 'net_revenue', 'cogs', 'gross_profit', 'expenses', 'net_income',
] as const satisfies ReadonlyArray<keyof IncomeStatementResult>;

/**
 * Reuse only the authoritative income-statement RPC's numbers. Missing or
 * nonfinite values are an error, never silently converted to zero.
 * A failure in ANY authorized branch suppresses the entire aggregate.
 */
export function aggregateIncomeStatements(rows: ReadonlyArray<unknown>): IncomeStatementResult {
  if (rows.length === 0) throw new Error('NO_AUTHORIZED_BRANCHES');
  const totals = Object.fromEntries(INCOME_KEYS.map((key) => [key, 0])) as Record<keyof IncomeStatementResult, number>;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('INCOME_STATEMENT_INCOMPLETE');
    const values = row as Record<string, unknown>;
    for (const key of INCOME_KEYS) {
      const value = values[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('INCOME_STATEMENT_INCOMPLETE');
      totals[key] += value;
      if (!Number.isFinite(totals[key])) throw new Error('INCOME_STATEMENT_OVERFLOW');
    }
  }
  return totals;
}

export function incomeMargin(netIncome: number, netRevenue: number): number | null {
  return netRevenue > 0 ? (netIncome / netRevenue) * 100 : null;
}
