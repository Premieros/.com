/**
 * ZATCA integration routing contract (foundation only).
 *
 * This file deliberately performs NO HTTP requests, cryptographic signing,
 * invoice issuance, or persistence. Those actions must happen in an audited
 * server-side integration after regulatory conformance testing.
 *
 * Saudi standard tax invoices: clearance before the invoice is treated as
 * cleared/issued. Saudi simplified tax invoices: issue locally with compliant
 * cryptographic artefacts, then report via the required reporting workflow.
 */

export type SaudiInvoiceKind = 'standard' | 'simplified';
export type ZatcaAction = 'clearance' | 'reporting';
export type ZatcaBlockReason =
  | 'not_saudi'
  | 'not_enabled'
  | 'not_onboarded'
  | 'signing_not_ready'
  | 'invalid_invoice'
  | 'invalid_invoice_state';

export interface ZatcaIntegrationContext {
  countryCode: string;
  enabled: boolean;
  onboardingComplete: boolean;
  signingReady: boolean;
}

export interface ZatcaInvoiceReference {
  organizationId: string;
  branchId: string;
  invoiceId: string;
  kind: SaudiInvoiceKind;
  /** Signed invoice XML must be built and kept on the server, not provided here. */
  signedXmlReady: boolean;
  /** True only after an irreversible internal issuance event. */
  issued: boolean;
  /** True only after the receipt of a confirmed, successful ZATCA clearance. */
  cleared: boolean;
}

export type ZatcaSubmissionDecision =
  | { ready: true; action: ZatcaAction; invoiceId: string; organizationId: string; branchId: string }
  | { ready: false; reason: ZatcaBlockReason };

/**
 * Fail closed. This decides which server workflow is permitted; it never
 * claims an invoice has been submitted, accepted or that the software is
 * certified. Caller must independently enforce tenant, branch and role
 * authorization and verify the signed XML's identity/hash.
 */
export function planZatcaSubmission(
  context: ZatcaIntegrationContext,
  invoice: ZatcaInvoiceReference,
): ZatcaSubmissionDecision {
  if (context.countryCode.trim().toUpperCase() !== 'SA') return { ready: false, reason: 'not_saudi' };
  if (!context.enabled) return { ready: false, reason: 'not_enabled' };
  if (!context.onboardingComplete) return { ready: false, reason: 'not_onboarded' };
  if (!context.signingReady) return { ready: false, reason: 'signing_not_ready' };
  if (!invoice.organizationId.trim() || !invoice.branchId.trim() || !invoice.invoiceId.trim() ||
      !invoice.signedXmlReady || !['standard', 'simplified'].includes(invoice.kind)) {
    return { ready: false, reason: 'invalid_invoice' };
  }

  if (invoice.kind === 'standard') {
    // Must be submitted for clearance before marking the invoice cleared.
    if (invoice.issued || invoice.cleared) return { ready: false, reason: 'invalid_invoice_state' };
    return {
      ready: true, action: 'clearance', invoiceId: invoice.invoiceId,
      organizationId: invoice.organizationId, branchId: invoice.branchId,
    };
  }

  // Simplified invoices enter reporting only after issuance. Reporting the
  // same invoice again requires server-side idempotency and reconciliation.
  if (!invoice.issued || invoice.cleared) return { ready: false, reason: 'invalid_invoice_state' };
  return {
    ready: true, action: 'reporting', invoiceId: invoice.invoiceId,
    organizationId: invoice.organizationId, branchId: invoice.branchId,
  };
}
