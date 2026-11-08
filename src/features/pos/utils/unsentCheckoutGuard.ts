/** Cashier-side warning only; server-side transactional guards remain mandatory. */
export function needsKitchenDispatchBeforeSettlement(
  activeOrderId: string | null | undefined,
  hasUnsentItems: boolean,
): boolean {
  return Boolean(activeOrderId && hasUnsentItems);
}
