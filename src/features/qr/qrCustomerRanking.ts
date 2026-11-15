import type { QrCustomerHistory } from './service';

/**
 * Rank by settled purchasing within each branch. A monetary total from one
 * branch must never be directly compared with another branch's currency.
 */
export function sortQrCustomersByPurchases(rows: QrCustomerHistory[]): QrCustomerHistory[] {
  return [...rows].sort((a,b) => a.branch_id.localeCompare(b.branch_id)
    || Number(b.total_spent || 0) - Number(a.total_spent || 0)
    || a.name.localeCompare(b.name, 'ar') || a.id.localeCompare(b.id));
}

export function rankWithinCustomerBranch(rows: QrCustomerHistory[], id: string): number {
  const index = rows.findIndex(row => row.id === id);
  if (index < 0) return 0;
  return rows.slice(0, index + 1).filter(row => row.branch_id === rows[index].branch_id).length;
}

export type QrCustomerFilter = 'all' | 'purchased' | 'rated' | 'pending';

export function filterQrCustomers(
  rows: QrCustomerHistory[], search: string, filter: QrCustomerFilter,
): QrCustomerHistory[] {
  const term = search.trim().toLocaleLowerCase();
  return rows.filter(row => {
    if (term && !`${row.name} ${row.phone}`.toLocaleLowerCase().includes(term)) return false;
    if (filter === 'purchased') return row.purchase_count > 0;
    if (filter === 'rated') return row.rating_count > 0;
    if (filter === 'pending') return row.orders.some(order => order.status === 'pending');
    return true;
  });
}
