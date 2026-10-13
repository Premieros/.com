import { dbGetAllStrict, dbPut } from '@/core/repositories/LocalDatabase';

/** The warehouse selected while connected must be the one used for offline
 * capture and eventual replay. Do not switch to a different branch default
 * when the connection comes back.
 */
export interface PinnedSaleWarehouse {
  branchId: string;
  warehouseId: string;
  orderId: string | null;
  verifiedAt: string;
}

const MAX_BINDING_AGE_MS = 24 * 60 * 60 * 1000;
const warehouseKey = (branchId: string, orderId: string | null) =>
  'offline_pos_warehouse:' + JSON.stringify([branchId, orderId || null]);

export async function saveVerifiedSaleWarehouse(
  branchId: string,
  warehouseId: string,
  orderId: string | null,
): Promise<void> {
  if (!branchId?.trim() || !warehouseId?.trim() || (orderId !== null && !orderId.trim())) {
    throw new Error('WAREHOUSE_SCOPE_REQUIRED');
  }
  const binding: PinnedSaleWarehouse = {
    branchId, warehouseId, orderId, verifiedAt: new Date().toISOString(),
  };
  // dbPut resolves only at IDBTransaction.oncomplete: a cache entry is never
  // considered saved on the request's earlier onsuccess alone.
  await dbPut('system_settings', { key: warehouseKey(branchId, orderId), value: binding });
}

/** Missing, inaccessible, mismatched or outdated cache is UNKNOWN, not an
 * invitation to choose the first warehouse at a later sync.
 */
export async function getPinnedSaleWarehouse(
  branchId: string,
  orderId: string | null,
  now = Date.now(),
): Promise<string | null> {
  if (!branchId?.trim() || (orderId !== null && !orderId.trim())) return null;
  const rows = await dbGetAllStrict<{ key: string; value?: PinnedSaleWarehouse }>('system_settings');
  const binding = rows.find(row => row.key === warehouseKey(branchId, orderId))?.value;
  if (!binding || binding.branchId !== branchId || binding.orderId !== orderId
    || typeof binding.warehouseId !== 'string' || !binding.warehouseId.trim()) return null;
  const t = Date.parse(binding.verifiedAt);
  if (!Number.isFinite(t) || t > now + 5 * 60 * 1000 || now - t > MAX_BINDING_AGE_MS) return null;
  return binding.warehouseId;
}

/** Only the original warehouse saved in the financial payload may replay.
 * A returned branch default or newly selected order warehouse cannot replace it.
 */
export function getReplayPinnedWarehouse(payload: { p_warehouse_id?: unknown }): string | null {
  return typeof payload.p_warehouse_id === 'string'
    ? payload.p_warehouse_id.trim() || null
    : null;
}
