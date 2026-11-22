import { expect, it } from 'vitest';
import { previewItemSplit } from '@/features/pos/components/tables/TransferItemModal';

it('shows the BUNKER split as 11.40 on each bill', () => {
  const amounts = previewItemSplit(
    { subtotal: 20, discount_amount: 0, tax_amount: 2.8 },
    { subtotal: 0, discount_amount: 0, tax_amount: 0 },
    10,
    1,
  );

  expect(amounts).toEqual([
    { subtotal: 10, discount_amount: 0, tax_amount: 1.4 },
    { subtotal: 10, discount_amount: 0, tax_amount: 1.4 },
  ]);
});

it('adds the moved share to an existing bill and keeps the cent remainder on the original', () => {
  expect(previewItemSplit(
    { subtotal: 30, discount_amount: 1, tax_amount: 4.06 },
    { subtotal: 15, discount_amount: 0.5, tax_amount: 2.03 },
    10,
    1,
  )).toEqual([
    { subtotal: 20, discount_amount: 0.67, tax_amount: 2.71 },
    { subtotal: 25, discount_amount: 0.83, tax_amount: 3.38 },
  ]);
});
