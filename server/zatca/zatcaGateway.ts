/**
 * Server-only ZATCA invoice API adapter.
 *
 * NOT imported from the browser bundle. Does not generate/validate UBL,
 * sign invoices, certify devices, reserve a transactional outbox, or activate
 * a tenant. The caller must do all of those BEFORE invoking this adapter.
 *
 * Endpoints are configured on the server from reviewed ZATCA specifications;
 * never accept an endpoint URL or credential from an HTTP request body.
 */
export type ZatcaChannel = 'clearance' | 'reporting';
export type ZatcaEnvironment = 'sandbox' | 'production';

export interface ZatcaApiCredentials {
  /** Retrieved from an encrypted server-side secrets store at execution time. */
  binarySecurityToken: string;
  secret: string;
}

export interface ZatcaGatewayConfig {
  environment: ZatcaEnvironment;
  /** Exact server-configured invoice endpoint for the chosen action. */
  clearanceUrl: string;
  reportingUrl: string;
  /** A separate server-side, audited production release switch. */
  productionApproved: boolean;
}

export interface PreparedZatcaInvoice {
  channel: ZatcaChannel;
  uuid: string;
  invoiceHash: string;
  /** Canonical signed and validated UBL XML, Base64-encoded server-side. */
  invoiceBase64: string;
}

/** Caller injects native fetch or a monitored server-side HTTP adapter. */
export type ZatcaHttpTransport = (url: string, init: {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}) => Promise<{ status: number; json: () => Promise<unknown> }>;

export type ZatcaGatewayResult =
  | { state: 'accepted'; channel: ZatcaChannel; httpStatus: number }
  | { state: 'rejected'; channel: ZatcaChannel; httpStatus: number }
  | { state: 'retry_required'; channel: ZatcaChannel; httpStatus: number | null };

function configuredEndpoint(urlString: string, environment: ZatcaEnvironment): string {
  let url: URL;
  try { url = new URL(urlString); } catch { throw new Error('ZATCA_ENDPOINT_NOT_CONFIGURED'); }
  // Do not send server credentials to arbitrary hosts, even if a URL is
  // accidentally overwritten in deployment configuration.
  if (url.protocol !== 'https:' || url.hostname !== 'gw-fatoora.zatca.gov.sa' ||
    url.port || url.username || url.password || url.search || url.hash) {
    throw new Error('ZATCA_ENDPOINT_NOT_ALLOWED');
  }
  const path = url.pathname;
  const correctEnvironment = environment === 'production'
    ? path.startsWith('/e-invoicing/core/')
    : path.startsWith('/e-invoicing/developer-portal/') ||
      path.startsWith('/e-invoicing/simulation/');
  if (!correctEnvironment) throw new Error('ZATCA_ENVIRONMENT_MISMATCH');
  return url.toString();
}

function hasSafePayload(invoice: PreparedZatcaInvoice): boolean {
  return (invoice.channel === 'clearance' || invoice.channel === 'reporting') &&
    typeof invoice.uuid === 'string' && invoice.uuid.trim().length > 0 &&
    typeof invoice.invoiceHash === 'string' && invoice.invoiceHash.trim().length > 0 &&
    typeof invoice.invoiceBase64 === 'string' && invoice.invoiceBase64.length > 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(invoice.invoiceBase64) &&
    invoice.invoiceBase64.length % 4 === 0;
}

function acknowledged(channel: ZatcaChannel, response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const values = response as Record<string, unknown>;
  // HTTP 200 alone does NOT prove ZATCA acceptance.
  return channel === 'clearance'
    ? values.clearanceStatus === 'CLEARED' && typeof values.clearedInvoice === 'string'
    : values.reportingStatus === 'REPORTED';
}

export async function transmitPreparedZatcaInvoice(
  config: ZatcaGatewayConfig,
  invoice: PreparedZatcaInvoice,
  loadCredentials: () => Promise<ZatcaApiCredentials>,
  transport: ZatcaHttpTransport,
): Promise<ZatcaGatewayResult> {
  if (!hasSafePayload(invoice)) throw new Error('ZATCA_INVALID_PREPARED_INVOICE');
  if (config.environment !== 'sandbox' && config.environment !== 'production') {
    throw new Error('ZATCA_UNKNOWN_ENVIRONMENT');
  }
  if (config.environment === 'production' && !config.productionApproved) {
    throw new Error('ZATCA_PRODUCTION_NOT_APPROVED');
  }
  const endpoint = configuredEndpoint(
    invoice.channel === 'clearance' ? config.clearanceUrl : config.reportingUrl,
    config.environment,
  );
  const credentials = await loadCredentials();
  if (!credentials.binarySecurityToken || !credentials.secret) {
    throw new Error('ZATCA_CREDENTIALS_MISSING');
  }

  const { Buffer } = await import('node:buffer');
  const basic = Buffer.from(
    `${credentials.binarySecurityToken}:${credentials.secret}`, 'utf8',
  ).toString('base64');
  // Do not log credentials, request bodies, raw XML, or API response details.
  let response: Awaited<ReturnType<ZatcaHttpTransport>>;
  try {
    response = await transport(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        'Accept-Version': 'V2',
        ...(invoice.channel === 'clearance' ? { 'Clearance-Status': '1' } : {}),
      },
      body: JSON.stringify({
        invoiceHash: invoice.invoiceHash,
        uuid: invoice.uuid,
        invoice: invoice.invoiceBase64,
      }),
    });
  } catch {
    // Network uncertainty: NEVER silently retry. The durable worker must
    // reconcile the previous submission before attempting a new send.
    return { state: 'retry_required', channel: invoice.channel, httpStatus: null };
  }

  if (response.status === 429 || response.status >= 500) {
    return { state: 'retry_required', channel: invoice.channel, httpStatus: response.status };
  }
  if (response.status !== 200) {
    return { state: 'rejected', channel: invoice.channel, httpStatus: response.status };
  }
  try {
    const result = await response.json();
    return {
      state: acknowledged(invoice.channel, result) ? 'accepted' : 'rejected',
      channel: invoice.channel, httpStatus: response.status,
    };
  } catch {
    return { state: 'retry_required', channel: invoice.channel, httpStatus: response.status };
  }
}
