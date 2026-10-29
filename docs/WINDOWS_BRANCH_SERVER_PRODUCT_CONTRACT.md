# Premier Windows Branch Server — Binding Product Contract
Status: PLANNING ONLY. Branch: `development/premier-windows-branch-server-plan`
Baseline: `main` commit `4e42bf4031b1419dba2992d0aaec2fd3aa0b5d1f` (2026-10-27).
Canonical cloud DB: Supabase `hvqlkapynjfjikqithvd`. This document grants **no permission** to change hosted DB schema or production data.

## User intent — non-negotiable
Build **one Windows-installable Premier Branch Server per physical branch**, not a diagnostic Electron window, print-only agent, or online website wrapper.
- Install on one Windows host per branch; securely enroll and bind to ONE organization + ONE branch; no silent identity reassignment.
- Host the **real, complete, same Premier UI/screens** locally with the assets needed to work without WAN, accessible on Windows and authorized same-LAN cashier/kitchen/tablet devices. Cloud-published UI is the source for approved application versions, **not runtime dependency**.
- Run a persistent background **Windows Service** at boot and after UI closure/restart; separate administrative UI from always-on server.
- Own local operations: atomic, durable branch-scoped orders, sales, receipts, payments, inventory, recipes/BOM, costing, and necessary accounting effects **where authorized**, with correct permissions and audit log. No demo receipts substituted for financial sales.
- Own physical print execution (receipt/kitchen/reprint), routing by workstation/station/printer, retry and idempotency, and clear printed/failed/unknown states.
- Use durable local database, encrypted secrets/backups, schema versioning, restart recovery and integrity checks.
- On connectivity return, **safely send queued transactions, receive appropriate cloud changes**, reconcile acknowledgements; no duplicate posting, stock movements, journal entries, or printing. No cross-branch leakage. Deterministic conflict policy and durable outbox/inbox.
- Automatically download **signed/versioned approved** application releases (new screens, backend and assets); verify signatures, compatibility and migrations, stage and health-check, rollback if needed. Updates never replace local unsynced data. Restart only safely, ideally outside active shift.
- Reuse existing Premier application code and canonical services, avoid rebuilding a separate feature-poor POS.

## Observed current implementation (code-based, 2026-10-28 review)
`branch-hub/desktop.cjs` displays hard-coded HTML status; it does **not** serve or load actual Premier UI. Closing its window kills the child Node server.
`branch-hub/server.cjs` stores print jobs, draft receipts and a pending outbox in SQLite and provides health/integrity endpoints; it does **not** execute physical printing, replay sales into stock/accounting or synchronize with Supabase.
`branch-hub/electron-builder.json` packages a per-user NSIS x64 prototype (Electron) without a Windows Service or updater. `.github/workflows/build-branch-hub-windows.yml` creates a prototype artifact, not a production release.
**Do not claim these features are complete merely because an EXE builds, a job is queued or a webpage loads.** Existing prototype is not approved for live transactions.

## Architecture constraints
Cloud: canonical Supabase PostgreSQL and deployed Premier build. Local: Windows Service + local API + durable branch database + print spooler + bidirectional sync engine + versioned frontend asset server + securely enrolled clients. Electron/tray UI may only manage/status this service; the real UI is served locally.
Use explicit transaction/event IDs generated once; server-side authorization and branch/warehouse isolation; immutable event provenance; monetary integer/fixed decimal precision; idempotent cloud RPCs; durable retries and dead-letter/reconciliation. The local ERP behavior must match cloud business invariants.
Local PostgreSQL vs SQLite for the *full* transactional domain must be chosen only after written technical comparison, referential/transaction tests and mapping of existing Supabase RPCs/triggers/RLS. SQLite is acceptable for prototype queues; not automatic proof of financial equivalence.
One physical branch binding per installation. Never use Supabase anon key or secret tokens as a substitute for device authentication. Pair/rotate/revoke LAN devices; require TLS on LAN; secure Windows firewall and least privilege.
Updates: signed manifest, atomic staged release with checksum verification, migration compatibility, version pinning and rollback. Internet unavailable must **not** block normal local operations.
Separate cloud internet loss from LAN loss; ensure host still works if Windows UI is closed. Explicit failure behavior when server computer/power is lost.

## Sequencing / acceptance gates
Detailed checkable work items: [WINDOWS_BRANCH_SERVER_WORK_ITEMS.md](./WINDOWS_BRANCH_SERVER_WORK_ITEMS.md). Execute ONLY one approved item at a time. Each change requires: concrete scope, changed files, threat/data impact, tests, screenshots/logs or reproducible evidence, rollback, and an associated PR into this development branch. Do not merge to main or deploy without explicit user approval.
**First implementation task is discovery and contracts, not coding a shiny prototype.** Build a map of every current UI and Supabase RPC dependency, offline-sensitive route, printing hook and entity ownership. Present the gap matrix and choice of local domain engine for sign-off.
P0: safety/identity/contracts. P1: Windows service and local UI. P2: full local business transactions and real printing. P3: deterministic sync. P4: signed updates, installer, recovery, acceptance.
No production usage until realistic disconnected multi-device E2E proves complete sale→stock/BOM/costing→journal→print→sync after crash/restart and repeated delivery, while all invariants hold.

## Anti-drift rules for coding agents
1. Read this contract, work-items, `docs/CURRENT_WORK_PLAN.md`, `docs/EXECUTION_GUARDRAILS.md` and `branch-hub/README.md` before changes.
2. Never redefine the goal as a *gateway prototype*, *standalone print agent*, *online Electron wrapper*, or a *basic status dashboard*.
3. Never replace or fake functional acceptance with documentation, mock screens, queued draft receipts or unit-only tests.
4. No database schema, RLS, triggers, financial repair, production deployment, cross-branch data migration or credential rotation without explicit user approval.
5. Keep canonical repo `Premieros/.com` and only hosted Supabase project `hvqlkapynjfjikqithvd`. Local ephemeral DB for isolated tests allowed.
6. No auto-merge or force-push. Sequential commits from latest verified branch HEAD; approved PRs only. Keep main deployable.
7. Fail closed on money, identity, printer ambiguity or reconciliation errors; keep pending events until positively acknowledged.
8. Mark every task as `NOT STARTED`, `IN PROGRESS`, `BLOCKED`, `TESTED`, or `ACCEPTED` based on evidence. Never state feature ready without acceptance proof.
9. If a requirement cannot be safely fulfilled, report the blocker rather than silently reducing scope.
