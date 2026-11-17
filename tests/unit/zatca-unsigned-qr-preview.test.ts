import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { buildUnsignedSaudiQrPreview } from '../../server/zatca/unsignedQrPreview';

const input = {
  sellerName: 'متجر الرياض',
  sellerVatNumber: '300000000000003',
  issuedAtUtc: '2026-11-17T09:00:00Z',
  taxInclusiveAmount: '115.00',
  vatAmount: '15.00',
};

function decode(base64: string): Array<{ tag: number; value: string; length: number }> {
  const raw = Buffer.from(base64, 'base64');
  const result: Array<{ tag: number; value: string; length: number }> = [];
  for (let offset = 0; offset < raw.length;) {
    const tag = raw[offset++];
    const length = raw[offset++];
    const value = raw.subarray(offset, offset + length).toString('utf8');
    result.push({ tag, value, length });
    offset += length;
  }
  return result;
}

describe('unsigned Saudi QR TLV preview', () => {
  it('encodes the first five informational tags with UTF-8 byte lengths', () => {
    const result = buildUnsignedSaudiQrPreview(input);
    expect(result).toMatchObject({ status: 'unsigned_preview', submittable: false });
    const rows = decode(result.base64);
    expect(rows.map(row => row.tag)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0].value).toBe('متجر الرياض');
    expect(rows[0].length).toBe(Buffer.byteLength('متجر الرياض', 'utf8'));
    expect(rows[1].value).toBe('300000000000003');
    expect(rows[2].value).toBe('2026-11-17T09:00:00Z');
    expect(rows[3].value).toBe('115.00');
    expect(rows[4].value).toBe('15.00');
  });

  it('fails for incorrect VAT number, timestamp, amount or inconsistent VAT', () => {
    expect(() => buildUnsignedSaudiQrPreview({ ...input, sellerVatNumber: 'invalid' }))
      .toThrow('ZATCA_QR_INVALID_VAT');
    expect(() => buildUnsignedSaudiQrPreview({ ...input, issuedAtUtc: '2026-02-30T09:00:00Z' }))
      .toThrow('ZATCA_QR_INVALID_TIMESTAMP');
    expect(() => buildUnsignedSaudiQrPreview({ ...input, taxInclusiveAmount: 'NaN' }))
      .toThrow('ZATCA_QR_INVALID_AMOUNT');
    expect(() => buildUnsignedSaudiQrPreview({ ...input, vatAmount: '116.00' }))
      .toThrow('ZATCA_QR_INVALID_VAT_TOTAL');
  });

  it('enforces QR single-tag byte length rather than JavaScript character count', () => {
    expect(() => buildUnsignedSaudiQrPreview({
      ...input, sellerName: 'م'.repeat(129),
    })).toThrow('ZATCA_QR_TAG_LENGTH_INVALID');
  });
});
