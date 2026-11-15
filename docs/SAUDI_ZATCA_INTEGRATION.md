# Saudi electronic invoicing (ZATCA) — integration contract and readiness gates

> **Status: FOUNDATION ONLY — NOT CONNECTED / NOT ZATCA-COMPLIANT YET.**
> This design is a starting point, not a declaration of ZATCA conformance,
> software approval, invoice clearance, or acceptance of reporting.

## Product requirements

Premier should support Saudi electronic invoicing as an **optional country-specific
capability of the software**, including for organizations that have not yet
enrolled. No transmission may occur until the Saudi organization has completed
the applicable onboarding, device/certificate setup and testing.

- **Standard tax invoice (B2B and other cases as classified by applicable rules):**
  server-side signed UBL 2.1 invoice, verification and ZATCA **clearance**
  workflow before being considered cleared/issued. A failed clearance must not
  be represented to the customer as a successfully cleared invoice.
- **Simplified tax invoice (B2C and other cases as classified by applicable rules):**
  create the applicable compliant cryptographic invoice artefacts at issuance,
  then queue the ZATCA **reporting** workflow. Reporting and clearance are
  different operations and must never be interchanged.
- Preserve invoice records, cryptographic hash chain, QR/signature data,
  UUID, invoice counter and the issuance timestamp through refunds/credit notes.
  Do not derive them from local browser time or change an issued invoice in place.
- Scope every operation to organization + branch + invoicing device/EGS;
  enforce permissions and RLS/tenant isolation server-side.
- Secrets, private keys, OTP, CSID and production endpoints belong on a secure
  server; never ship them in the frontend, source control, local storage or logs.
- An **immutable, transactional outbox** must be written at the same durable
  transaction as the relevant invoice state change. A worker owns signing/
  submission transitions, bounded retries, idempotency and reconciliation.
  Never submit silently directly from a UI click handler.
- Record acknowledgment state, request correlation, and rejection reasons
  without leaking invoice XML or credentials in logs; provide monitored
  operator actions for failures and connectivity loss.
- Confirm the current official ZATCA schemas, XML/QR/signing rules, timing
  requirements, sandbox onboarding and production API documentation before
  implementing or claiming compatibility.

## Existing safe foundation

- `src/features/invoicing/saudi/zatcaSubmissionPolicy.ts` implements a
  **pure, fail-closed routing decision**. It does not issue, sign, persist,
  report or clear any invoice.
- Unit tests verify that standard invoices are routed to clearance only
  before issuance; simplified invoices route to reporting only after issuance,
  and neither proceeds without country/onboarding/signing readiness.

## Required phases before live usage

1. Verify official specifications and mandatory invoice fields for the
   relevant Saudi invoice profiles; map Premier's sale/refund/return data,
   rounding, tax calculations, and numbering to signed UBL requirements.
2. Design organization/branch/EGS settings and secure credentials vault;
   onboard through compliance APIs, with explicit sandbox vs production
   isolation and revocation/rotation flows.
3. Implement server-only UBL generation, XML canonicalization, cryptographic
   hashing/signing, QR code (required fields/tags) and full conformance
   validation for both invoice kinds and notes.
4. Implement safe **clearance-before-finalization** for standard invoices and
   **issuance-then-reporting** for simplified invoices with transactional
   outbox, retry/idempotency, failure recovery, clock and hash-chain controls.
5. Add audit views: not configured, ready, pending clearance, cleared,
   issued/pending reporting, reported, rejected, retry needed, and exceptions.
   Avoid calling a pending or rejected invoice accepted.
6. Validate against official ZATCA sandbox/compliance suite and release
   behind a controlled per-organization rollout flag; obtain legal/tax
   review before stating the system is compliant.

## Non-goals in this PR iteration

- No use of live ZATCA endpoints or hard-coded credentials.
- No database migration, QR/signature fiction, or automatic submission.
- No global requirement imposed on Egypt or other country tenants.
- No replacement of the existing Premier sales/financial ledger workflows.

Documentation describes engineering gates; regulatory requirements are subject
to verification against the currently published authority guidance.
