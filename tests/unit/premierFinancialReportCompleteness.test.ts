import { describe, expect, it } from 'vitest';
import { requireFinancialReport } from '@/features/reporting/services/requireFinancialReport';

describe('Premier fail-closed multi-branch accounting reports', () => {
  it('accepts legitimate empty array as a complete, empty report', () => {
    expect(requireFinancialReport({ data: [], error: null }, 'trial_balance', 'branch-a')).toEqual([]);
  });
  it('accepts a valid zero result (not missing branch)', () => {
    expect(requireFinancialReport({ data: { net_income: 0 }, error: null }, 'income', 'branch-a')).toEqual({ net_income: 0 });
  });
  it('rejects a timeout for one branch rather than showing a partial total', () => {
    expect(() => requireFinancialReport({ data: null, error: { code: '57014', message: 'timeout' } }, 'income', 'branch-b'))
      .toThrow('FINANCIAL_REPORT_INCOMPLETE:income:branch-b:57014');
  });
  it('rejects permission failures and missing responses', () => {
    expect(() => requireFinancialReport({ data: null, error: { code: '42501', message: 'denied' } }, 'balance_sheet', 'branch-b')).toThrow('42501');
    expect(() => requireFinancialReport({ data: null, error: null }, 'balance_sheet', 'branch-b')).toThrow('EMPTY_RESULT');
  });
  it('rejects payload-level RPC failures even with HTTP success', () => {
    expect(() => requireFinancialReport({ data: { success: false, error: 'NOT_ALLOWED' }, error: null }, 'reconciliation', 'branch-b'))
      .toThrow('RPC_REJECTED');
  });
});
