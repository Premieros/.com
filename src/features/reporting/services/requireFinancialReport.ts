import type { ApiError } from '@/api/types';

/**
 * Financial exports and aggregates must NEVER silently omit a failed branch.
 * A missing response is not a legitimate zero balance.
 */
export function requireFinancialReport<T>(
  result: { data: T | null; error: ApiError | null },
  report: string,
  branchId: string,
): T {
  if (result.error || result.data == null) {
    const code = result.error?.code || (result.error ? 'RPC_ERROR' : 'EMPTY_RESULT');
    throw new Error(`FINANCIAL_REPORT_INCOMPLETE:${report}:${branchId}:${code}`);
  }
  if (
    typeof result.data === 'object'
    && !Array.isArray(result.data)
    && 'success' in result.data
    && (result.data as { success?: boolean }).success === false
  ) {
    throw new Error(`FINANCIAL_REPORT_INCOMPLETE:${report}:${branchId}:RPC_REJECTED`);
  }
  return result.data;
}
