import type { QrCustomerHistory } from './service';

/** Rank by actual settled purchase totals supplied by the branch-authorized server. */
export function sortQrCustomersByPurchases(rows: QrCustomerHistory[]): QrCustomerHistory[] {
  return [...rows].sort((a, b) => Number(b.total_spent || 0) - Number(a.total_spent || 0)
    || a.name.localeCompare(b.name, 'ar') || a.id.localeCompare(b.id));
}
