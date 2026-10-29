# Premier Windows Branch Server — Work Breakdown & Acceptance Checklist
Source of binding scope: [Product Contract](./WINDOWS_BRANCH_SERVER_PRODUCT_CONTRACT.md).
**All items initially NOT STARTED. Planning is not implementation.** Implement in sequence; do not skip gates. Every task requires a separate reviewed PR targeted to `development/premier-windows-branch-server-plan`, a test report, and explicit approval before main/production. Do not modify cloud schema/production data without a new explicit authorization.

## 0. Discovery & architecture (must be first)
- [ ] **WBS-00 Inventory real Premier application dependencies.** Trace screens/routes, auth/permissions, branch/warehouse scoping, cloud reads/writes/RPCs, POS/orders/payments, stock/recipes/costing, journals, print flows and existing offline logic. Deliver UI↔API↔table mapping; list operations that fail with WAN off. Test by network cut.
- [ ] **WBS-01 Define authoritative ownership & conflict contracts.** Organization/branch/server/device IDs, transaction IDs, inventory and accounting posting responsibility, command vs event vs snapshot, conflict matrix for catalogs/prices/stock/sales, branch-local versus central editing, at-least-once transport with exactly-once business effects. Include reconciliation and unresolved conflict procedures.
- [ ] **WBS-02 Select full local persistence strategy.** Compare PostgreSQL and SQLite against existing Supabase functions/triggers/constraints/RLS and real concurrency/crash tests, migrations, backup/restore, supportability. Decision record + migration/rollback plan; NO assumed parity.

## 1. Windows installation and stable service
- [ ] **WBS-10 Secure branch enrollment.** Admin-authenticated enrollment to exactly one organization/branch, registered host device identity, signed configuration, secure secrets, branch transfer explicitly audited, device revoke/rotation.
- [ ] **WBS-11 Production Windows installer and Service.** Signed x64 installer; durable background service auto-starts after boot, survives Electron/tray closure, runs without user login, recovery after process crash, clean upgrade/uninstall with explicit keep/delete local data choice. Service least privilege.
- [ ] **WBS-12 Local networking/security.** Loopback + authenticated TLS LAN, certificate provisioning/renewal and trusted devices, firewall restriction, per-device pairing/roles/revocation and audit logs. Access from authorized cashier/kitchen/tablet on same LAN without WAN.

## 2. Actual UI and offline business execution
- [ ] **WBS-20 Package and serve the REAL Premier frontend locally.** All approved screens/assets, same routes and branding as deployed application; no remote asset/CDN dependency for offline operation. Publish version manifest; authenticate locally; role/permission and branch enforcement. Test cold start with WAN physically disabled.
- [ ] **WBS-21 Local business command engine.** Durable atomic validation/posting for orders→sale→payments/refunds, purchase/receipts, inventory across correct branch/warehouse, BOM/recipes/costing and double-entry journals as required by accepted domain mapping. Read-only reports must reflect local unsynced transactions. No dummy receipts considered completed sales. Negative stock, FIFO and accounting guards preserved.
- [ ] **WBS-22 LAN multi-device operation.** Concurrent cashiers, kitchen, tablets share the ONE branch server and current local state; no double booking/repeated financial events. Safe retries across disconnects and restarts; access controls per user and workstation.

## 3. Physical printing
- [ ] **WBS-30 Printer discovery/routing/configuration.** Windows print spooler/network/USB ESC/POS integrations as appropriate; per-printer/station/ticket routing, kitchen course/updated-order rules, encoding/Arabic and clear offline/error UI.
- [ ] **WBS-31 Print executor & dedupe.** Persist job→attempts→confirmed/failed/unknown states, retries with clear uncertain-output handling, no unsolicited duplicate kitchen tickets or payment slips. Test unplug/reconnect, timeout, crash between print and acknowledgement, manual authorized reprint.

## 4. Cloud synchronization & integrity
- [ ] **WBS-40 Durable upload outbox and cloud idempotent intake.** Sync only accepted branch-scoped committed events in causal order; signed/authenticated device; end-to-end acknowledgements; event IDs unique; replay after WAN/power loss and retry without double sale, stock, payment, or journal.
- [ ] **WBS-41 Durable cloud→branch inbox.** Receive catalogs, prices, recipes, permissions and other authorized updates incrementally, versioned and reconciled; branch-owned mutable data not overwritten blindly; tombstones and schema versions covered.
- [ ] **WBS-42 Conflict recovery and operations observability.** Pending/synced/failed/conflicted counts, last sync, recoverable retry, operator-reviewed resolution, dead-letter, audit trace; multi-day outage, clock drift, sequence disorder, reset/reconnect, change while offline. Keep unacknowledged data indefinitely until correctly resolved.
- [ ] **WBS-43 Financial/inventory reconciliation.** Automated invariant checks comparing local and cloud sale totals, line items, payments, stock ledger, FIFO/COGS, balanced journals and branch isolation. No silent repair; human review for historical cases. Test double replay and two devices.

## 5. Auto-update, backups and delivery
- [ ] **WBS-50 Approved signed application update channel.** Download approved versioned front-end/backend changes when WAN returns; check signature/checksum, stage assets/binaries, coordinate local DB migration, health check and rollback. No unsafe update mid-transaction and no loss of outbox. Demonstrate newly released screen appears offline after sync/restart.
- [ ] **WBS-51 Scheduled encrypted backups and verified restoration.** SQLite/PostgreSQL consistent snapshots depending on WBS-02, retention, off-machine option, backup while online, restore identity verification and replay unsynced data, tested disaster restore and low-disk scenarios.
- [ ] **WBS-52 End-to-end acceptance and release gates.** Install on clean Windows; enroll two *separate* branch hosts; each operates offline with 2+ LAN devices; sales, payments, stock/BOM/COGS, accounting and real printer; reboot host; WAN reconnection with repeated/late messages; sync all data once; approved UI update; restore; permissions/isolated branch security; installer upgrade/rollback. Produce evidence for each scenario.
- [ ] **WBS-53 Pilot release plan.** Signed build, monitored single-branch pilot, rollback/incident runbook, operator onboarding; no real branch production cutover before owner approval and WBS-52 PASS.

## Acceptance evidence required per item
1. Changed-file and impact inventory; statement of no unauthorized hosted schema/data changes.
2. Exact commands, logs, integration/E2E scenarios and results (not only successful build).
3. Security, concurrent use, offline and crash failure cases relevant to task.
4. Explicit rollback, data-preservation plan and any migration diff for separate approval.
5. Owner sign-off before marking ACCEPTED or deploying.

## Decision gates
- **Gate A (WBS 00–02):** Sign off architectural contracts and local DB selection.
- **Gate B (10–12,20):** Real Premier frontend and secure local service work with WAN disabled.
- **Gate C (21–31):** Complete business cycles and actual printer passes crash/LAN tests.
- **Gate D (40–43):** Multi-day disconnected/reconnect replay passes inventory/accounting reconciliation.
- **Gate E (50–53):** Signed updater, recovery and final two-branch production-like pilot passes.
No phase can be declared complete on screenshots or prototype artifacts alone.

## Agent next action (ONLY)
Complete **WBS-00** as a read-only architecture audit. Create dependency matrix and explicit gap report in this branch. Do not start implementation, refactor, deploy, alter schema, or write production data.

## WBS-00 discovery checkpoint — 2026-10-29

**Status: BLOCKED for acceptance; discovery evidence prepared for review.** The source inventory and [gap report](architecture/WINDOWS_BRANCH_SERVER_DISCOVERY_WBS00_2026-10-29.md) cover routes, cloud/local dependencies, business boundaries, printing and WAN limitations. The [dependency appendix](architecture/WINDOWS_BRANCH_SERVER_DEPENDENCY_MATRIX_2026-10-29.md) records the source call sites.

Canonical hosted database identity was verified directly as `hvqlkapynjfjikqithvd`; repository identity remains `Premieros/.com`. Eight local Branch Hub foundation tests passed. An isolated browser WAN-blocking probe observed the missing real Premier UI (authenticated root returns 404) and unimplemented cloud sync. The source API contract is stale, and frontend clean-install/typecheck prerequisites are unresolved. Full frontend/network-loss business acceptance and owner sign-off are still outstanding. No hosted SQL/schema/data writes, application implementation, main merge or deployment are authorized by this checkpoint. All later WBS items remain NOT STARTED.
