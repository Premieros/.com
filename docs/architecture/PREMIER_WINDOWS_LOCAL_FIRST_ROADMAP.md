# Premier OS Desktop — local-first implementation gates

Scope: Premieros/.com only; canonical cloud backend is the existing Supabase
project hvqlkapynjfjikqithvd. This document describes staged work, not a claim
that Premier ERP is already able to transact fully offline.

## Phase 1 — locally bundled frontend (this draft PR)

- Electron starts a **read-only HTTP server** bound only to 127.0.0.1:43187.
  The fixed origin is necessary because the IndexedDB outbox is origin-scoped.
  A random port each launch would hide all previously queued offline sales.
- The server reads **only** from the Electron-bundled dist/ build, serves
  BrowserRouter deep links, rejects traversal and different Host headers, and
  exposes no generic filesystem, proxy or transaction endpoint.
- The window has no GitHub Pages/Vercel fallback and refuses cross-origin
  navigation. If the bundled dist is absent or the port cannot be reserved,
  launch fails visibly rather than displaying an older or foreign app.
- Printer IPC remains isolated through Electron preload and its existing
  per-printer queue. No stale cloud-print jobs are auto-replayed.
- Node tests and a smoke test against the *real* vite dist are required in
  Linux CI and the Windows packaging workflow.

**Important compatibility warning:** The old desktop shell loaded
https://premieros.github.io/.com/ . Its IndexedDB, pending sales and localStorage
belong to that **different web origin**. The new loopback origin does **not**
import, migrate, clear or mark them synced. Before operator rollout, inventory
outstanding offline orders/sales on every branch PC under the old origin,
confirm server receipts, and execute a reviewed one-time outbox migration that
cannot duplicate financial documents. Do not overwrite existing live sales or
open orders. This is a **mandatory release gate**, not an optional cleanup.

## Phase 2A — incremental safe local capture (draft, test-only)

The currently existing IndexedDB offline-sale outbox is being hardened while
the independent device-native transaction database is designed:

- Payment checkout, OfflineProvider and SalesRepository now use **one IndexedDB
  readwrite transaction across sales_queue and local_stock_movements**.
  A failed write rolls back the sale and all associated deductions together.
- The same transaction checks previously queued branch invoices and client
  operation keys to refuse duplicate offline financial captures; `add` does
  not overwrite a duplicate local sale ID.
- Incomplete branch, warehouse, operator, item or quantity scopes are rejected
  before any transaction starts. No warehouse is filled in at reconnect.
- The sync worker uses strict financial outbox reads (a corrupt/unreadable DB is
  NOT interpreted as zero pending) and waits for deletion to commit before
  claiming a successful local dequeue.
- Regression tests simulate mid-write aborts, duplicate invoices, repeated
  attempts, local restart, invalid scope, unreadable storage and failed delete.

**This does not add authoritative offline purchase, accounting, production or
stock posting** and does not upgrade to an embedded encrypted database yet.
IndexedDB is origin/profile scoped and not a replacement for a tested,
device-native crash recovery, backup and restore layer. Existing hosted-origin
sales remain subject to the migration gate from Phase 1.

## Phase 2B — native encrypted document-draft journal (implemented in draft PR)

The Electron Node 22 main process now has a separate SQLite/WAL/FULL durability
foundation at electron/localDraftJournal.cjs. It is intentionally **draft-only**
and is NOT the current authoritative sale queue:

- SQLite draft rows survive application process restarts; all payload bytes are
  encrypted with an injected OS-protected codec. Windows integration uses
  Electron safeStorage, fails closed without OS encryption, and stores no
  plaintext fallback.
- Scoped organization/branch/operator/device identity and branch-unique
  invoice/idempotency fingerprints reject conflicting duplicate drafts.
- Domain draft kinds exist for sale, return, held order, kitchen ticket,
  purchase receipt, stock movement, manufacture, expense and accounting
  journal draft. The only allowed states are LOCAL_PENDING and NEEDS_REVIEW.
  Neither means posted or confirmed.
- A read-only Electron preload call getLocalDraftHealth verifies local storage
  integrity and reports mode DRAFT_ONLY, canPost=false, canSync=false.
  No general document-write or raw SQL IPC capability is exposed to the UI.
- Node 22 Linux/Windows regression checks exercise encrypted storage,
  duplicates, rollback, restart, corrupt ciphertext, and cross-branch access.
- OS-protected encryption may tie backups to the Windows user profile.
  **Do not export SQLite files and assume they can be decrypted on another PC**;
  a separately reviewed portable encrypted backup and key-recovery protocol
  is still mandatory before branch deployment.
- The existing V5 IndexedDB outbox remains the source of offline sales and
  is **not automatically copied or replayed into SQLite**. Migration and
  unification require a separate one-time receipt-by-receipt reconciliation.

## Phase 2C — atomic confirmed-sale cleanup (implemented in draft PR)

When the canonical Supabase sale RPC confirms a sale, the sync worker now
deletes the queued invoice and scoped local stock movements **in one IndexedDB
readwrite transaction**. A failed transaction retains both stores for
idempotent reconciliation after restart. It checks the captured branch,
invoice and warehouse and refuses cross-scope deletion.
Unit regressions cover partial delete failures, wrong warehouse, another
branch and repeated attempts. A manually discarded unsynced document does
not constitute confirmed posting.

## Phase 2 — local transaction engine (not yet delivered)

Implement an embedded, durable transaction store owned by one per-device
process, not by random UI pages. Protect branch, organization, warehouse,
operator, unique device identity and transaction scope with explicit validation.
Record an immutable locally ordered transaction journal, document version,
time source and idempotency key. Outbox status transitions must be atomic with
local stock changes; crash recovery must replay an operation *exactly once*
locally. Backup/restore and encryption-at-rest design must be completed before
any real shop relies on this store.

Required offline operational families:

1. Catalog, prices, UOM, warehouse, branch, permission and business-rule
   snapshot with expiry and tenant isolation.
2. POS sale/return, table/hold order, kitchen send and physical printing, with
   immutable receipt numbers from a reserved per-device namespace; never
   manufacture server-success confirmations while disconnected.
3. Raw and finished stock: warehouse-scoped batches, FIFO/debt, BOM, costing,
   production and waste, with exactly-once ledger entries.
4. Purchases/receiving, payments, shifts and cash drawer, with stable document
   IDs and no hidden cross-branch inventory borrowing.
5. Journal posting and treasury: either implement the canonical balanced
   posting model transactionally or clearly mark offline documents "pending
   server posting"; never display a pending cash or journal as POSTED.

## Phase 3 — cloud reconciliation (not yet delivered)

- Sync via the existing authorized canonical Supabase RPC contract only after
  reconnecting and refreshing operator/branch permissions.
- The server is authoritative on branch transactions and posted accounting.
  Submit with tenant+device+document idempotency keys and checkpoint cursors.
- Two-stage ACK: upload/validate, then persist the server-issued receipt.
  Recover from timeouts/retries, double-clicks, power cuts, duplicate receipts
  and out-of-order shipments without duplicating costs, journals or stock.
- Never auto-resend old physical print jobs on reconnect. Local print completion
  and server print queue IDs must remain separately trackable.
- Surface explicit conflict queues (price changes, void/return of previously
  synced sales, stale opening balance, negative inventory, different physical
  counts) requiring operator review rather than silent quantity updates.

## Phase 2D — signed Windows updates on real Exit (implementation in draft)

The Windows app retains its locally bundled web interface, so a new feature or
new screen appears only as part of a **new versioned Windows installer**, not
from silently swapping in an unrelated website.

- The app's signed NSIS update client is implemented in
  `electron/desktopUpdateManager.cjs`. When explicitly authorized for release,
  it checks only the pinned official `Premieros/.com` GitHub Releases stable
  channel, downloads in the background when connected and defers installation
  until a **real app exit**. No restart during cashier transactions.
- Closing the window with **X** continues to **hide it in the system tray** so
  the print agent stays available. The Windows tray menu now offers **Exit
  Premier OS**: this action genuinely closes the app and, when safe, installs
  an already downloaded and verified update.
- The installer safety gate reads all four authoritative local IndexedDB
  stores and rejects installation if there is any pending sale, unacknowledged
  hold order, outbox operation, unsynced stock movement, ongoing printer job
  or encrypted SQLite draft. Missing/unreadable stores or mismatched origin
  also block installation. Updates never clear or replay local data.
- If installation is unsafe, the app **quits normally without installing the
  update**. The verified update is deferred until the next safe exit.
- **The committed release policy is disabled by default**:
  `electron/desktop-update-policy.json` has `enabled=false`, with no signed
  publisher. No Windows client is currently opted into unsigned updates.
- Before authorizing real automatic updates, issue an Authenticode-signed
  NSIS installer, set and pin its verified `win.publisherName`, verify
  electron-updater's signature checks, create a reviewed stable GitHub Release
  with verified `latest.yml` and its checksums, implement tested rollback and
  old-origin IndexedDB migration, and run a pilot on real Windows printers.
- The separate portable EXE is **not self-updating**. Never push a remote
  JavaScript hot-reload as an unreviewed replacement for the bundled UI.
- The PR Windows packaging command uses `--publish never` so pull-request
  CI cannot accidentally publish a customer update.

## Mandatory readiness gates before calling Windows "fully local"

- Fully packaged installer builds on Windows, installs, starts and restarts on
  a device with network disabled (including deep-link navigation and printers).
- Verify previous-origin IndexedDB outbox reconciliation and safe first-run
  migration on each existing branch PC.
- Verify cash sale, return, table->kitchen->receipt, stock, manufacturing,
  purchase, expenses and balanced journal end-to-end while disconnected.
- Kill process mid-transaction and mid-sync; prove no lost/duplicate orders.
- Multiple devices and two branches: reconnection order, idempotency,
  permission revocation, duplicate invoice numbers, closed shifts and FIFO.
- Validate independent encrypted backups, restoration, signed binaries,
  firewall, RLS and operator permissions; do not ship credentials or
  service_role keys in a desktop binary.
- Validate SQL migrations and recoverable backup on separate staging before
  production changes. A green CI test is not a production rollout approval.
- Existing PR #132 remains a separate production remediation gate; merging
  this local-shell PR alone does not apply its database migrations.

Status on 2026-11-08: **Phase 1 local shell and Phase 2A atomic IndexedDB capture are submitted for CI.** The independent native transaction engine, full ERP offline posting, hosted-origin migration and Phase 3 cloud reconciliation are not yet delivered. No live DB writes, paid Supabase branches, PR merges or production promotions were performed by these changes.
