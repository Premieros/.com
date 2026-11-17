/**
 * Unsigned Saudi invoice QR TLV preview (tags 1-5 only).
 *
 * This is deliberately NOT a Phase 2 compliant QR code: ZATCA additional
 * cryptographic tags, device/signature attestations, signed UBL and official
 * validation are absent. Never print this as an accepted Saudi e-invoice QR.
 *
 * The caller supplies immutable, authoritative invoice values and a UTC
 * timestamp. No clock, certificate, or secret is read by this module.
 */
import { Buffer } from 'node:buffer';

export interface UnsignedSaudiQrInput {
  sellerName: string;
  sellerVatNumber: string;
  issuedAtUtc: string;
  /** SAR, using exactly two decimals (e.g. "115.00"). */
  taxInclusiveAmount: string;
  /** SAR, using exactly two decimals (e.g. "15.00"). */
  vatAmount: string;
}

export interface UnsignedSaudiQrPreview {
  status: 'unsigned_preview';
  submittable: false;
  /** Base64 of the TLV bytes containing only informational tags 1 through 5. */
  base64: string;
}

function validateXmlLikeText(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim() || [...value].some((char) => char.charCodeAt(0) < 32)) {
    throw new Error(`ZATCA_QR_INVALID_${label}`);
  }
}

function tlv(tag: number, value: string): Buffer {
  const data = Buffer.from(value, 'utf8');
  if (data.length === 0 || data.length > 255) throw new Error('ZATCA_QR_TAG_LENGTH_INVALID');
  return Buffer.concat([Buffer.from([tag, data.length]), data]);
}

export function buildUnsignedSaudiQrPreview(input: UnsignedSaudiQrInput): UnsignedSaudiQrPreview {
  validateXmlLikeText(input.sellerName, 'SELLER');
  if (!/^\d{15}$/.test(input.sellerVatNumber)) throw new Error('ZATCA_QR_INVALID_VAT');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(input.issuedAtUtc) ||
    Number.isNaN(Date.parse(input.issuedAtUtc)) ||
    new Date(input.issuedAtUtc).toISOString().slice(0, 19) + 'Z' !== input.issuedAtUtc) {
    throw new Error('ZATCA_QR_INVALID_TIMESTAMP');
  }
  const money = /^\d{1,12}\.\d{2}$/;
  if (!money.test(input.taxInclusiveAmount) || !money.test(input.vatAmount)) {
    throw new Error('ZATCA_QR_INVALID_AMOUNT');
  }
  const cents = (s: string) => BigInt(s.replace('.', ''));
  if (cents(input.vatAmount) > cents(input.taxInclusiveAmount)) {
    throw new Error('ZATCA_QR_INVALID_VAT_TOTAL');
  }
  const bytes = Buffer.concat([
    tlv(1, input.sellerName.trim()),
    tlv(2, input.sellerVatNumber),
    tlv(3, input.issuedAtUtc),
    tlv(4, input.taxInclusiveAmount),
    tlv(5, input.vatAmount),
  ]);
  return { status: 'unsigned_preview', submittable: false, base64: bytes.toString('base64') };
}
