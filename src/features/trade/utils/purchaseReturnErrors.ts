/** Human-readable purchase correction/return messages for fail-closed FIFO errors.
 *
 * The SQL function returns TRANSACTION_FAILED with the stable failure marker
 * in detail; a network/PostgREST error may instead put that marker in message.
 * Unknown failures intentionally return null so existing error handling survives.
 */
export type PurchaseReturnFailure = {
  error?: string | null;
  detail?: string | null;
  message?: string | null;
};

export function purchaseReturnFailureMessage(
  failure: PurchaseReturnFailure | null | undefined,
  language: 'ar' | 'en',
): string | null {
  const raw = [failure?.error, failure?.detail, failure?.message]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');

  if (raw.includes('PURCHASE_RETURN_INSUFFICIENT_STOCK')) {
    return language === 'ar'
      ? 'لا يمكن إرجاع أو تعديل فاتورة الشراء: مخزون أحد البنود غير كافٍ لسحب الكمية المطلوبة. لم يُعتمد الإرجاع أو التعديل. راجع الرصيد وحركات المخزون ثم أعد المحاولة.'
      : 'Cannot return or edit this purchase invoice: there is insufficient stock to remove the required quantity. The return or edit was not committed. Review stock and inventory movements before retrying.';
  }

  if (raw.includes('PURCHASE_RETURN_FIFO_FAILED')) {
    return language === 'ar'
      ? 'تعذر إرجاع أو تعديل فاتورة الشراء لأن عملية سحب المخزون لم تكتمل. لم يُعتمد الإرجاع أو التعديل. تحقق من المستودع ووحدة القياس وحركات المخزون، ثم أعد المحاولة.'
      : 'The purchase return or edit was rejected because FIFO stock removal failed. No return or edit was committed. Check the warehouse, unit of measure and stock movements before retrying.';
  }

  return null;
}
