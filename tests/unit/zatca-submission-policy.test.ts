import { describe, expect, it } from 'vitest';
import {
  planZatcaSubmission,
  type ZatcaIntegrationContext,
  type ZatcaInvoiceReference,
} from '../../src/features/invoicing/saudi/zatcaSubmissionPolicy';

const enabled: ZatcaIntegrationContext = {
  countryCode: 'SA', enabled: true, onboardingComplete: true, signingReady: true,
};
const simplified: ZatcaInvoiceReference = {
  organizationId: 'org-1', branchId: 'branch-1', invoiceId: 'invoice-1',
  kind: 'simplified', signedXmlReady: true, issued: true, cleared: false,
};

describe('ZATCA submission policy (not a live connector)', () => {
  it('routes issued simplified invoices to reporting', () => {
    expect(planZatcaSubmission(enabled, simplified)).toEqual({
      ready: true, action: 'reporting', organizationId: 'org-1',
      branchId: 'branch-1', invoiceId: 'invoice-1',
    });
  });

  it('routes unissued standard invoices to clearance only', () => {
    expect(planZatcaSubmission(enabled, {
      ...simplified, kind: 'standard', issued: false,
    })).toMatchObject({ ready: true, action: 'clearance' });
  });

  it('rejects a standard invoice already marked issued before clearance', () => {
    expect(planZatcaSubmission(enabled, {
      ...simplified, kind: 'standard',
    })).toEqual({ ready: false, reason: 'invalid_invoice_state' });
  });

  it('rejects simplified reporting before issuance', () => {
    expect(planZatcaSubmission(enabled, {
      ...simplified, issued: false,
    })).toEqual({ ready: false, reason: 'invalid_invoice_state' });
  });

  it('does not submit for organizations outside Saudi Arabia or without onboarding', () => {
    expect(planZatcaSubmission({ ...enabled, countryCode: 'EG' }, simplified))
      .toEqual({ ready: false, reason: 'not_saudi' });
    expect(planZatcaSubmission({ ...enabled, enabled: false }, simplified))
      .toEqual({ ready: false, reason: 'not_enabled' });
    expect(planZatcaSubmission({ ...enabled, onboardingComplete: false }, simplified))
      .toEqual({ ready: false, reason: 'not_onboarded' });
    expect(planZatcaSubmission({ ...enabled, signingReady: false }, simplified))
      .toEqual({ ready: false, reason: 'signing_not_ready' });
  });

  it('requires complete scoped invoice references and signed XML readiness', () => {
    expect(planZatcaSubmission(enabled, { ...simplified, organizationId: '' }))
      .toEqual({ ready: false, reason: 'invalid_invoice' });
    expect(planZatcaSubmission(enabled, { ...simplified, signedXmlReady: false }))
      .toEqual({ ready: false, reason: 'invalid_invoice' });
  });

  it('never re-enqueues already cleared invoices through this initial routing function', () => {
    expect(planZatcaSubmission(enabled, { ...simplified, cleared: true }))
      .toEqual({ ready: false, reason: 'invalid_invoice_state' });
  });
});
