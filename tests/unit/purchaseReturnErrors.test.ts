import { describe, expect, it } from 'vitest';
import { purchaseReturnFailureMessage } from '@/features/trade/utils/purchaseReturnErrors';

describe('purchase-return FIFO failure messages', () => {
  it('translates a nested shortage exception for Arabic cashiers', () => {
    const message = purchaseReturnFailureMessage(
      { error: 'TRANSACTION_FAILED', detail: 'PURCHASE_RETURN_INSUFFICIENT_STOCK' }, 'ar',
    );
    expect(message).toContain('مخزون');
    expect(message).toContain('لم يُعتمد');
    expect(message).not.toContain('PURCHASE_RETURN_');
  });

  it('gives English users a non-committed outcome rather than a success message', () => {
    const message = purchaseReturnFailureMessage(
      { error: 'TRANSACTION_FAILED', detail: 'PURCHASE_RETURN_INSUFFICIENT_STOCK' }, 'en',
    );
    expect(message).toContain('insufficient stock');
    expect(message).toContain('not committed');
  });

  it('translates FIFO helper failure from transport message or RPC detail', () => {
    expect(purchaseReturnFailureMessage(
      { message: 'PURCHASE_RETURN_FIFO_FAILED: WAREHOUSE_REQUIRED' }, 'en',
    )).toContain('warehouse');
    expect(purchaseReturnFailureMessage(
      { error: 'TRANSACTION_FAILED', detail: 'PURCHASE_RETURN_FIFO_FAILED: INCOMPATIBLE_PURCHASE_UNIT' }, 'ar',
    )).toContain('وحدة القياس');
  });

  it('prioritizes specific shortage guidance ahead of generic helper failure', () => {
    const message = purchaseReturnFailureMessage(
      { error: 'PURCHASE_RETURN_FIFO_FAILED', detail: 'PURCHASE_RETURN_INSUFFICIENT_STOCK' }, 'en',
    );
    expect(message).toContain('insufficient stock');
  });

  it('leaves unrelated server errors for the existing error handler', () => {
    expect(purchaseReturnFailureMessage(
      { error: 'NOT_ALLOWED', detail: 'Missing permissions' }, 'ar',
    )).toBeNull();
    expect(purchaseReturnFailureMessage(null, 'en')).toBeNull();
  });
});
