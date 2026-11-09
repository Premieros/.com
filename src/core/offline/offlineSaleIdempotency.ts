import type { OfflineSaleQueueItem } from './offlineStorage';

export type PendingOfflineSale = Omit<OfflineSaleQueueItem, 'status' | 'retry_count'>;

function financialFingerprint(payload: Record<string, unknown>): string {
  // Invoice numbering may differ when the same operation is retried.
  const { p_invoice_number: ignoredInvoice, ...businessFields } = payload;
  void ignoredInvoice;
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([name, nested]) => [name, stable(nested)]));
    }
    return value;
  };
  return JSON.stringify(stable(businessFields));
}

/**
 * Same financial operation key => same *durable queue row*.
 * A different owner, branch or financial payload under the same key is a conflict.
 * Deliberately checks all statuses, not only pending rows.
 */
export function decideOfflineSaleInsert(
  rows: OfflineSaleQueueItem[],
  sale: PendingOfflineSale,
): { id: string; inserted: boolean } {
  const key = String(sale.payload.p_client_operation_key || '').trim();
  const branch = String(sale.payload.p_branch_id || '').trim();
  const owner = String(sale.created_by_user_id || '').trim();
  if (!key || !branch || !owner) throw new Error('OFFLINE_SALE_IDEMPOTENCY_SCOPE_REQUIRED');
  const matches = rows.filter(row => String(row.payload?.p_client_operation_key || '').trim() === key);
  if (matches.length > 1) throw new Error('OFFLINE_SALE_OPERATION_KEY_CONFLICT');
  const existing = matches[0];
  if (!existing) return { id: sale.id, inserted: true };
  if (existing.created_by_user_id !== owner
    || existing.payload.p_branch_id !== branch
    || financialFingerprint(existing.payload) !== financialFingerprint(sale.payload)) {
    throw new Error('OFFLINE_SALE_OPERATION_KEY_CONFLICT');
  }
  return { id: existing.id, inserted: false };
}
