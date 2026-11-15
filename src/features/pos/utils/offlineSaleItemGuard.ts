/** Offline sales become durable financial outbox records. Reject malformed
 * item identities/quantities before stock preflight or queue insertion,
 * including when the branch explicitly permits negative stock.
 */
export function hasValidOfflineSaleItems(
  items: readonly { product_id?: unknown; quantity?: unknown }[] | null | undefined,
): boolean {
  return Array.isArray(items) && items.length > 0 && items.every(item =>
    item !== null && typeof item === 'object'
    && typeof item.product_id === 'string' && item.product_id.trim().length > 0
    && typeof item.quantity === 'number' && Number.isFinite(item.quantity)
    && item.quantity > 0
  );
}
