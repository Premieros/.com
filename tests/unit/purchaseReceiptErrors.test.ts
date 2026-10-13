import { describe, expect, it } from 'vitest';
import { purchaseReceiptFailureMessage } from '@/features/trade/utils/purchaseReceiptErrors';

describe('purchase receipt operator failure messages', () => {
  it('explains the atomic receipt rollback and incompatible purchase unit in Arabic', () => {
    const message = purchaseReceiptFailureMessage({
      error: 'TRANSACTION_FAILED',
      detail: 'PURCHASE_RECEIPT_STOCK_FAILED: INCOMPATIBLE_PURCHASE_UNIT',
    }, 'ar');
    expect(message).toContain('وحدة قياس');
    expect(message).toContain('لم يتم تسجيل');
    expect(message).not.toContain('PURCHASE_RECEIPT_STOCK_FAILED');
  });

  it('explains a generic inventory helper failure without claiming partial success', () => {
    const message = purchaseReceiptFailureMessage({
      error: 'TRANSACTION_FAILED',
      detail: 'PURCHASE_RECEIPT_STOCK_FAILED: RAW_MATERIAL_NOT_IN_BRANCH',
    }, 'en');
    expect(message).toContain('rolled back in full');
    expect(message).toContain('no GRN was saved');
  });

  it('recognizes the marker in a transport error, not just in JSON RPC data', () => {
    expect(purchaseReceiptFailureMessage({
      message: 'PURCHASE_RECEIPT_STOCK_FAILED: INCOMPATIBLE_PURCHASE_UNIT',
    }, 'en')).toContain('incompatible');
  });

  it('retains existing human-readable preflight rejection guidance', () => {
    expect(purchaseReceiptFailureMessage({error:'WAREHOUSE_REQUIRED'}, 'ar')).toContain('مستودع');
    expect(purchaseReceiptFailureMessage({error:'WAREHOUSE_BRANCH_MISMATCH'}, 'en')).toContain('another branch');
    expect(purchaseReceiptFailureMessage({error:'OVER_RECEIPT'}, 'en')).toContain('remaining');
    expect(purchaseReceiptFailureMessage({error:'NOT_RECEIVABLE'}, 'ar')).toContain('حالة');
    expect(purchaseReceiptFailureMessage({error:'INVALID_QUANTITY'}, 'ar')).toContain('صفر');
    expect(purchaseReceiptFailureMessage({error:'EMPTY_RECEIPT'}, 'en')).toContain('at least one');
    expect(purchaseReceiptFailureMessage({error:'PURCHASE_ITEM_NOT_FOUND'}, 'en')).toContain('does not belong');
  });

  it('does not misclassify unrelated SQL and transport failures', () => {
    expect(purchaseReceiptFailureMessage({error:'TRANSACTION_FAILED',detail:'duplicate key value'}, 'en')).toBeNull();
    expect(purchaseReceiptFailureMessage({message:'Network timeout'}, 'ar')).toBeNull();
    expect(purchaseReceiptFailureMessage(null, 'ar')).toBeNull();
    expect(purchaseReceiptFailureMessage({}, 'en')).toBeNull();
  });

  it('does not mistake an unrelated marker in a known preflight code for rollback success', () => {
    expect(purchaseReceiptFailureMessage({error:'OVER_RECEIPT',detail:'none'}, 'en')).toContain('remaining');
  });
});
