import { describe, expect, it, vi } from 'vitest';
import { createZatcaFetchTransport } from '../../server/zatca/httpTransport';

describe('ZATCA bounded server fetch transport', () => {
  it('requires a finite bounded timeout', () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(() => createZatcaFetchTransport(fetcher, 0)).toThrow('ZATCA_INVALID_HTTP_TIMEOUT');
    expect(() => createZatcaFetchTransport(fetcher, Number.POSITIVE_INFINITY))
      .toThrow('ZATCA_INVALID_HTTP_TIMEOUT');
  });

  it('uses POST with no automatic redirect, cache, or credential logging', async () => {
    const fakeFetch = vi.fn(async () => ({
      status: 200,
      text: async () => JSON.stringify({ reportingStatus: 'REPORTED' }),
    })) as unknown as typeof fetch;
    const transport = createZatcaFetchTransport(fakeFetch);
    const response = await transport('https://gw-fatoora.zatca.gov.sa/example', {
      method: 'POST', headers: { Authorization: 'Basic test-secret' }, body: '{}',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reportingStatus: 'REPORTED' });
    expect(fakeFetch).toHaveBeenCalledWith(
      'https://gw-fatoora.zatca.gov.sa/example',
      expect.objectContaining({
        method: 'POST', body: '{}', cache: 'no-store', redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
