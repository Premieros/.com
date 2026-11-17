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

## Organization/branch/EGS onboarding gate (in progress)

- `src/features/invoicing/saudi/zatcaOnboardingReadiness.ts` provides an
  offline, non-credential-bearing prerequisite check. It **does not verify**
  VAT registration validity, CSID provenance, signing validity, official
  XML/QR rules, ZATCA sandbox certification, or successful submission.
- Configuration must be **tenant + branch + EGS device** specific. The
  jurisdiction is the legal registration country, **not** the browser locale.
- `sandbox` and `production` are separate operating environments.
  Production readiness requires a separate recorded approval.
- Credentials, signing keys, onboarding OTPs and CSIDs must stay in a
  server-side secrets store. Only readiness booleans can reach clients.
- Until the backend audit/authorization, immutable invoice/outbox, ZATCA
  onboarding, signing and official compliance tests exist, there is **no live
  ZATCA integration** and no automatic invoice transmission.
- Before implementing HTTP endpoints or claiming legal compliance, review
  current official ZATCA/Fatoora technical specifications with the owner;
  the current authoritative versions have not been verified in this change.

## Implemented server-only HTTP boundary (PR in progress)

- `server/zatca/zatcaGateway.ts` is an **unwired server-only adapter** for
  sending already signed and validated invoice payloads to the configured
  ZATCA clearance/reporting endpoints. It validates the approved ZATCA host
  and the sandbox/production path separation, requires separate production
  approval, and obtains credentials from an injected server-only callback.
- Uses the ZATCA invoice submission request shape (UUID, invoice hash and
  Base64 encoded signed UBL). Neither the shape nor version headers are a
  claim of conformance; confirm them against the **current official guide**
  before an authorized integration test.
- HTTP 200 is not accepted as success unless the channel-specific authority
  response explicitly indicates `CLEARED` with a cleared invoice, or
  `REPORTED` for the reporting channel.
- Failed/unknown network outcomes are returned as **retry_required**;
  there is **no automatic replay** because any ambiguous result must be
  reconciled against a durable transactional outbox before resubmission.
- These tests use an injected mock HTTP transport and fake credentials.
  They do not contact ZATCA or create valid cryptographic invoices.

**Still required before a real invoice can be submitted:** authenticated
server-only endpoint, tenant/role/branch/EGS authorization, legally verified
invoice fields, UBL 2.1 validation, digital signing, UUID/counter/hash-chain,
QR, timestamp rules, compliance and production CSIDs, encrypted credential
vault, a transactional outbox with deduplication/reconciliation, monitoring,
current ZATCA regulatory/API contract verification, sandbox conformance
results and explicit per-tenant approval. Nothing is configured for live use.

## Unsigned invoice XML draft and monetary mapping (current implementation)

- `server/zatca/unsignedInvoiceDraft.ts` maps a limited illustrative **15% VAT**
  sale into deterministic UBL-shaped XML using integer halalas and quantities
  in thousandths. It validates scope fields, line IDs, money/discount bounds,
  issue date shape, VAT identifier shape and XML escaping.
- The result has `status: 'unsigned_draft'` and `submittable: false`.
  It **cannot** be submitted to the gateway and is not ZATCA-compliant XML:
  it is missing mandated profile metadata, full party details, tax-category
  handling, tax-exemption references, invoice chaining, QR, signing, document
  references, certified timestamp handling and other official requirements.
- The function **does not issue or persist invoices**. Callers must supply a
  durable, externally assigned invoice number, UUID and issue date; values
  are never automatically invented from the browser clock.
- Line-level rounding and discounts are an internal mapping prototype only.
  Reconcile tax rounding/allowances against the official Saudi schemas and
  authority validation suite before enabling any issuance.
- This addition makes no database changes, no live network calls and no
  claim of certification. Existing Premier sales/accounting flows are not
  modified by this draft module.

## Non-compliant QR preview (tags 1–5 only)

- `server/zatca/unsignedQrPreview.ts` encodes the informational TLV
  tags (seller name, VAT identifier, UTC timestamp, tax-inclusive amount and
  VAT amount) into Base64 for **offline tests only**.
- It validates UTF-8 byte lengths, dates and monetary amount shapes.
- The return value is explicitly `status: 'unsigned_preview'` and
  `submittable: false`. It omits phase-2 cryptographic tags and does not
  generate an approved printable QR code. Do **not** display it as a final
  Saudi tax invoice QR or pass it to customers.
- Official QR/tag specifications and signing must be verified and
  implemented before production; no live ZATCA submissions occur here.

## Durable submission state and fencing contract (not yet wired to database)

- `server/zatca/durableOutboxWorker.ts` adds a **server-only** coordination
  contract for a database-backed queued invoice, atomic claim, opaque fencing
  token and single outbound attempt. It delegates all actual network activity
  to the previously reviewed ZATCA gateway.
- Required states are `queued`, `leased`, `accepted`, `rejected`,
  `needs_reconciliation`, `blocked`. Unknown outcomes are **held for
  reconciliation**, not automatically retried. A failed durable completion
  write propagates an error and must trigger operator alerting.
- The interface **does not implement a persistent outbox**. A later reviewed
  migration must enforce invoice/outbox creation in one DB transaction,
  immutable payload hash and document identity, uniqueness scoped by tenant,
  branch and EGS, atomic compare-and-swap claims, fencing-token checks on
  completion, retention and audit policies. A crashed worker's lease MUST NOT
  be re-queued without checking possible prior authority acceptance.
- Do not reuse the existing ERP event outbox as a tax authority outbox without
  separate schema and lifecycle review: it has a different event consumer and
  is not proven to satisfy invoice issue/signature atomicity.
- No production table, RLS, function or data was changed. **Explicit owner
  approval for a database schema migration is required** before wiring this
  contract to Supabase. The ZATCA production connection remains disabled.

## Production persistence foundation checkpoint — 2026-11-17

- The owner approved ZATCA-only private database tables. Canonical Supabase
  `hvqlkapynjfjikqithvd` accepted migration version
  **`20261117134752`** named `zatca_private_tenant_scoped_foundation`.
- Created only `private.zatca_branch_settings`,
  `private.zatca_egs_devices`, `private.zatca_documents`, and
  `private.zatca_submission_outbox`. All four have RLS enabled and
  no direct grants to `anon`, `authenticated` or `service_role`.
- Production read-only verification found **zero rows** in each table and
  all new constraints validated; existing sales, accounting and inventory
  rows were untouched by this additive migration.
- Composite relationships and database triggers block organization/branch/
  EGS mismatches, repeated document/action keys, deletion of tax audit
  records, and unauthorized rewriting of issued document identity.
- Existing `server/zatca/durableOutboxWorker.ts` is **not yet connected**
  to these tables. No privileged claim/complete RPC has been deployed;
  no invoice can be sent or issued via this new persistence layer.
- Remaining production blockers: authenticated private backend API,
  durable invoice+outbox atomic creation with verified signing/counters,
  secure CSID vault and EGS onboarding, official UBL/QR/signature validation,
  recovery/reconciliation procedures, official sandbox acceptance and
  separate per-tenant production enablement.
- Repository migration path is aligned to the **exact remote version**;
  do not replay this DDL under a second version.

## Private sandbox outbox claiming and fenced completion (applied 2026-11-17)

- `private.zatca_claim_queued_v1(event_id)` atomically claims a single
  **sandbox** queue row using row locks and a fresh fencing token. It requires
  the tenant/branch/EGS to match, enabled sandbox settings, onboarding and
  compliance flags, an EGS marked ready, signed invoice vault reference,
  hash, issuance timestamp and positive counter.
- The claim is one-shot: `attempt_count = 0`; expired or uncertain leases
  are **never automatically requeued**. A human-reviewed reconciliation
  workflow will be required before any resubmission.
- `private.zatca_complete_claim_v1(event_id,fence_token,state,http,reason)`
  atomically records a completion only for the matching leased token and
  advances the linked document status in the same transaction. Invalid
  channel/document state pairs and stale tokens fail closed.
- Both functions are `SECURITY INVOKER` and explicitly denied to
  `anon`, `authenticated`, and `service_role`; they are **not** public
  REST/RPC interfaces. A separate trusted, audited PostgreSQL worker
  connection is needed later; no connection or schedule is activated now.
- Even an enabled production setting cannot be claimed by this version.
  No outbound HTTP calls, credentials, CSID or tax invoice issuance are made.
- Canonical Supabase project `hvqlkapynjfjikqithvd` accepted the reviewed
  migration as version **`20261117142048`**. Read-only verification proved
  both functions are `SECURITY INVOKER`, their execution privileges are
  denied to `anon`, `authenticated`, and `service_role`, a nonexistent event
  cannot be claimed, and all four ZATCA tables remain empty.
- This additive migration introduced no real invoices or accounting changes.
  The SQL filename is aligned to the recorded remote migration version.

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
