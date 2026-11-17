/**
 * Server-side routing boundary between a durable outbox lease and ZATCA.
 * This does not create or claim a database outbox row. Only a trusted worker
 * may construct an OutboxLease after authorizing and atomically claiming a
 * durable invoice event. It must reconcile and persist the result separately.
 */
import {
  planZatcaSubmission,
  type ZatcaIntegrationContext,
  type ZatcaInvoiceReference,
} from '../../src/features/invoicing/saudi/zatcaSubmissionPolicy';
import {
  evaluateZatcaOnboarding,
  type ZatcaOnboardingStatus,
} from '../../src/features/invoicing/saudi/zatcaOnboardingReadiness';
import {
  transmitPreparedZatcaInvoice,
  type PreparedZatcaInvoice,
  type ZatcaGatewayConfig,
  type ZatcaGatewayResult,
  type ZatcaApiCredentials,
  type ZatcaHttpTransport,
} from './zatcaGateway';

export interface ZatcaOutboxLease {
  /** A durable, exclusive and not-yet-acknowledged outbox claim. */
  claimed: boolean;
  organizationId: string;
  branchId: string;
  egsDeviceId: string;
  invoiceId: string;
  payload: PreparedZatcaInvoice;
}

export type ZatcaDispatchResult =
  | { state: 'blocked'; reason: 'outbox_not_claimed' | 'scope_mismatch' |
      'not_ready' | 'policy_blocked' | 'channel_mismatch' | 'environment_mismatch' }
  | ZatcaGatewayResult;

/**
 * A private worker must prove identity and queue ownership before the gateway
 * may emit a request. The caller is responsible for persistence, authorization,
 * signatures, EGS chain continuity and reconciling ambiguous responses.
 */
export async function dispatchZatcaOutboxLease(
  lease: ZatcaOutboxLease,
  invoice: ZatcaInvoiceReference,
  integration: ZatcaIntegrationContext,
  onboarding: ZatcaOnboardingStatus,
  gateway: ZatcaGatewayConfig,
  loadCredentials: () => Promise<ZatcaApiCredentials>,
  transport: ZatcaHttpTransport,
): Promise<ZatcaDispatchResult> {
  if (!lease.claimed) return { state: 'blocked', reason: 'outbox_not_claimed' };

  if (!lease.organizationId || !lease.branchId || !lease.egsDeviceId ||
      !lease.invoiceId || lease.organizationId !== invoice.organizationId ||
      lease.branchId !== invoice.branchId || lease.invoiceId !== invoice.invoiceId ||
      lease.organizationId !== onboarding.organizationId ||
      lease.branchId !== onboarding.branchId ||
      lease.egsDeviceId !== onboarding.egsDeviceId) {
    return { state: 'blocked', reason: 'scope_mismatch' };
  }

  if (onboarding.environment !== gateway.environment) {
    return { state: 'blocked', reason: 'environment_mismatch' };
  }
  if (!evaluateZatcaOnboarding(onboarding).ready) {
    return { state: 'blocked', reason: 'not_ready' };
  }

  const decision = planZatcaSubmission(integration, invoice);
  if (!decision.ready) return { state: 'blocked', reason: 'policy_blocked' };

  if (lease.payload.channel !== decision.action) {
    return { state: 'blocked', reason: 'channel_mismatch' };
  }
  return transmitPreparedZatcaInvoice(gateway, lease.payload, loadCredentials, transport);
}
