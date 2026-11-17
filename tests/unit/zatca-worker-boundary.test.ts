import { describe, expect, it, vi } from 'vitest';
import { dispatchZatcaOutboxLease, type ZatcaOutboxLease } from '../../server/zatca/zatcaWorkerBoundary';
import type { ZatcaInvoiceReference, ZatcaIntegrationContext } from '@/features/invoicing/saudi/zatcaSubmissionPolicy';
import type { ZatcaOnboardingStatus } from '@/features/invoicing/saudi/zatcaOnboardingReadiness';
import type { ZatcaGatewayConfig } from '../../server/zatca/zatcaGateway';

const integration: ZatcaIntegrationContext = {
  countryCode: 'SA', enabled: true, onboardingComplete: true, signingReady: true,
};
const invoice: ZatcaInvoiceReference = {
  organizationId: 'org-a', branchId: 'branch-a', invoiceId: 'invoice-a',
  kind: 'simplified', issued: true, cleared: false, signedXmlReady: true,
};
const onboarding: ZatcaOnboardingStatus = {
  countryCode: 'SA', organizationId: 'org-a', branchId: 'branch-a', egsDeviceId: 'egs-a',
  vatRegistrationNumber: 'vat-registered', environment: 'sandbox',
  onboardingComplete: true, serverCredentialsReady: true,
  serverSigningReady: true, complianceTestsPassed: true, productionApproved: false,
};
const gateway: ZatcaGatewayConfig = {
  environment: 'sandbox', productionApproved: false,
  reportingUrl: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/invoices/reporting/single',
  clearanceUrl: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/invoices/clearance/single',
};
const lease: ZatcaOutboxLease = {
  claimed: true, organizationId: 'org-a', branchId: 'branch-a',
  egsDeviceId: 'egs-a', invoiceId: 'invoice-a',
  payload: { channel: 'reporting', uuid: 'uuid-a', invoiceHash: 'hash-a', invoiceBase64: 'PHhtbC8+' },
};

describe('ZATCA private worker boundary (mock authority only)', () => {
  const creds = vi.fn(async () => ({ binarySecurityToken: 'mock-token', secret: 'mock-secret' }));
  const transport = vi.fn(async () => ({ status: 200, json: async () => ({ reportingStatus: 'REPORTED' }) }));
  async function run(
    task = lease, ref = invoice, ctx = integration, status = onboarding, conf = gateway,
  ) {
    return dispatchZatcaOutboxLease(task, ref, ctx, status, conf, creds, transport);
  }

  it('sends only a claimed, scoped and correctly classified sandbox event', async () => {
    expect(await run()).toEqual({ state: 'accepted', channel: 'reporting', httpStatus: 200 });
  });

  it('does not send unclaimed events', async () => {
    transport.mockClear();
    expect(await run({ ...lease, claimed: false })).toEqual({
      state: 'blocked', reason: 'outbox_not_claimed',
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not mix tenants, branches, EGS devices or invoices', async () => {
    transport.mockClear();
    expect(await run({ ...lease, branchId: 'branch-b' })).toMatchObject({ reason: 'scope_mismatch' });
    expect(await run({ ...lease, egsDeviceId: 'egs-b' })).toMatchObject({ reason: 'scope_mismatch' });
    expect(await run({ ...lease, invoiceId: 'invoice-b' })).toMatchObject({ reason: 'scope_mismatch' });
    expect(await run(lease, { ...invoice, organizationId: 'org-b' })).toMatchObject({ reason: 'scope_mismatch' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('blocks missing onboarding and prevents sandbox/production crossover', async () => {
    transport.mockClear();
    expect(await run(lease, invoice, integration, { ...onboarding, complianceTestsPassed: false }))
      .toMatchObject({ state: 'blocked', reason: 'not_ready' });
    expect(await run(lease, invoice, integration, onboarding, { ...gateway, environment: 'production' }))
      .toMatchObject({ state: 'blocked', reason: 'environment_mismatch' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('prevents reporting before issuance and cross-routing clearance as reporting', async () => {
    transport.mockClear();
    expect(await run(lease, { ...invoice, issued: false }))
      .toMatchObject({ state: 'blocked', reason: 'policy_blocked' });
    expect(await run({ ...lease, payload: { ...lease.payload, channel: 'clearance' } }))
      .toMatchObject({ state: 'blocked', reason: 'channel_mismatch' });
    expect(transport).not.toHaveBeenCalled();
  });
});
