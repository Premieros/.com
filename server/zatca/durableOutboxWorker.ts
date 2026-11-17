/**
 * ZATCA durable-outbox worker contract, not a persistent outbox implementation.
 *
 * An authenticated private database adapter must atomically claim exactly one
 * immutable event, keep the claim leased across process failures and compare
 * leaseToken on completion. Its DB state must be written in the SAME
 * transaction as invoice issuance; this module cannot guarantee that alone.
 *
 * Crucially, a lost/ambiguous request is quarantined for explicit authority
 * reconciliation. It must not be automatically retried (including after a
 * crashed worker with an expired lease).
 */
import {
  dispatchZatcaOutboxLease,
  type ZatcaOutboxLease,
  type ZatcaDispatchResult,
} from './zatcaWorkerBoundary';
import type {
  ZatcaIntegrationContext, ZatcaInvoiceReference,
} from '../../src/features/invoicing/saudi/zatcaSubmissionPolicy';
import type {
  ZatcaOnboardingStatus,
} from '../../src/features/invoicing/saudi/zatcaOnboardingReadiness';
import type {
  ZatcaGatewayConfig, ZatcaApiCredentials, ZatcaHttpTransport,
} from './zatcaGateway';

export type ZatcaOutboxStatus =
  | 'queued'
  | 'leased'
  | 'accepted'
  | 'rejected'
  | 'needs_reconciliation'
  | 'blocked';

export interface ClaimedZatcaEvent {
  /** Opaque fencing token from a SERIALIZABLE or equivalent atomic DB claim. */
  leaseToken: string;
  /** Stable unique event identifier from a durable invoice transaction. */
  eventId: string;
  /** Immutable stored scope + signed payload; never browser-supplied. */
  lease: ZatcaOutboxLease;
  invoice: ZatcaInvoiceReference;
  integration: ZatcaIntegrationContext;
  onboarding: ZatcaOnboardingStatus;
  gateway: ZatcaGatewayConfig;
}

export interface ZatcaOutboxCompletion {
  eventId: string;
  leaseToken: string;
  status: Exclude<ZatcaOutboxStatus, 'queued' | 'leased'>;
  /** Unsigned, non-sensitive HTTP code. Never include XML or credentials. */
  httpStatus: number | null;
  /** String enum only, never the raw authority body. */
  reason: string | null;
}

/**
 * Implementations MUST use DB transactions, uniqueness and a compare-and-swap
 * leaseToken check. They MUST NOT auto-reclaim an expired leased event as
 * ready-to-send: first reconcile potential submission with ZATCA.
 */
export interface ZatcaDurableOutboxStore {
  claimQueued(eventId: string): Promise<ClaimedZatcaEvent | null>;
  completeClaim(completion: ZatcaOutboxCompletion): Promise<void>;
}

export type ZatcaOutboxWorkerResult =
  | { state: 'not_claimed' }
  | { state: 'recorded'; status: ZatcaOutboxCompletion['status'] };

/** Convert a dispatch result into one terminal/hold state, without any retry. */
export function classifyZatcaDispatch(
  event: Pick<ClaimedZatcaEvent, 'eventId' | 'leaseToken'>,
  result: ZatcaDispatchResult,
): ZatcaOutboxCompletion {
  if (!event.eventId?.trim() || !event.leaseToken?.trim()) {
    throw new Error('ZATCA_OUTBOX_INVALID_CLAIM');
  }
  if (result.state === 'accepted') {
    return { eventId: event.eventId, leaseToken: event.leaseToken,
      status: 'accepted', httpStatus: result.httpStatus, reason: null };
  }
  if (result.state === 'rejected') {
    return { eventId: event.eventId, leaseToken: event.leaseToken,
      status: 'rejected', httpStatus: result.httpStatus, reason: null };
  }
  if (result.state === 'retry_required') {
    return { eventId: event.eventId, leaseToken: event.leaseToken,
      status: 'needs_reconciliation', httpStatus: result.httpStatus,
      reason: 'uncertain_authority_outcome' };
  }
  return { eventId: event.eventId, leaseToken: event.leaseToken,
    status: 'blocked', httpStatus: null, reason: result.reason };
}

/**
 * A single bounded dispatch attempt. It NEVER retries and never creates
 * invoices or leases. Throws on a failed persistence call, so an operational
 * alert can quarantine this event rather than mark it successfully sent.
 */
export async function processZatcaOutboxEvent(
  eventId: string,
  store: ZatcaDurableOutboxStore,
  loadCredentials: () => Promise<ZatcaApiCredentials>,
  transport: ZatcaHttpTransport,
): Promise<ZatcaOutboxWorkerResult> {
  if (!eventId?.trim()) throw new Error('ZATCA_OUTBOX_EVENT_ID_REQUIRED');
  const event = await store.claimQueued(eventId);
  if (!event) return { state: 'not_claimed' };
  if (!event.eventId?.trim() || event.eventId !== eventId ||
      !event.leaseToken?.trim() || !event.lease.claimed) {
    // Malformed claim: do not send anything, and do not make up a lease token
    // to finalize an unowned DB event.
    throw new Error('ZATCA_OUTBOX_INVALID_CLAIM');
  }

  let result: ZatcaDispatchResult;
  try {
    result = await dispatchZatcaOutboxLease(
      event.lease, event.invoice, event.integration, event.onboarding,
      event.gateway, loadCredentials, transport,
    );
  } catch {
    // Even pre-request failures must not cause a blind automatic replay:
    // callback/transport failure could have happened after the remote send.
    result = { state: 'retry_required', channel: event.lease.payload.channel,
      httpStatus: null };
  }
  const completion = classifyZatcaDispatch(event, result);
  await store.completeClaim(completion);
  return { state: 'recorded', status: completion.status };
}
