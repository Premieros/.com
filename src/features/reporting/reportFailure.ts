export type ReportFailureKind = 'permission' | 'schema' | 'timeout' | 'source';
export interface ReportFailure {
  kind: ReportFailureKind;
  code: string | null;
  branchId: string | null;
}

/**
 * Translate errors without showing SQL, raw server messages or other private data.
 * RPC reports wrap PostgREST error codes as FINANCIAL_REPORT_INCOMPLETE:<report>:<branch>:<code>.
 * Paginated table reports keep the native PostgREST code when available.
 */
export function classifyReportFailure(cause: unknown, allowedBranchIds: readonly string[]): ReportFailure {
  const record = cause && typeof cause === 'object' ? cause as { code?: unknown; message?: unknown } : {};
  const message = typeof record.message === 'string' ? record.message : '';
  const nativeCode = typeof record.code === 'string' ? record.code : null;
  const match = /^FINANCIAL_REPORT_INCOMPLETE:[a-z_]+:([0-9a-f-]{36}):([A-Za-z0-9_]+)$/.exec(message);
  const code = nativeCode || match?.[2] || null;
  const branchId = match && allowedBranchIds.includes(match[1]) ? match[1] : null;
  let kind: ReportFailureKind = 'source';
  if (code && ['42501', 'PGRST301', 'PGRST302', '401', '403'].includes(code)) kind = 'permission';
  else if (code && ['42703', '42P01', '42883', 'PGRST200', 'PGRST202'].includes(code)) kind = 'schema';
  else if (code && ['57014', 'PGRST003'].includes(code)) kind = 'timeout';
  return { kind, code, branchId };
}
