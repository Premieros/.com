/**
 * Egyptian Tax Authority integration routing foundation.
 *
 * This is not an ETA API client, signed document generator, or certification.
 * It only selects the correct server-side integration channel after a local
 * immutable invoice/receipt has been prepared. No network or persistence.
 */
export type EgyptTaxDocumentKind = 'electronic_invoice' | 'electronic_receipt';
export type EtaChannel = 'einvoice' | 'ereceipt';
export type EtaBlockReason =
  | 'not_egypt'
  | 'not_enabled'
  | 'not_onboarded'
  | 'credentials_not_ready'
  | 'signature_not_ready'
  | 'invalid_document'
  | 'document_not_finalized'
  | 'already_submitted';

export interface EtaIntegrationContext {
  countryCode: string;
  enabled: boolean;
  onboardingComplete: boolean;
  credentialsReady: boolean;
  signingReady: boolean;
}

export interface EtaDocumentReference {
  organizationId: string;
  branchId: string;
  documentId: string;
  kind: EgyptTaxDocumentKind;
  /** An immutable, server-prepared and validated authority-format document. */
  validatedPayloadReady: boolean;
  /** Document is issued/finalized in the internal ledger. */
  finalized: boolean;
  /** True if already queued, transmitted, or acknowledged; never resend here. */
  submittedOrQueued: boolean;
}

export type EtaSubmissionDecision =
  | {
    ready: true;
    authority: 'ETA';
    channel: EtaChannel;
    organizationId: string;
    branchId: string;
    documentId: string;
  }
  | { ready: false; reason: EtaBlockReason };

/**
 * Fail closed when country, tenant onboarding, credentials, signing, or
 * immutable document state is not ready. This function does NOT verify
 * access rights, signatures, tax correctness, duplicate receipt identifiers,
 * issuance timelines or ETA acceptance. Those require server-side controls.
 */
export function planEtaSubmission(
  context: EtaIntegrationContext,
  document: EtaDocumentReference,
): EtaSubmissionDecision {
  if (context.countryCode.trim().toUpperCase() !== 'EG') return { ready: false, reason: 'not_egypt' };
  if (!context.enabled) return { ready: false, reason: 'not_enabled' };
  if (!context.onboardingComplete) return { ready: false, reason: 'not_onboarded' };
  if (!context.credentialsReady) return { ready: false, reason: 'credentials_not_ready' };
  if (!context.signingReady) return { ready: false, reason: 'signature_not_ready' };
  if (!document.organizationId.trim() || !document.branchId.trim() || !document.documentId.trim() ||
      !document.validatedPayloadReady ||
      (document.kind !== 'electronic_invoice' && document.kind !== 'electronic_receipt')) {
    return { ready: false, reason: 'invalid_document' };
  }
  if (!document.finalized) return { ready: false, reason: 'document_not_finalized' };
  if (document.submittedOrQueued) return { ready: false, reason: 'already_submitted' };

  return {
    ready: true,
    authority: 'ETA',
    channel: document.kind === 'electronic_invoice' ? 'einvoice' : 'ereceipt',
    organizationId: document.organizationId,
    branchId: document.branchId,
    documentId: document.documentId,
  };
}
