import type { IncomeStatementResult } from '@/lib/types';
import { INCOME_KEYS, aggregateIncomeStatements } from './incomeKpiIntegrity';

export type IncomeBranchInput = {
  branchId: string;
  branchName: string;
  currency: string | null;
  report: unknown;
  fetchFailed?: boolean;
};

export type IncomeBranchAssessment = {
  branchId: string;
  branchName: string;
  currency: string | null;
  values: Partial<IncomeStatementResult>;
  missing: Array<keyof IncomeStatementResult>;
  fetchFailed: boolean;
};

export type IncomeReadiness = {
  branches: IncomeBranchAssessment[];
  currency: string | null;
  total: IncomeStatementResult | null;
  issues: Array<{ branchId: string; branchName: string; missing: string[] }>;
  currencyMismatch: boolean;
};

/**
 * Show every user's authorized branch, even when its financial data is
 * incomplete. Never mistake absent values for zero. The consolidated KPI
 * requires every branch to be complete and to share one known currency.
 */
export function assessIncomeReadiness(input: ReadonlyArray<IncomeBranchInput>): IncomeReadiness {
  const branches = input.map((item) => {
    const source = item.report && typeof item.report === 'object' && !Array.isArray(item.report)
      ? item.report as Record<string, unknown> : {};
    const values: Partial<IncomeStatementResult> = {};
    const missing: Array<keyof IncomeStatementResult> = [];
    for (const field of INCOME_KEYS) {
      if (typeof source[field] === 'number' && Number.isFinite(source[field])) {
        values[field] = source[field] as number;
      } else {
        missing.push(field);
      }
    }
    return {
      branchId: item.branchId,
      branchName: item.branchName,
      currency: item.currency,
      values,
      missing,
      fetchFailed: Boolean(item.fetchFailed),
    };
  });
  const currencies = branches.map((item) => item.currency);
  const currencyMismatch = currencies.some((value) => !value) || new Set(currencies).size !== 1;
  const issues = branches.flatMap((item) => {
    const missing: string[] = [...item.missing];
    if (!item.currency) missing.push('currency');
    if (item.fetchFailed) missing.push('report_unavailable');
    return missing.length ? [{ branchId: item.branchId, branchName: item.branchName, missing }] : [];
  });
  if (currencyMismatch && currencies.every(Boolean)) {
    for (const item of branches) issues.push({ branchId: item.branchId, branchName: item.branchName, missing: ['currency_mismatch'] });
  }
  const allComplete = input.length > 0 && !currencyMismatch
    && branches.every((item) => item.missing.length === 0 && !item.fetchFailed);
  const total = allComplete
    ? aggregateIncomeStatements(branches.map((item) => item.values))
    : null;
  return { branches, currency: currencyMismatch ? null : currencies[0] ?? null, total, issues, currencyMismatch };
}
