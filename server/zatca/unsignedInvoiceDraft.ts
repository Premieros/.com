/**
 * Saudi UBL 2.1 data-mapping prototype. NOT A ZATCA-COMPLIANT INVOICE.
 *
 * Produces a deterministic, unsigned XML draft only for mapping/rounding
 * regression tests. It deliberately has NO cryptographic hash, signature,
 * QR, invoice counter/PIH, certificate or submission interface and CANNOT be
 * passed to the ZATCA gateway as PreparedZatcaInvoice.
 *
 * The supported tax calculation is the standard 15% illustrative profile;
 * other VAT categories/exemptions, discount allocations, credit/debit notes,
 * and additional mandatory ZATCA fields require official spec review.
 */
export interface SaudiDraftLine {
  id: string;
  name: string;
  /** Positive quantity in thousandths of one unit (1000 = one unit). */
  quantityMilli: number;
  /** Unit price in Saudi halalas; no floating point money. */
  unitPriceMinor: number;
  /** Absolute line discount in halalas, before tax. */
  discountMinor: number;
}

export interface SaudiDraftInput {
  organizationId: string;
  branchId: string;
  egsDeviceId: string;
  invoiceNumber: string;
  uuid: string;
  /** Durable server-recorded date, not the browser's current time. */
  issueDate: string;
  sellerName: string;
  sellerVatNumber: string;
  buyerName: string;
  lines: SaudiDraftLine[];
}

export interface SaudiDraftTotals {
  taxExclusiveMinor: number;
  vatMinor: number;
  taxInclusiveMinor: number;
}

export interface UnsignedSaudiDraft {
  readonly status: 'unsigned_draft';
  readonly submittable: false;
  readonly xml: string;
  readonly totals: SaudiDraftTotals;
}

function assertSafeInt(value: number, name: string, allowZero = true): void {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`ZATCA_DRAFT_INVALID_${name}`);
  }
}

function roundDivide(n: bigint, denominator: bigint): bigint {
  return (n + denominator / 2n) / denominator;
}

function toSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ZATCA_DRAFT_AMOUNT_OVERFLOW');
  return Number(value);
}

function minorToCurrency(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

function milliToQuantity(value: number): string {
  return `${Math.floor(value / 1000)}.${String(value % 1000).padStart(3, '0')}`;
}

function xmlValue(value: string): string {
  if ([...value].some((char) => {
    const code = char.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      code === 0xfffe || code === 0xffff;
  })) {
    throw new Error('ZATCA_DRAFT_INVALID_XML_CHARACTER');
  }
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function required(value: string, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) {
    throw new Error(`ZATCA_DRAFT_MISSING_${name}`);
  }
  return xmlValue(value.trim());
}

/**
 * Validated input is immutable from the caller's point of view. A successful
 * draft is not evidence of accepted tax status or legally valid XML.
 */
export function buildUnsignedSaudiInvoiceDraft(input: SaudiDraftInput): UnsignedSaudiDraft {
  required(input.organizationId, 'ORGANIZATION');
  required(input.branchId, 'BRANCH');
  required(input.egsDeviceId, 'EGS');
  const invoiceNo = required(input.invoiceNumber, 'INVOICE_NUMBER');
  const uuid = required(input.uuid, 'UUID');
  const seller = required(input.sellerName, 'SELLER');
  const buyer = required(input.buyerName, 'BUYER');
  const vatNo = required(input.sellerVatNumber, 'SELLER_VAT');
  if (!/^\d{15}$/.test(input.sellerVatNumber)) throw new Error('ZATCA_DRAFT_INVALID_SELLER_VAT');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate) ||
    Number.isNaN(Date.parse(`${input.issueDate}T00:00:00Z`)) ||
    new Date(`${input.issueDate}T00:00:00Z`).toISOString().slice(0, 10) !== input.issueDate) {
    throw new Error('ZATCA_DRAFT_INVALID_ISSUE_DATE');
  }
  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 1000) {
    throw new Error('ZATCA_DRAFT_INVALID_LINES');
  }

  const seen = new Set<string>();
  let netTotal = 0n;
  let vatTotal = 0n;
  const lineXml: string[] = [];
  for (const line of input.lines) {
    const lineId = required(line.id, 'LINE_ID');
    const name = required(line.name, 'ITEM_NAME');
    if (seen.has(line.id)) throw new Error('ZATCA_DRAFT_DUPLICATE_LINE');
    seen.add(line.id);
    assertSafeInt(line.quantityMilli, 'QUANTITY', false);
    assertSafeInt(line.unitPriceMinor, 'PRICE');
    assertSafeInt(line.discountMinor, 'DISCOUNT');
    // Round each line's extended amount to halalas; do not use JS floats.
    const gross = roundDivide(BigInt(line.quantityMilli) * BigInt(line.unitPriceMinor), 1000n);
    if (BigInt(line.discountMinor) > gross) throw new Error('ZATCA_DRAFT_EXCESS_DISCOUNT');
    const net = gross - BigInt(line.discountMinor);
    // This prototype intentionally only covers the standard 15% VAT case.
    const tax = roundDivide(net * 1500n, 10000n);
    netTotal += net;
    vatTotal += tax;
    const netMinor = toSafeNumber(net);
    const taxMinor = toSafeNumber(tax);
    lineXml.push(`<cac:InvoiceLine><cbc:ID>${lineId}</cbc:ID><cbc:InvoicedQuantity unitCode="PCE">${milliToQuantity(line.quantityMilli)}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="SAR">${minorToCurrency(netMinor)}</cbc:LineExtensionAmount>${line.discountMinor > 0 ? `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="SAR">${minorToCurrency(line.discountMinor)}</cbc:Amount></cac:AllowanceCharge>` : ''}<cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${minorToCurrency(taxMinor)}</cbc:TaxAmount></cac:TaxTotal><cac:Item><cbc:Name>${name}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>15.00</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="SAR">${minorToCurrency(line.unitPriceMinor)}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`);
  }

  const netMinor = toSafeNumber(netTotal);
  const vatMinor = toSafeNumber(vatTotal);
  const payableMinor = toSafeNumber(netTotal + vatTotal);
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"><cbc:ID>${invoiceNo}</cbc:ID><cbc:UUID>${uuid}</cbc:UUID><cbc:IssueDate>${input.issueDate}</cbc:IssueDate><cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode><cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode><cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>${seller}</cbc:Name></cac:PartyName><cac:PartyTaxScheme><cbc:CompanyID>${vatNo}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty><cac:AccountingCustomerParty><cac:Party><cac:PartyName><cbc:Name>${buyer}</cbc:Name></cac:PartyName></cac:Party></cac:AccountingCustomerParty><cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${minorToCurrency(vatMinor)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="SAR">${minorToCurrency(netMinor)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="SAR">${minorToCurrency(vatMinor)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>15.00</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="SAR">${minorToCurrency(netMinor)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="SAR">${minorToCurrency(netMinor)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="SAR">${minorToCurrency(payableMinor)}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="SAR">${minorToCurrency(payableMinor)}</cbc:PayableAmount></cac:LegalMonetaryTotal>${lineXml.join('')}</Invoice>`;
  return {
    status: 'unsigned_draft',
    submittable: false,
    xml,
    totals: { taxExclusiveMinor: netMinor, vatMinor, taxInclusiveMinor: payableMinor },
  };
}
