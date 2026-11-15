import type { EtaIntegrationContext, EtaDocumentReference, EtaSubmissionDecision } from './egypt/etaSubmissionPolicy';
import { planEtaSubmission } from './egypt/etaSubmissionPolicy';
import type { ZatcaIntegrationContext, ZatcaInvoiceReference, ZatcaSubmissionDecision } from './saudi/zatcaSubmissionPolicy';
import { planZatcaSubmission } from './saudi/zatcaSubmissionPolicy';

/** Country-specific, opt-in authority routing; no network or persistence. */
export type TaxAuthorityRoutingRequest =
  | { authority: 'ETA'; context: EtaIntegrationContext; document: EtaDocumentReference }
  | { authority: 'ZATCA'; context: ZatcaIntegrationContext; document: ZatcaInvoiceReference };

export type TaxAuthorityRoutingDecision =
  | { authority: 'ETA'; decision: EtaSubmissionDecision }
  | { authority: 'ZATCA'; decision: ZatcaSubmissionDecision };

/** Discriminated by authority so Egypt's eReceipt can never be routed to ZATCA. */
export function planTaxAuthoritySubmission(request: TaxAuthorityRoutingRequest): TaxAuthorityRoutingDecision {
  if (request.authority === 'ETA') {
    return { authority: 'ETA', decision: planEtaSubmission(request.context, request.document) };
  }
  return { authority: 'ZATCA', decision: planZatcaSubmission(request.context, request.document) };
}
