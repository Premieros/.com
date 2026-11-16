import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { computePosTotals } from '@/lib/posMath';

const source = (path: string) => readFileSync(path, 'utf8');
const totals = (discountType: 'amount' | 'percent', discountAmount: number, paidAmount = 0) =>
  computePosTotals({
    items: [{ quantity: 2, unit_price: 50, discount_amount: 0 }],
    discountType, discountAmount,
    taxRate: 14, taxEnabled: true, paidAmount, paymentMethod: 'cash',
  });

describe('POS sale safety hardening', () => {
  it('clamps invalid percentage and amount discounts before tax', () => {
    expect(totals('percent', 200).total).toBe(0);
    expect(totals('amount', 999).total).toBe(0);
    expect(totals('percent', -20).total).toBe(114);
    expect(totals('amount', 20).total).toBe(91.2);
  });

  it('never reports change for an explicitly zero tender', () => {
    expect(totals('amount', 0, 0).change).toBe(0);
    expect(totals('amount', 0, 150).change).toBe(36);
  });

  it('blocks approval-only transfers at offline capture and at the durable outbox boundary', () => {
    const payment = source('src/features/pos/services/payment.ts');
    expect(payment).toContain("throw new Error('MANUAL_PAYMENT_REQUIRES_ONLINE_APPROVAL')");
    expect(payment.match(/error: 'MANUAL_PAYMENT_REQUIRES_ONLINE_APPROVAL'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(payment).toContain('const splitPayments = consumeArmedSplitTender();');
    expect(payment).toContain("error: 'SPLIT_MANUAL_PAYMENT_UNSUPPORTED'");
  });

  it('clears confirmed linked orders before optional printer side effects, which cannot fail settlement', () => {
    const order = source('src/features/pos/hooks/usePosOrder.ts');
    const settled = order.indexOf('if (extended.order_completed) {');
    const print = order.indexOf('const queued = await enqueueAutomaticReceiptPrint({', settled);
    expect(settled).toBeGreaterThan(0);
    expect(print).toBeGreaterThan(settled);
    expect(order.slice(print - 40, print)).toContain('try {');
    expect(order.slice(print, print + 1200)).toContain('} catch {');
    expect(order).toContain('base.paidAmount <= 0');
    expect(order).not.toContain('base.paidAmount || preview.total');
  });

  it('requires a positive tender for non-credit sales at both hook and payment UI', () => {
    const base = source('src/features/pos/hooks/usePosOrderBase.ts');
    const payUi = source('src/features/pos/components/checkout/PaymentPanel.tsx');
    expect(base).toContain("paymentMethod !== 'credit' && total > 0 && paidAmount <= 0");
    expect(base).toContain("paymentMethod === 'credit' ? 0 : paidAmount;");
    expect(payUi).toContain('p.paidAmount <= 0');
    expect(source('src/features/pos/components/order/CurrentOrderPanel.tsx'))
      .toContain("discountType === 'percent' ? 100 : Math.max(0, subtotal)");
  });
});
