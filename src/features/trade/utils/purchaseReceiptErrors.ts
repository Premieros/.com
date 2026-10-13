/** Translate known procurement receipt RPC failures for branch operators.
 *
 * SQL returns TRANSACTION_FAILED with its stable atomic rollback marker in
 * detail. A PostgREST transport error may surface it in message/details.
 * Unknown codes deliberately return null for the caller's normal fallback.
 */
export type PurchaseReceiptFailure = {
  error?: string | null;
  detail?: string | null;
  message?: string | null;
};

export function purchaseReceiptFailureMessage(
  failure: PurchaseReceiptFailure | null | undefined,
  language: 'ar' | 'en',
): string | null {
  if (!failure) return null;

  const response = [failure.error, failure.detail, failure.message]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');

  if (response.includes('PURCHASE_RECEIPT_STOCK_FAILED')) {
    if (response.includes('INCOMPATIBLE_PURCHASE_UNIT')) {
      return language === 'ar'
        ? 'تعذر استلام أمر الشراء: وحدة قياس أحد البنود غير متوافقة مع وحدة المخزون. لم يتم تسجيل هذا الاستلام أو خصم/إضافة كميات منه. راجع وحدة البند ثم أعد المحاولة.'
        : 'The purchase receipt was rejected: an item purchase unit is incompatible with its stock unit. No part of this receipt was committed. Check the item unit before retrying.';
    }
    return language === 'ar'
      ? 'تعذر استلام أمر الشراء بسبب فشل معالجة أحد بنود المخزون. تم إلغاء هذه المحاولة بالكامل، ولم يُسجّل سند استلام منها. راجع المستودع والبنود وحركات المخزون ثم أعد المحاولة.'
      : 'The receipt was rejected because an inventory item could not be processed. This receipt was rolled back in full and no GRN was saved. Review the warehouse, items and stock movements before retrying.';
  }

  const known: Record<string, { ar: string; en: string }> = {
    WAREHOUSE_REQUIRED: {
      ar: 'حدد مستودعًا لأمر الشراء قبل الاستلام، ثم أعد المحاولة.',
      en: 'Select a warehouse on the purchase order before receiving, then try again.',
    },
    WAREHOUSE_BRANCH_MISMATCH: {
      ar: 'مستودع أمر الشراء لا يتبع نفس الفرع. صحح المستودع في أمر الشراء قبل الاستلام.',
      en: 'The purchase-order warehouse belongs to another branch. Correct the warehouse before receiving.',
    },
    OVER_RECEIPT: {
      ar: 'كمية الاستلام أكبر من الكمية المتبقية في أمر الشراء. حدّث الكميات ثم أعد المحاولة.',
      en: 'The receipt quantity exceeds the remaining order quantity. Update quantities before retrying.',
    },
    NOT_RECEIVABLE: {
      ar: 'أمر الشراء ليس في حالة تسمح باستلام جديد. تحقق من اعتماده وحالته الحالية.',
      en: 'This purchase order cannot be received in its current status. Check its approval and current status.',
    },
    INVALID_QUANTITY: {
      ar: 'يجب أن تكون كميات الاستلام أكبر من صفر.',
      en: 'Receipt quantities must be greater than zero.',
    },
    EMPTY_RECEIPT: {
      ar: 'أدخل كمية واحدة على الأقل لاستلامها.',
      en: 'Enter at least one item quantity to receive.',
    },
    PURCHASE_ITEM_NOT_FOUND: {
      ar: 'أحد البنود لا يتبع أمر الشراء الحالي. أعد فتح أمر الشراء وحدّث البيانات.',
      en: 'An item does not belong to this purchase order. Reopen the order and refresh the data.',
    },
  };
  const code = failure.error || '';
  return known[code]?.[language] || null;
}
