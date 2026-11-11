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
  else if (code && ['42703', '42P01', '42883', 'PGRST200', 'PGRST201', 'PGRST202'].includes(code)) kind = 'schema';
  else if (code && ['57014', 'PGRST003'].includes(code)) kind = 'timeout';
  return { kind, code, branchId };
}

/**
 * User-facing guidance. Technical codes stay in diagnostics and are never
 * presented as steps the business user is expected to understand.
 */
export function describeReportFailure(
  failure: Pick<ReportFailure, 'kind'> | null,
  lang: 'ar' | 'en',
): { title: string; action: string } {
  const ar = lang === 'ar';
  switch (failure?.kind) {
    case 'permission':
      return ar
        ? { title: 'ليست لديك صلاحية الاطلاع على بيانات هذا التقرير في الفروع المختارة.', action: 'اختر فرعًا لديك صلاحية الوصول إليه، أو اطلب من مدير النظام مراجعة صلاحياتك لهذا التقرير.' }
        : { title: 'You cannot view this report for the selected branches.', action: 'Choose a branch you can access, or ask your administrator to check your report permissions.' };
    case 'timeout':
      return ar
        ? { title: 'استغرق تجهيز التقرير وقتًا أطول من المسموح.', action: 'اختر فترة أقصر أو فرعًا واحدًا، ثم اضغط «إعادة تحميل التقرير».' }
        : { title: 'This report took too long to prepare.', action: 'Choose a shorter date range or a single branch, then select Retry report.' };
    case 'schema':
      return ar
        ? { title: 'هذا التقرير غير متاح حاليًا بسبب مشكلة في إعداد التقرير بالنظام.', action: 'لا تحتاج إلى تعديل بيانات المبيعات أو المخزون. أبلغ مسؤول النظام باسم التقرير لإصلاحه.' }
        : { title: 'This report is currently unavailable due to a problem with its setup.', action: 'Do not change sales or inventory data. Contact your system administrator and provide the report name.' };
    default:
      return ar
        ? { title: 'لم نتمكن من إحضار جميع نتائج التقرير الآن.', action: 'اضغط «إعادة تحميل التقرير». إذا تكرر الأمر، أبلغ مسؤول النظام باسم التقرير والفرع المتأثر.' }
        : { title: 'We could not retrieve all results for this report.', action: 'Select Retry report. If it happens again, tell your administrator the report name and affected branch.' };
  }
}
