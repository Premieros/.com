import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/features/trade/pages/SalesPage.tsx', 'utf8');
const save = source.slice(source.indexOf('  const saveSaleEdit = async () => {'), source.indexOf('  const remove = async () => {'));

describe('sales editing must not bypass authoritative invoice lifecycle', () => {
  it('keeps metadata edits away from status, total, payments and discounts', () => {
    const updateStart = save.indexOf("supabase.from('sales').update({");
    expect(updateStart).toBeGreaterThan(0);
    const fields = save.slice(updateStart, save.indexOf("}).eq('id', viewSale.id)", updateStart));
    expect(fields).toContain('customer_id: editForm.customer_id || null');
    expect(fields).toContain('notes: editForm.notes || null');
    for (const blocked of ['status:', 'total:', 'subtotal:', 'paid_amount:', 'tax_amount:', 'discount_amount:', 'refunded_amount:']) {
      expect(fields).not.toContain(blocked);
    }
  });

  it('removes direct status selection and retains protected payment changes', () => {
    expect(source).not.toContain("onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}");
    expect(save).toContain("supabase.rpc('change_sale_payment_method'");
    expect(source).toContain('api.trade.archiveReturnedSale');
  });
});
