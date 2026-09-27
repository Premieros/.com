# Zero-Cost Baseline — 2026-09-27

Repository: `Premieros/.com`  
Supabase project: `hvqlkapynjfjikqithvd`  
Scope: new independent clone only.

## Guardrails

- Do not touch `Premieros/johna-s`.
- Do not touch Supabase project `azzdesuowpdcoflmyezn`.
- No direct writes to `main`.
- No Production migration in this phase.
- No changes to printing, Print Agent, routing, KDS, or send-to-kitchen behavior.
- Preserve RLS and server-side authorization.

## Why this work exists

The original environment showed that free-tier pressure can arrive from logs, database growth, and egress long before user-count limits. The new clone should therefore optimize network chatter and retained data from day one.

## New-project baseline observed

At inspection time, the new database is essentially empty operationally. Largest public application tables are still only tens to hundreds of KB, and sales/orders/inventory ledger tables have no operational rows.

The last-24-hour Supabase unified log sample was dominated by platform/setup traffic:

- pgbouncer logs: ~11.6k events
- PostgREST logs: ~1.8k events
- edge logs: ~1.1k events
- Realtime logs: ~618 events
- Postgres logs: ~513 events

The sample also showed repeated Realtime websocket setup traffic. Because this project was being bootstrapped/deployed during the same window, this is not yet a steady-state production measurement. Re-check after 24–48 hours of normal use.

## Phase 1 — implemented in code

### 1. Remove per-audit Auth network round-trip

`src/lib/audit.ts` now reuses the locally persisted Supabase session for audit metadata instead of calling `auth.getUser()` over the network for every business event.

Authorization is unchanged: the audit insert is still authorized by the database/RLS.

Expected effect:
- one fewer Auth request per audit event;
- less edge/log traffic;
- lower latency on audited operations.

### 2. Stop re-querying 30 audit rows after every Realtime insert

`DashboardStandbyBar` now consumes the inserted Realtime row directly.

A canonical read still happens:
- on initial load;
- when a channel reconnects;
- if an unexpected Realtime payload shape is received.

Expected effect:
- removes one REST read of up to 30 rows for every audit insert;
- lowers egress and PostgREST/edge logs;
- preserves reconnect correctness.

### 3. Keep the dashboard Realtime channel stable while opening/closing the activity panel

Panel state is now tracked by ref so toggling the panel does not recreate the Realtime subscription.

Expected effect:
- fewer websocket/channel reconnects;
- lower Realtime setup/log traffic.

## Phase 2 — next safe optimizations

1. Measure a clean 24-hour production window after this phase.
2. Find the top REST/RPC endpoints by request count and transferred bytes.
3. Remove only redundant reads; do not cache transactional truth such as payments, stock mutations, settlement, or permissions.
4. Review global periodic refreshes. Prefer:
   - explicit invalidation after a mutation;
   - page-focus revalidation;
   - Realtime only for genuinely live screens.
5. Keep POS active-order refresh event-driven and coalesced; do not add polling.
6. Review report queries for bounded pagination and server-side aggregate RPCs.

## Phase 3 — database growth controls (requires separate approval)

Do not delete financial or stock history just to save space.

Candidate retention policy:
- permanent: sales, sale items, payments, inventory ledger, purchasing/accounting records, treasury, shift/day closes;
- bounded/archivable: technical audit payloads, ephemeral queues, transient diagnostics, old notification state.

Before any retention migration:
- identify exact tables and foreign keys;
- prove no report/accounting dependency;
- export/archive first where needed;
- run Full Verify and advisors.

## Free-tier operating thresholds

Internal early-warning thresholds, intentionally below provider hard limits:

- Database size: warning at 300 MB; action required at 400 MB.
- Egress: warning at 50% of monthly allowance; action at 75%.
- Log ingestion: warning at 60%; action at 80%.
- Realtime connections/messages: investigate any sudden step-change rather than waiting for the cap.

## Design rule

The system should stay portable PostgreSQL-first:

- keep business truth in PostgreSQL tables/functions;
- keep RLS/authorization explicit;
- avoid introducing provider-specific features where a normal PostgreSQL pattern is sufficient;
- use Supabase-specific Realtime/Auth only where they materially reduce complexity.

This keeps the current free stack efficient while preserving a future migration path to another PostgreSQL host if needed.
