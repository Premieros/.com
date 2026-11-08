import { describe, expect, it } from 'vitest';
import { needsKitchenDispatchBeforeSettlement } from '@/features/pos/utils/unsentCheckoutGuard';

describe('POS unsent items checkout policy', () => {
  it('blocks payment and customer-check printing for an open order with unsent lines', () => {
    expect(needsKitchenDispatchBeforeSettlement('order-1', true)).toBe(true);
  });

  it('does not block ordinary direct sales or fully dispatched open orders', () => {
    expect(needsKitchenDispatchBeforeSettlement(null, true)).toBe(false);
    expect(needsKitchenDispatchBeforeSettlement(undefined, true)).toBe(false);
    expect(needsKitchenDispatchBeforeSettlement('order-1', false)).toBe(false);
  });
});
