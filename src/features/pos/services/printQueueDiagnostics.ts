import type { CloudPrintQueueRow } from './cloudPrint';

export type PrintQueueFilter = 'all' | 'pending' | 'active' | 'submitted' | 'failed' | 'stale';

export function isStalePrintJob(job: CloudPrintQueueRow, now = Date.now()): boolean {
  const createdAt = Date.parse(job.created_at);
  return ['pending', 'claimed', 'printing'].includes(job.status) && Number.isFinite(createdAt) && now - createdAt > 10 * 60_000;
}

/** Read-only presentation only: never enqueue, reserve or replay a job here. */
export function printQueueJobSummary(job: CloudPrintQueueRow): { order: string; table: string } {
  const text = String(job.payload?.text || '');
  const order = text.match(/(?:طلب|Order)\s*[:：]\s*([^\r\n]+)/i)?.[1]?.trim();
  const table = text.match(/(?:طاولة|Table)\s*[:：]\s*([^\r\n]+)/i)?.[1]?.trim();
  return { order: order || '—', table: table || '—' };
}

export function filterPrintQueueJobs(
  rows: CloudPrintQueueRow[],
  status: PrintQueueFilter,
  search: string,
  now = Date.now(),
): CloudPrintQueueRow[] {
  const needle = search.trim().toLocaleLowerCase();
  return rows.filter(job => {
    const matchesStatus = status === 'all' || (status === 'stale' ? isStalePrintJob(job, now) : status === 'active'
      ? job.status === 'claimed' || job.status === 'printing'
      : job.status === status);
    if (!matchesStatus) return false;
    if (!needle) return true;
    const summary = printQueueJobSummary(job);
    return [
      job.id, job.sale_id, job.station_code, job.kind, job.status,
      summary.order, summary.table,
    ].some(value => String(value ?? '').toLocaleLowerCase().includes(needle));
  });
}

/** Sanitized troubleshooting data only: never include payload or customer details. */
export function printQueueDiagnostics(job: CloudPrintQueueRow): string {
  return [
    `job_id: ${job.id}`,
    `branch_id: ${job.branch_id}`,
    `station: ${job.station_code}`,
    `status: ${job.status}`,
    `attempts: ${job.attempts}`,
    `created_at: ${job.created_at}`,
  ].join('\n');
}

/** Hide stale results synchronously on branch/permission changes.
 * Network response validation alone does not prevent the previous branch's
 * already-rendered jobs from remaining visible while a new read is pending.
 */
export function scopeVisiblePrintQueueJobs(
  rows: CloudPrintQueueRow[],
  loadedBranchId: string,
  selectedBranchId: string,
  canManagePrinters: boolean,
): CloudPrintQueueRow[] {
  if (!canManagePrinters || !selectedBranchId || loadedBranchId !== selectedBranchId
    || rows.some(row => !row || row.branch_id !== selectedBranchId)) return [];
  return rows;
}
