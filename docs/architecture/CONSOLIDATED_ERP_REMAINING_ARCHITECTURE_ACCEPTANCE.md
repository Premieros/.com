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

## Actual production acceptance — 2026-10-11

### Applied migrations and source history
- `20261011113106_phase5l_org_journal_identity_bridge`
- `20261011113110_phase6_procurement_receipt_integrity`
- `20261011113114_phase8_event_outbox_phase9_agent_context`

The three files have been renamed on the PR to match applied Supabase history exactly. No legacy posting writer, inventory FIFO, journal identifiers or historical amounts were changed.

### CI evidence
- GitHub Actions `Verify main` run `38135622191`: verify PASS, DB integration/security **68/68** PASS across 9 files, Playwright PASS.
- Tests explicitly include draft-to-POSTED outbox emission once, valid receipt event generation, rejected cross-branch receipts, immutable journal evidence and all API/worker permission denials.

### Production live verification
- **7,259** source journal lines, **7,259** private immutable line identity snapshots; all **7,259** mapped, **0** unmapped.
- **2,247** posted journals, **126** organization accounts, **183** branch mappings, **120** semantic mappings, **4** periods, **175** purchases unchanged.
- **0** outbox events immediately after deployment: events intentionally begin with **new** transactions, with no artificial historical event replays.
- Evidence and outbox tables both have RLS; authenticated and service roles cannot directly read or modify them. `anon` cannot call the agent readiness endpoint; authenticated calls undergo active user + permission + branch access. Client roles cannot execute the worker claiming procedure.
- Rollback-only production smoke: temporary organization/two branches and account; POSTED journal plus two balanced lines recorded 2 `UNMAPPED_AT_POSTING` evidence rows; one journal event; wrong-branch receipt rejected; correct receipt event emitted; synthetic accountant read permitted sanitized readiness context reporting 2 unmapped lines and 2 pending events, autonomous execution false. All transaction fixtures rolled back with zero remaining organization/evidence/outbox/receipt records.

### Operational scope limitation
Journal identities are **materialized as immutable evidence** beside (not instead of) source lines. This gives an organization trial balance projection and an auditable bridge, but full canonical writer cutover requires a dedicated compatibility release. The outbox is created and workers can lease it, but no continuously running delivery worker or model provider is deployed. The read-only UI is a safe agent *foundation*, not production autonomous AI.

## Phase 8B — verified internal event consumer (2026-10-11)

Migration: `20261011130910_phase8b_verified_event_consumer.sql` (applied to the configured Supabase project). This adds a database-owner-only consumer to complete the event capture pipeline, without introducing external providers or an automatically scheduled worker.

- `private.erp_domain_event_receipts_v2`: one immutable processed receipt per unique outbox event, including organization/branch identity, event payload hash, verified source projection, worker and processed timestamp; RLS enabled and all direct API roles revoked.
- `private.erp_verified_event_projection_v2(uuid)`: compares each event against the live journal or purchase receipt source, checks journal debit/credit balance and Phase 5L evidence identity/amounts, or purchase receipt ownership. Rejects missing, malformed or conflicting source records; returns only sanitized aggregate facts.
- `private.process_erp_domain_outbox_batch_v2(text,integer)`: DB-owner-only limited (up to 100) batch claim, per-event exception isolation, immutable sink insert and delivery acknowledgement in one transaction. Duplicate processing cannot create a second receipt.
- `private.retry_failed_erp_domain_event_v2(uuid,text)`: DB-owner-only explicit retry with minimum reason, maximum five attempts, no unbounded automatic retry.
- `private.erp_domain_delivery_health_v2`: private group diagnostic counts for delivered/pending/failed events.
- **Critical scope:** There is no pg_cron extension installed in the current Supabase database and no scheduled external event worker. A privileged database operator must invoke the worker; do not call this an automatically running event processor.

### CI and Production verification
- CI run `38141744875`: verify PASS, DB **72/72** integration/security tests PASS (10 files), browser-smoke PASS. The current final head after documentation and migration filename alignment must also be green before merge.
- Verified production application version `20261011130910`. Post-install source data unchanged: 7,259 original journal lines, 7,259 immutable org evidence rows, 0 unmapped, 2,247 posted journal headers, 183 account links. No synthetic queue or processing receipt remains.
- Rollback-only production smoke: 3 outbox events created (balanced journal, intentionally incomplete journal, valid purchase receipt). First worker batch: 3 claimed, 2 delivered, 1 rejected with logged reason. After correcting the failed journal and manually reopening it with documented reason: second batch 1 claimed, 1 delivered, 0 failed, for a total of 3 immutable receipts. Synthetic organization, journal lines, event queue and processing receipts all **fully rolled back**.
- `authenticated` cannot directly SELECT delivery receipts or execute the internal processor. No autonomous financial actions and no outbound network delivery are enabled.
