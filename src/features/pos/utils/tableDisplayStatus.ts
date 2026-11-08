import type { DiningTableStatus } from '@/lib/types';

/**
 * The active order (containing effective item quantities) is authoritative
 * when a stale table snapshot says the table is vacant. Presentation only:
 * never mutate dining_tables.status or bypass the existing order RPC.
 */
export function tableDisplayStatus(
  storedStatus: DiningTableStatus,
  effectiveOpenOrderCount: number,
): DiningTableStatus {
  return storedStatus === 'vacant' && effectiveOpenOrderCount > 0
    ? 'occupied'
    : storedStatus;
}
