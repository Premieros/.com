# Egyptian Tax Authority (ETA) electronic invoicing and eReceipt — integration readiness

> FOUNDATION ONLY: Premier does **not yet** transmit, sign, validate against ETA,
> or automatically submit electronic invoices/receipts. This document and pure
> policy modules are not evidence of regulatory certification.

## Product architecture

Premier must support both Egyptian **eInvoice** and **eReceipt** workflows
without treating them as interchangeable. Support may be shipped in the
product for organizations not yet registered, but a connection and actual
submission must remain disabled until that organization's valid enrollment,
credentials, devices/branches, and required signing are configured.

- **Egyptian eInvoice**: map issued business invoices and appropriate debit/
  credit notes to the official ETA document representation, required parties,
  taxable amounts, exchange units and references. Format, signatures, API
  authorization, document lifecycle and submission windows must be verified
  against the CURRENT official guidance.
- **Egyptian eReceipt**: a distinct POS/retail document format, device/branch
  identifiers, activation and submission lifecycle. Do not send retail receipts
  to eInvoice endpoints, or assume that every Premier cash receipt is a tax
  eReceipt without classification.
- Enforce immutable identifiers and revisions, server-side rounding/currency/
  tax validation, document signatures, UTC/business timestamps, payment/returns
  corrections and exact issuer legal/tax identity.
- Issue an atomic durable outbox entry tied to the original business event;
  let an authenticated **server-side worker** handle ETA submission, dedupe,
  bounded retries, acknowledgment, reconciliation and manual exception review.
- Scope all events by organization, branch, and where required POS/EGS device.
  Store service credentials, certificates/private signing keys and secrets
  only in a secure backend vault, never in browser bundles or GitHub.
- Track precise states: not_configured, preparing, ready, queued, transmitting,
  pending_authority_response, accepted, rejected, retry_required,
  manual_review. Never call an unacknowledged document accepted.
- Country selection is not enough to prove tax registration or authorize
  transmission; verify permitted entities, branch/device associations and role
  access server-side.

## Safe implementation included in this integration PR

- `src/features/invoicing/egypt/etaSubmissionPolicy.ts`: pure, fail-closed
  routing for eInvoice vs eReceipt based on issuer eligibility and immutable
  document readiness; no HTTP, persistence, token handling or signature claims.
- `src/features/invoicing/taxAuthorityRouting.ts`: typed dispatcher that
  separates Egypt (ETA) from Saudi (ZATCA) policies.
- `tests/unit/eta-submission-policy.test.ts`: guards for correct channel,
  absent onboarding, no credentials or signing, malformed document,
  incomplete issuance, previously queued events and Saudi/Egypt isolation.

## Required implementation before switching on for a customer

1. Verify current official ETA eInvoice and eReceipt APIs, file schemas,
   authentication/onboarding flows, device requirements, signatures, document
   rules, tax code taxonomy and accepted lifecycle semantics with the authority.
2. Inventory Premier's existing organization tax records, branches, POS
   receipts and sale/return data. Define precise legal document mapping and
   missing fields; do not reuse an arbitrary thermal receipt as an ETA payload.
3. Implement backend-issued tokens, server-side signing, legal numbering,
   authority-specific document generators and local schema validation.
4. Add secure per-organization onboarding/settings and branch/device mapping
   with sandbox vs production separation and explicit authorization.
5. Implement transactional outbox, retriable worker, duplicate prevention,
   monitoring, rejection handling, delayed network recovery and reconciliation.
6. Validate representative sale, B2B, retail, cancellation, return, credit
   note, rounding and multi-branch scenarios in authority test environments.
   Obtain tax/legal review before marketing the system as compliant.

## Non-goals of this foundation

- No real API call, token acquisition, digital signing or QR generation.
- No production DB migrations, credentials, business-state changes, or automatic
  submissions.
- No assertion that all Egyptian businesses are required to use both systems.
- No change to the existing Saudi integration contract or non-Egypt tenants.

Regulatory details require current official verification, which has not been
performed as part of this code-only change.
