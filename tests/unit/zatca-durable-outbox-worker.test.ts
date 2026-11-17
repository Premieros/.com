import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyZatcaDispatch, processZatcaOutboxEvent,
  type ClaimedZatcaEvent, type ZatcaOutboxCompletion, type ZatcaDurableOutboxStore,
} from '../../server/zatca/durableOutboxWorker';

const claim: ClaimedZatcaEvent = {
  eventId: 'event-1', leaseToken: 'fence-123',
  lease: {
    claimed: true, organizationId: 'org-1', branchId: 'branch-1',
    egsDeviceId: 'egs-1', invoiceId: 'invoice-1',
    payload: { channel: 'reporting', uuid: 'uuid-1', invoiceHash: 'hash-1',
      invoiceBase64: 'PHhtbC8+' },
  },
  invoice: {
    organizationId: 'org-1', branchId: 'branch-1', invoiceId: 'invoice-1',
    kind: 'simplified', issued: true, cleared: false, signedXmlReady: true,
  },
  integration: {
    countryCode: 'SA', enabled: true, onboardingComplete: true, signingReady: true,
  },
  onboarding: {
    countryCode: 'SA', organizationId: 'org-1', branchId: 'branch-1',
    egsDeviceId: 'egs-1', vatRegistrationNumber: 'registered',
    environment: 'sandbox', onboardingComplete: true, serverCredentialsReady: true,
    serverSigningReady: true, complianceTestsPassed: true, productionApproved: false,
  },
  gateway: {
    environment: 'sandbox', productionApproved: false,
    clearanceUrl: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/invoices/clearance/single',
    reportingUrl: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/invoices/reporting/single',
  },
};

describe('ZATCA durable outbox boundary (mock-only)', () => {
  const claimQueued = vi.fn<ZatcaDurableOutboxStore['claimQueued']>();
  const completeClaim = vi.fn<ZatcaDurableOutboxStore['completeClaim']>();
  const creds = vi.fn(async () => ({ binarySecurityToken: 'demo-token', secret: 'demo-secret' }));
  const transport = vi.fn(async () => ({
    status: 200, json: async () => ({ reportingStatus: 'REPORTED' }),
  }));
  const store = { claimQueued, completeClaim };

  beforeEach(() => {
    vi.clearAllMocks();
    claimQueued.mockResolvedValue(claim);
    completeClaim.mockResolvedValue();
  });

  it('records accepted only after a mock authority acknowledgment', async () => {
    const result = await processZatcaOutboxEvent('event-1', store, creds, transport);
    expect(result).toEqual({ state: 'recorded', status: 'accepted' });
    expect(completeClaim).toHaveBeenCalledWith({
      eventId: 'event-1', leaseToken: 'fence-123',
      status: 'accepted', httpStatus: 200, reason: null,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('never sends or finishes if an event is already claimed elsewhere', async () => {
    claimQueued.mockResolvedValue(null);
    expect(await processZatcaOutboxEvent('event-1', store, creds, transport))
      .toEqual({ state: 'not_claimed' });
    expect(transport).not.toHaveBeenCalled();
    expect(completeClaim).not.toHaveBeenCalled();
  });

  it('quarantines ambiguous HTTP 200 bodies rather than assuming acceptance', async () => {
    transport.mockResolvedValueOnce({
      status: 200, json: async () => { throw new Error('truncated response'); },
    });
    const res = await processZatcaOutboxEvent('event-1', store, creds, transport);
    expect(res).toMatchObject({ status: 'needs_reconciliation' });
    expect(completeClaim).toHaveBeenCalledWith(expect.objectContaining({
      status: 'needs_reconciliation', httpStatus: 200,
    }));
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('holds timeouts and 5xx for reconciliation without an automatic resend', async () => {
    transport.mockRejectedValueOnce(new Error('network timeout'));
    expect(await processZatcaOutboxEvent('event-1', store, creds, transport))
      .toMatchObject({ status: 'needs_reconciliation' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(completeClaim).toHaveBeenCalledWith(expect.objectContaining({
      status: 'needs_reconciliation', httpStatus: null,
    }));
  });

  it('never transmits a cross-branch outbox lease', async () => {
    claimQueued.mockResolvedValue({ ...claim, invoice: { ...claim.invoice, branchId: 'other-branch' } });
    expect(await processZatcaOutboxEvent('event-1', store, creds, transport))
      .toMatchObject({ status: 'blocked' });
    expect(transport).not.toHaveBeenCalled();
    expect(completeClaim).toHaveBeenCalledWith(expect.objectContaining({
      status: 'blocked', reason: 'scope_mismatch',
    }));
  });

  it('fails closed on wrong event ID or missing fencing token', async () => {
    claimQueued.mockResolvedValue({ ...claim, eventId: 'other-event' });
    await expect(processZatcaOutboxEvent('event-1', store, creds, transport))
      .rejects.toThrow('ZATCA_OUTBOX_INVALID_CLAIM');
    claimQueued.mockResolvedValue({ ...claim, leaseToken: '' });
    await expect(processZatcaOutboxEvent('event-1', store, creds, transport))
      .rejects.toThrow('ZATCA_OUTBOX_INVALID_CLAIM');
    expect(transport).not.toHaveBeenCalled();
    expect(completeClaim).not.toHaveBeenCalled();
  });

  it('does not quietly ignore failed durable completion writes', async () => {
    completeClaim.mockRejectedValueOnce(new Error('database offline'));
    await expect(processZatcaOutboxEvent('event-1', store, creds, transport))
      .rejects.toThrow('database offline');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('converts authority results into safe audit states without exposing payloads', () => {
    const event: Pick<ClaimedZatcaEvent, 'eventId' | 'leaseToken'> = {
      eventId: claim.eventId, leaseToken: claim.leaseToken,
    };
    const samples: Array<[Parameters<typeof classifyZatcaDispatch>[1], ZatcaOutboxCompletion['status']]> = [
      [{ state: 'accepted', channel: 'reporting', httpStatus: 200 }, 'accepted'],
      [{ state: 'rejected', channel: 'reporting', httpStatus: 400 }, 'rejected'],
      [{ state: 'retry_required', channel: 'reporting', httpStatus: null }, 'needs_reconciliation'],
      [{ state: 'blocked', reason: 'not_ready' }, 'blocked'],
    ];
    for (const [result, status] of samples) {
      expect(classifyZatcaDispatch(event, result).status).toBe(status);
    }
  });
});
