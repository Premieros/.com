# PremierOS Branch Hub — foundation (NOT production-ready)

This is the **initial local branch gateway**, not a complete offline POS or Windows installer. It keeps an idempotent SQLite print-job queue, provides a local health endpoint, and deliberately does not print or synchronize financial records yet.

Requires Node.js >=22.13 (bundling as a Windows installer is a later stage).

## Loopback smoke test

Set BRANCH_HUB_ORGANIZATION_ID (organization identifier), BRANCH_HUB_BRANCH_ID (unique branch identifier) and BRANCH_HUB_TOKEN (random 32+ character secret), then run `node branch-hub/server.cjs`. Default bind: 127.0.0.1:3847. DB lives under APPDATA/PremierOS/BranchHub/<branch id> on Windows. Never put the secret in client-side JavaScript or in a QR code.

## Secure LAN mode

Set BRANCH_HUB_HOST=0.0.0.0, BRANCH_HUB_TLS_CERT, BRANCH_HUB_TLS_KEY, and BRANCH_HUB_TOKEN. LAN bind is rejected without TLS. Install a certificate trusted by tablets/phones. Configure Windows firewall for branch subnet only. Device pairing, per-device credentials, revocation, persistent authenticated sessions, and a certificate provisioning UX are NOT YET implemented; the shared token is for controlled developer testing only. Do not expose the server to the internet.

## Premier Local Network — waiter ↔ kitchen pilot (unreleased)

This branch adds a **separate local kitchen-draft workflow** to the existing
Branch Hub SQLite database. It is deliberately NOT a live POS order, stock
consumption, payment, accounting posting or Supabase reconciliation. The
existing cloud KDS screen and POS still use their current RPCs.

- HTTPS /lan renders an Arabic phone/tablet screen with **zero CDN scripts**.
  The static web UI accepts a device-specific credential manually; never pass
  credentials in URLs, shared QR codes, query strings or repository files.
  The backend requires a paired **per-device** secret for all local kitchen APIs.
- Waiter may create a durable kitchen-only draft with station, table, quantities,
  unique operation key. Kitchen tablets are restricted to one provisioned
  station, may move new→cooking→ready. Originating waiter may mark ready→served.
  Both operations use SQLite transactions; retries are deduplicated and version
  conflicts rejected.
- A branch-scoped Server-Sent Events stream includes cursor IDs so a
  disconnected tablet can replay changes after reconnecting. Every request and
  live push rechecks device revocation. Only the authorized station or
  originating waiter receives each event.
- Branch Hub's existing master token only accesses *legacy maintenance APIs
  from loopback*. The new waiter/KDS endpoints DO NOT accept the shared master
  credential. Wildcard CORS was removed; forged Host/Origin requests are
  rejected. LAN binding requires a configured TLS certificate and explicit
  trusted hostname/IP. Do not expose the service via router port forwarding.
- The Windows Branch Hub desktop stays on loopback **by default**. In a
  controlled lab, an administrator may set `lanEnabled: true`, `lanHostname`,
  `lanPort`, and absolute `tlsCert`/`tlsKey` paths in the existing userData
  `branch-config.json`. Its window then shows the exact HTTPS `/lan` URL.
  A missing hostname/certificate fails closed; no firewall rule is installed.
  Do not enable remote listening on a customer network without cert
  provisioning, authenticated enrollment UX and complete security review.
- Branch Hub's local SQLite is still plaintext on disk; portable encrypted
  backups, secure device enrollment, operator PINs, rate limiting, lockout,
  signed enrollment and cloud-side rights revocation are NOT complete.

### Controlled development-only test

Prerequisites: Node >=22.13, a trusted test PC and a test-only organization
and branch identity. No customer orders or production secrets.

Set BRANCH_HUB_ORGANIZATION_ID, BRANCH_HUB_BRANCH_ID, and a unique random
BRANCH_HUB_TOKEN (32+ characters) on the administrator's machine. Stop the
Hub first, then run from the repository root:

    node branch-hub/provision-device.cjs pair waiter_phone_001 waiter_001 waiter
    node branch-hub/provision-device.cjs pair kitchen_tablet_001 chef_001 kitchen hot

Each command prints its **one-time device credential** locally. Treat it as a
secret and manually enter it in the HTTPS /lan page; never share the master
token with a phone. Set BRANCH_HUB_DATA_DIR consistently for both the admin
CLI and the actual Hub (do not point to production). Revoke with:

    node branch-hub/provision-device.cjs revoke waiter_phone_001

For LAN access, configure BRANCH_HUB_HOST=0.0.0.0,
BRANCH_HUB_LAN_HOSTNAME=<locally resolvable host or branch IP>,
BRANCH_HUB_TLS_CERT and BRANCH_HUB_TLS_KEY with a certificate trusted on the
phones. Restrict Windows firewall to the branch subnet. Access
https://<BRANCH_HUB_LAN_HOSTNAME>:3847/lan from the same LAN. The test
device IDs, names and station codes above are illustrative and must match
enrollment. Access to the full Premier cloud app via this URL is NOT implied.

### Test contract

    node --test branch-hub/server.test.cjs branch-hub/lanKitchen.test.cjs

Tests use loopback and an isolated temporary SQLite DB. They must pass
without access to Supabase or any external network. A green unit test does
NOT authorize live rollout; see docs/PREMIER_MASTER_WORK_LOG.md for the
production readiness gates.

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
