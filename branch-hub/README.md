# PremierOS Branch Hub — foundation (NOT production-ready)

This is the **initial local branch gateway**, not a complete offline POS or Windows installer. It keeps an idempotent SQLite print-job queue, provides a local health endpoint, and deliberately does not print or synchronize financial records yet.

Requires Node.js >=22.13 (bundling as a Windows installer is a later stage).

## Loopback smoke test

Set BRANCH_HUB_ORGANIZATION_ID (organization identifier), BRANCH_HUB_BRANCH_ID (unique branch identifier) and BRANCH_HUB_TOKEN (random 32+ character secret), then run `node branch-hub/server.cjs`. Default bind: 127.0.0.1:3847. DB lives under APPDATA/PremierOS/BranchHub/<branch id> on Windows. Never put the secret in client-side JavaScript or in a QR code.

## Secure LAN mode

Set BRANCH_HUB_HOST=0.0.0.0, BRANCH_HUB_TLS_CERT, BRANCH_HUB_TLS_KEY, and BRANCH_HUB_TOKEN. LAN bind is rejected without TLS. Install a certificate trusted by tablets/phones. Configure Windows firewall for branch subnet only. Device pairing, per-device credentials, revocation, persistent authenticated sessions, and a certificate provisioning UX are NOT YET implemented; the shared token is for controlled developer testing only. Do not expose the server to the internet.

## Roadmap / production acceptance gates

1. Package Windows installer/service with SQLite backups, encryption at rest, migration/versioning, startup recovery and printer worker.
2. Build local branch APIs for sales, orders, payments, stock and journals, all atomic, audited, idempotent and branch scoped; retain server-side authority on local hub.
3. Serve the entire PremierOS frontend locally and support offline login, permissions and same-LAN phones/tablets; device pairing with rotation/revocation.
4. Durable outbox/inbox and deterministic cloud synchronization with strict ownership and conflict rules; verify double-apply prevention.
5. Simulate WAN loss and restart; multi-device concurrent transactions and print receipts; restore from backup; security/load test before production.

Current app offline IndexedDB data and cloud Supabase RPCs do **not** satisfy these gates.

## Permanent branch binding (foundation)

The first startup stores the organization and branch identity in the local SQLite database. Later startup refuses a different identity for that same data directory. New print-job submissions must include matching `organizationId` and `branchId` and fail with `BRANCH_SCOPE_MISMATCH` otherwise. This is a defense-in-depth guard **not secure server-side enrollment**: the configuration must ultimately be issued by the cloud after the administrator authenticates, signed, stored securely, and tied to a registered device. Changing branch requires an explicitly audited re-enrollment/migration workflow; never point another branch at an existing data directory.

Remote app updates, offline full ERP, printer execution, and synchronization are still not implemented by this foundation.

## Windows desktop prototype and installer build

The `branch-hub/desktop.cjs` Electron shell is now packaged by `.github/workflows/build-branch-hub-windows.yml` into a **prototype NSIS .exe** in GitHub Actions artifacts (only if the build succeeds). This is **not** the release-ready single installer promised for branches. It does not yet support real branch enrollment, provisioning of trusted TLS for tablets, POS transaction processing, physical printer execution, cloud synchronization, remote update rollout, or automatic recovery. The prototype deliberately shows an unconfigured state rather than silently selecting an organization or branch.

Developers may configure `branch-config.json` under Electron userData containing `organizationId`, `branchId`, and a 32+ character `token` for isolated lab testing only; this file is NOT a secure enrollment mechanism. Never ship it with production credentials.

The new local receipt API stores **draft records, not approved/final sales**. Nothing here debits inventory, receives payments, posts ledger journals or performs cloud sync. No real sales should be made through the prototype.

## Local database backup prototype

The Branch Hub exposes a **server-side only** `createLocalBackup()` method using SQLite `VACUUM INTO`, then verifies `PRAGMA quick_check` and the embedded organization/branch identity. Backups live under the per-branch data folder in `backups/`, retain the pending sync outbox and do not acknowledge unsynced events.

This is **not yet scheduled or off-machine backup**, nor encrypted backup, retention policy, or an administrator-approved restore workflow. The SQLite file may contain customer/transaction data: protect the Windows profile and backup folder and do not copy snapshots to shared/untrusted folders. Never overwrite a live DB while the server is running. Any restoration must verify that the target installation belongs to the same organization and branch.

A Windows installer may be produced only after GitHub Actions succeeds; generating the artifact does not by itself make the prototype safe for real sales.

## Verified offline restore (fresh directory only)

Stop Branch Hub first. From a trusted administrator terminal, run:

```sh
node branch-hub/restore.cjs /secure/backup.sqlite /empty/branch-data-dir org_001 branch_001
```

The destination directory must be empty. Recovery verifies a full SQLite integrity check, expected organization/branch binding, and the presence of core receipt, sync outbox, and print-job tables. It refuses corrupt backups, mismatched branches, and existing data. Once restored, start the hub with `BRANCH_HUB_DATA_DIR` pointing at the restored directory and matching identity. Never run restoration against a live branch data directory. Keep backup encryption/off-machine rotation and operator approval as separate release blockers.

## Offline sales kernel (isolated development module)

`offline-sales.cjs` now supplies a branch-scoped SQLite transaction engine for integer-unit stock, checkout idempotency, atomic stock consumption, a balanced four-line cost/revenue journal, and a pending offline outbox event. It rejects insufficient stock, mismatched idempotency payloads, numeric overflow and cross-branch stock access. Run `npm test` inside `branch-hub` to execute its regression tests.

**Not wired into the HTTP API or UI yet.** Opening stock is an initial import-only operation and cannot modify existing balances. This kernel is not a full approved POS: returns, taxes, split tenders, permissions, actual FIFO/batch cost, real Supabase reconciliation, and complete posting into Premier accounting remain separate tasks. Do not process production sales using this module.
