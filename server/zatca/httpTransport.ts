/**
 * Explicit server-side HTTP transport. This module does not call ZATCA when
 * imported: only a trusted worker can create and invoke this transport.
 * The gateway separately enforces the exact ZATCA origin and environment.
 */
import type { ZatcaHttpTransport } from './zatcaGateway';

/**
 * Inject fetch from a trusted server runtime. A bounded timeout prevents
 * unresponsive endpoints from hanging workers forever; the caller must
 * reconcile uncertain outcomes rather than blindly retry.
 */
export function createZatcaFetchTransport(
  fetchImpl: typeof fetch,
  timeoutMs = 20_000,
): ZatcaHttpTransport {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new Error('ZATCA_INVALID_HTTP_TIMEOUT');
  }
  return async (url, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: controller.signal,
        redirect: 'error',
        cache: 'no-store',
      });
      // Read the body inside the timeout window. The caller handles parsing
      // and must not treat HTTP 200 alone as authority acceptance.
      const body = await response.text();
      return { status: response.status, json: async () => JSON.parse(body) as unknown };
    } finally {
      clearTimeout(timeout);
    }
  };
}
