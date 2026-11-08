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

Status on 2026-11-08: **Phase 1 code submitted for CI; phases 2 and 3 not yet
implemented.** No live DB writes, paid Supabase branches, PR merges or
production promotions were performed by these changes.
