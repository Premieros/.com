/**
 * A locally cleared cart is not a cancelled persisted order.
 * A saved order must go through the audited server cancellation transaction
 * to free the dining table and prevent old items from reappearing.
 */
export type ClearCartAction = 'clear-local' | 'cancel-saved-order' | 'permission-denied';

export function resolveCartClearAction(
  activeOrderId: string | null,
  mayCancelOrder: boolean,
): ClearCartAction {
  if (!activeOrderId) return 'clear-local';
  return mayCancelOrder ? 'cancel-saved-order' : 'permission-denied';
}
