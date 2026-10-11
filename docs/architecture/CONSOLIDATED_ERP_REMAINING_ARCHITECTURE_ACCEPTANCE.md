# Consolidated ERP Architecture V2 — Phase 5L / 6 / 7 / 8 / 9 Foundation

## Scope & completion semantics
Requested as **one consolidated engineering batch** on `Premieros/.com`. Because the system already has Procurement workflows, feature/domain modularization and operational posting, avoid replacing healthy modules without evidence. This release adds three DB migrations, tests, a typed UI/API contract and an ERP readiness screen. It is intentionally **not** an operational AI-model deployment or an unreviewed journal-writer cutover.

## Phase 5L — immutable organization journal identity capture
`private.organization_journal_line_evidence_v2` records one canonical organization link snapshot per existing and new journal line. It stores source IDs and immutable debit/credit, organization/branch IDs, historical marker and status `MAPPED_AT_POSTING` or `UNMAPPED_AT_POSTING` when the mapping has not been approved. The table is RLS protected and grants no API access; UPDATE/DELETE blocked. A post-INSERT trigger populates it in the same posting transaction, enforcing exact branch-account scope. Historical journal UUIDs/account IDs and amounts remain unchanged. Private readiness and organization trial-balance projections are available to privileged DBA/internal workers.

This **does not yet switch the operational journal posting writer** to org account UUIDs. A future explicit cutover requires changing report, period, reversal and reconciliation readers together and replay proof; otherwise older legacy IDs and reporting would break.

## Phase 6 — procurement integrity
- Receipt must reference a purchase from the same branch.
- Receipt warehouse, when present, must belong to that branch.
- Receipt items must belong to the exact purchase of their parent receipt.
- Receiving a purchase item is serialized and cumulative quantities may not exceed ordered quantity.
- Private progress projection compares documented and operational received quantities; historical orders without receipt documents may appear as `LEDGER_RECEIPT_DIFFERENCE` without retroactively fabricating receipts.
- Legacy purchasing/approval/returns/stock/finance functions are not replaced. The guards apply to existing code and direct DB writes.

## Phase 7 — modular architecture review
The source is already split into `src/features`, `src/api/domains`, `src/core/modules`, typed domain APIs and lazy routes. Phase 7's basic modularization exists on `main` and is preserved. The new agent readiness client is placed in the accounting domain rather than creating a monolithic app-level API.

## Phase 8 — transactional outbox and controlled command foundation
`private.erp_domain_outbox_v2` atomically captures **new** journal postings and purchase receipts, scoped to organization and branch, with unique event keys, status, attempts and timestamp. The table is RLS-sealed from user/client/service roles. Private worker-only claim/ack functions support batched `FOR UPDATE SKIP LOCKED`, stale-lease recovery, idempotent event delivery acknowledgments; they are not executable by browser users or service role.

There is **no worker process yet**. This batch provides durable event capture and functions, not a claimed live end-to-end message broker.

## Phase 9 — safe, read-only agent context
`public.get_erp_agent_readiness_context_v2` provides a bounded, non-PII, tenant-scoped deterministic context: journal evidence counts, unmapped identity exceptions, procurement receipt differences, pending event counts, review priority. Requires active authenticated user, both `accounts.view` and `reports.view`, and branch access. The finance center exposes those diagnostics with explicit disclosure that autonomous actions are disabled. It does not connect an LLM/provider, does not execute payments, approve accounting changes or run arbitrary SQL.

Actual agent reasoning, tool registration, secret management, evaluation harness, cost limits, human-in-the-loop command authorization and worker deployment remain **not completed** without a provider/worker integration. Do not represent this foundation as fully autonomous AI agents.

## Acceptance checklist
- Strict migration additive design; no deletion of existing production data.
- GitHub Verify / DB / Playwright / Vercel green on exact merged head.
- DB integration synthetic rollback proof of immutable evidence, new journal capture/outbox, privilege denial, procurement branch scope and agent authentication.
- Supabase production migration history versions match the merged filenames.
- Prove original posted journal count, source lines, account mappings and org shadow identities unchanged after migration. Existing lines are snapshotted, not modified.
- No `anon`, `authenticated` or `service_role` direct private table privileges or worker RPC exposure.

## Remaining actual engineering work
- Full cutover of all operational posting/report writers to organization account identity, only after dependency and historical equality proof.
- Procurement functional end-to-end receiving / returns and refund tests across every warehouse and item variant.
- Background outbox consumer deployment with idempotent downstream handlers and dead-letter operations.
- Provider-backed AI agents with read-only tool invocation, prompt injection defenses, costs and authorization; approval-gated writes only when verified.
