import { describe, expect, it, vi } from 'vitest';
import {
  transmitPreparedZatcaInvoice,
  type ZatcaGatewayConfig,
  type PreparedZatcaInvoice,
  type ZatcaHttpTransport,
} from '../../server/zatca/zatcaGateway';

const config: ZatcaGatewayConfig = {
  environment: 'sandbox',
  clearanceUrl: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/invoices/clearance/single',
  reportingUrl: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/invoices/reporting/single',
  productionApproved: false,
};
const invoice: PreparedZatcaInvoice = {
  channel: 'reporting',
  uuid: 'invoice-uuid',
  invoiceHash: 'hash-placeholder',
  invoiceBase64: 'PHhtbC8+',
};
const credentials = vi.fn(async () => ({
  binarySecurityToken: 'test-only-token', secret: 'test-only-secret',
}));
const respond = (status: number, data: unknown) => vi.fn(async () => ({
  status, json: async () => data,
}));

describe('ZATCA server transport (mock only; no actual transmission)', () => {
  it('reports a prepared simplified invoice only after explicit positive authority response', async () => {
    const fetch = respond(200, { reportingStatus: 'REPORTED' });
    const result = await transmitPreparedZatcaInvoice(config, invoice, credentials, fetch);
    expect(result).toEqual({ state: 'accepted', channel: 'reporting', httpStatus: 200 });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, request] = fetch.mock.calls[0] as unknown as [string, Parameters<ZatcaHttpTransport>[1]];
    expect(url).toBe(config.reportingUrl);
    expect(request.headers.Authorization).toMatch(/^Basic /);
    expect(request.body).toEqual(JSON.stringify({
      invoiceHash: 'hash-placeholder', uuid: 'invoice-uuid', invoice: 'PHhtbC8+',
    }));
    expect(request.headers['Clearance-Status']).toBeUndefined();
  });

  it('clears a standard invoice only after a clearance acknowledgment and cleared XML', async () => {
    const fetch = respond(200, { clearanceStatus: 'CLEARED', clearedInvoice: 'c2lnbmVk' });
    expect(await transmitPreparedZatcaInvoice(config, {
      ...invoice, channel: 'clearance',
    }, credentials, fetch)).toEqual({
      state: 'accepted', channel: 'clearance', httpStatus: 200,
    });
    expect((fetch.mock.calls[0] as unknown as [string, Parameters<ZatcaHttpTransport>[1]])[1]
      .headers['Clearance-Status']).toBe('1');
  });

  it('does not mistake an HTTP 200 warning/invalid response for invoice acceptance', async () => {
    expect(await transmitPreparedZatcaInvoice(config, invoice, credentials,
      respond(200, { reportingStatus: 'NOT_REPORTED' }))).toMatchObject({ state: 'rejected' });
    expect(await transmitPreparedZatcaInvoice(config, {
      ...invoice, channel: 'clearance',
    }, credentials, respond(200, { clearanceStatus: 'CLEARED' })))
      .toMatchObject({ state: 'rejected' });
  });

  it('blocks production without a separate server-side approval', async () => {
    const fetch = respond(200, { reportingStatus: 'REPORTED' });
    await expect(transmitPreparedZatcaInvoice({
      ...config, environment: 'production',
      reportingUrl: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core/invoices/reporting/single',
    }, invoice, credentials, fetch)).rejects.toThrow('ZATCA_PRODUCTION_NOT_APPROVED');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects leaked endpoints, cross-environment URLs and malformed prepared XML before loading credentials', async () => {
    credentials.mockClear();
    const fetch = respond(200, { reportingStatus: 'REPORTED' });
    await expect(transmitPreparedZatcaInvoice({
      ...config, reportingUrl: 'https://attacker.invalid/x',
    }, invoice, credentials, fetch)).rejects.toThrow('ZATCA_ENDPOINT_NOT_ALLOWED');
    await expect(transmitPreparedZatcaInvoice({
      ...config, reportingUrl: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core/invoices/reporting/single',
    }, invoice, credentials, fetch)).rejects.toThrow('ZATCA_ENVIRONMENT_MISMATCH');
    await expect(transmitPreparedZatcaInvoice(config, {
      ...invoice, invoiceBase64: 'not base64??',
    }, credentials, fetch)).rejects.toThrow('ZATCA_INVALID_PREPARED_INVOICE');
    expect(credentials).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires reconciliation for throttling, ambiguous network failures and server errors', async () => {
    expect(await transmitPreparedZatcaInvoice(config, invoice, credentials,
      respond(429, null))).toMatchObject({ state: 'retry_required', httpStatus: 429 });
    expect(await transmitPreparedZatcaInvoice(config, invoice, credentials,
      respond(503, null))).toMatchObject({ state: 'retry_required', httpStatus: 503 });
    const fail = vi.fn(async () => { throw new Error('offline'); });
    expect(await transmitPreparedZatcaInvoice(config, invoice, credentials, fail))
      .toMatchObject({ state: 'retry_required', httpStatus: null });
  });

  it('records a rejected response without returning sensitive authority details', async () => {
    const result = await transmitPreparedZatcaInvoice(config, invoice, credentials,
      respond(400, { message: 'sensitive error details' }));
    expect(result).toEqual({ state: 'rejected', channel: 'reporting', httpStatus: 400 });
    expect(JSON.stringify(result)).not.toContain('sensitive');
  });
});
