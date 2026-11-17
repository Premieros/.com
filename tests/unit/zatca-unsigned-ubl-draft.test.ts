import { describe, expect, it } from 'vitest';
import { buildUnsignedSaudiInvoiceDraft, type SaudiDraftInput } from '../../server/zatca/unsignedInvoiceDraft';

const fixture: SaudiDraftInput = {
  organizationId: 'sa-org',
  branchId: 'sa-branch',
  egsDeviceId: 'sa-egs',
  invoiceNumber: 'P-1001',
  uuid: '11111111-1111-4111-8111-111111111111',
  issueDate: '2026-11-17',
  sellerName: 'شركة تجريبية',
  sellerVatNumber: '300000000000003',
  buyerName: 'Test customer',
  lines: [
    { id: '1', name: 'Coffee', quantityMilli: 2000, unitPriceMinor: 1000, discountMinor: 0 },
    { id: '2', name: 'Tea', quantityMilli: 1000, unitPriceMinor: 500, discountMinor: 100 },
  ],
};

describe('Saudi unsigned UBL draft (never submittable)', () => {
  it('produces deterministic money and VAT totals without floating-point currency', () => {
    const a = buildUnsignedSaudiInvoiceDraft(fixture);
    const b = buildUnsignedSaudiInvoiceDraft(fixture);
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      status: 'unsigned_draft', submittable: false,
      totals: { taxExclusiveMinor: 2400, vatMinor: 360, taxInclusiveMinor: 2760 },
    });
    expect(a.xml).toContain('<cbc:PayableAmount currencyID="SAR">27.60</cbc:PayableAmount>');
    expect(a.xml).toContain('<cbc:TaxAmount currencyID="SAR">3.60</cbc:TaxAmount>');
    expect(a.xml).not.toContain('<cbc:DiscountAmount');
  });

  it('handles fractional quantity and line-level halala rounding', () => {
    const a = buildUnsignedSaudiInvoiceDraft({
      ...fixture,
      lines: [{ id: '1', name: 'Item', quantityMilli: 1250, unitPriceMinor: 101, discountMinor: 0 }],
    });
    expect(a.totals).toEqual({
      taxExclusiveMinor: 126, vatMinor: 19, taxInclusiveMinor: 145,
    });
    expect(a.xml).toContain('1.250</cbc:InvoicedQuantity>');
  });

  it('escapes external product and customer text without XML injection', () => {
    const a = buildUnsignedSaudiInvoiceDraft({
      ...fixture, buyerName: 'A & <Corp>',
      lines: [{ id: 'a', name: 'Tea & <drink> "special"', quantityMilli: 1000, unitPriceMinor: 100, discountMinor: 0 }],
    });
    expect(a.xml).toContain('A &amp; &lt;Corp&gt;');
    expect(a.xml).toContain('Tea &amp; &lt;drink&gt; &quot;special&quot;');
    expect(a.xml).not.toContain('<drink>');
  });

  it('rejects negative quantities, malformed numbers, excessive discounts and duplicate lines', () => {
    const line = fixture.lines[0];
    expect(() => buildUnsignedSaudiInvoiceDraft({ ...fixture, lines: [{ ...line, quantityMilli: -1 }] }))
      .toThrow('ZATCA_DRAFT_INVALID_QUANTITY');
    expect(() => buildUnsignedSaudiInvoiceDraft({ ...fixture, lines: [{ ...line, unitPriceMinor: Infinity }] }))
      .toThrow('ZATCA_DRAFT_INVALID_PRICE');
    expect(() => buildUnsignedSaudiInvoiceDraft({ ...fixture, lines: [{ ...line, discountMinor: 2001 }] }))
      .toThrow('ZATCA_DRAFT_EXCESS_DISCOUNT');
    expect(() => buildUnsignedSaudiInvoiceDraft({ ...fixture, lines: [line, line] }))
      .toThrow('ZATCA_DRAFT_DUPLICATE_LINE');
  });

  it('fails on missing scope, invalid VAT shape and dates, and invalid XML characters', () => {
    expect(() => buildUnsignedSaudiInvoiceDraft({ ...fixture, organizationId: '' }))
      .toThrow('ZATCA_DRAFT_MISSING_ORGANIZATION');
    expect(() => buildUnsignedSaudiInvoiceDraft({ ...fixture, sellerVatNumber: 'abc' }))
      .toThrow('ZATCA_DRAFT_INVALID_SELLER_VAT');
    expect(() => buildUnsignedSaudiInvoiceDraft({ ...fixture, issueDate: '2026-02-30' }))
      .toThrow('ZATCA_DRAFT_INVALID_ISSUE_DATE');
    expect(() => buildUnsignedSaudiInvoiceDraft({ ...fixture, buyerName: 'abc\u0001' }))
      .toThrow('ZATCA_DRAFT_INVALID_XML_CHARACTER');
  });

  it('refuses an amount overflow instead of losing financial precision', () => {
    expect(() => buildUnsignedSaudiInvoiceDraft({
      ...fixture, lines: [{ id: '1', name: 'Expensive', quantityMilli: Number.MAX_SAFE_INTEGER,
        unitPriceMinor: Number.MAX_SAFE_INTEGER, discountMinor: 0 }],
    })).toThrow('ZATCA_DRAFT_AMOUNT_OVERFLOW');
  });
});
