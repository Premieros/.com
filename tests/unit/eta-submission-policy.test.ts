import { describe, expect, it } from 'vitest';
import { planEtaSubmission, type EtaIntegrationContext, type EtaDocumentReference } from '../../src/features/invoicing/egypt/etaSubmissionPolicy';
import { planTaxAuthoritySubmission } from '../../src/features/invoicing/taxAuthorityRouting';

const context: EtaIntegrationContext = {
  countryCode: 'EG',
  enabled: true,
  onboardingComplete: true,
  credentialsReady: true,
  signingReady: true,
};
const invoice: EtaDocumentReference = {
  organizationId: 'organization-1',
  branchId: 'branch-1',
  documentId: 'document-1',
  kind: 'electronic_invoice',
  validatedPayloadReady: true,
  finalized: true,
  submittedOrQueued: false,
};

describe('Egyptian Tax Authority routing foundation', () => {
  it('routes electronic invoices only through the ETA invoice channel', () => {
    expect(planEtaSubmission(context, invoice)).toEqual({
      ready: true, authority: 'ETA', channel: 'einvoice',
      organizationId: 'organization-1', branchId: 'branch-1', documentId: 'document-1',
    });
  });

  it('routes electronic receipts through a separate ETA receipt channel', () => {
    expect(planEtaSubmission(context, { ...invoice, kind: 'electronic_receipt' }))
      .toMatchObject({ ready: true, authority: 'ETA', channel: 'ereceipt' });
  });

  it('requires Egyptian country scope and explicit enablement', () => {
    expect(planEtaSubmission({ ...context, countryCode: 'SA' }, invoice))
      .toEqual({ ready: false, reason: 'not_egypt' });
    expect(planEtaSubmission({ ...context, enabled: false }, invoice))
      .toEqual({ ready: false, reason: 'not_enabled' });
  });

  it('blocks until onboarding, credentials, and signing are ready', () => {
    expect(planEtaSubmission({ ...context, onboardingComplete: false }, invoice))
      .toEqual({ ready: false, reason: 'not_onboarded' });
    expect(planEtaSubmission({ ...context, credentialsReady: false }, invoice))
      .toEqual({ ready: false, reason: 'credentials_not_ready' });
    expect(planEtaSubmission({ ...context, signingReady: false }, invoice))
      .toEqual({ ready: false, reason: 'signature_not_ready' });
  });

  it('refuses incomplete documents, drafts, and previously queued submissions', () => {
    expect(planEtaSubmission(context, { ...invoice, documentId: '' }))
      .toEqual({ ready: false, reason: 'invalid_document' });
    expect(planEtaSubmission(context, { ...invoice, validatedPayloadReady: false }))
      .toEqual({ ready: false, reason: 'invalid_document' });
    expect(planEtaSubmission(context, { ...invoice, finalized: false }))
      .toEqual({ ready: false, reason: 'document_not_finalized' });
    expect(planEtaSubmission(context, { ...invoice, submittedOrQueued: true }))
      .toEqual({ ready: false, reason: 'already_submitted' });
  });

  it('keeps Saudi and Egyptian channels separate in the shared dispatcher', () => {
    expect(planTaxAuthoritySubmission({ authority: 'ETA', context, document: invoice }))
      .toMatchObject({ authority: 'ETA', decision: { ready: true, channel: 'einvoice' } });
    expect(planTaxAuthoritySubmission({
      authority: 'ZATCA',
      context: { countryCode: 'SA', enabled: true, onboardingComplete: true, signingReady: true },
      document: {
        organizationId: 'organization-1', branchId: 'branch-1', invoiceId: 'invoice-2',
        kind: 'simplified', signedXmlReady: true, issued: true, cleared: false,
      },
    })).toMatchObject({ authority: 'ZATCA', decision: { ready: true, action: 'reporting' } });
  });
});
