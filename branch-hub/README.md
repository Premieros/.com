# PremierOS Branch Hub — development build

Repository: **Premieros/.com**, directory `branch-hub/`. The only authorized cloud project is **hvqlkapynjfjikqithvd**, `john's 1`, `eu-central-1`. No Johna's repository or database is used.

**This is a testable development application, not a production-complete offline ERP.** Do not route real branch transactions through it yet. Cloud accounting reconciliation, taxes, returns, split payments, central certificate provisioning and automatic installation/rollback remain release blockers.

## Implemented and tested

- Local SQLite checkout API and responsive Arabic UI at `/`, served without external assets. Integer base quantities and integer minor money units. Cash or bank posting in the kernel.
- Atomic sale, stock debit, cost/revenue journal, outbox and actor audit. Insufficient stock or any write failure rolls back all records. Historical line costs remain fixed. No FIFO. Opening cost is supplied by the administrator; a versioned cloud price command can update future cost and sale price without overwriting quantities or historical costs. The administrator can import ready-product base units and their canonical catalog prices from a selected branch warehouse. Import seeds quantities only once; later refreshes preserve local stock.
- Idempotent checkout, including concurrent devices and browser reload after losing the server response. The browser retains the pending checkout key until a confirmed response; credentials stay in memory.
- Administrator-issued per-device credentials, hash-only storage, viewer/cashier/stock roles and immediate revocation. The stock role currently has read access only. Device permissions cap employee permissions. Local employee accounts use salted scrypt password hashes, device-bound sessions, a 30-minute idle limit and an eight-hour absolute limit. Creating the first employee permanently enables staff login for paired devices; disabling all staff never falls back to device-only access. The administrator token remains the recovery/management credential.
- TLS-only LAN binding. Certificate verification is exercised in tests. Certificates must be provisioned and trusted separately on each phone/tablet; there is no automated certificate enrollment yet.
- ESC/POS TCP printer worker with a server-generated receipt and one job key per sale. Configured literal private IPv4 printers only. No shell commands. ASCII receipts only; Arabic raster printing, USB and Windows spooler drivers remain unsupported.
- Verified SQLite snapshots, AES-256-GCM encrypted archives, six-hour scheduled backups, retention of 14 successful archives, optional checksum-verified mirroring, and fresh-directory restore. Backups preserve accounting, pending events, inbox outcomes, installation identity and printer delivery history.
- Windows NSIS prototype build, packaged-runtime smoke, actual silent installation and installed-runtime smoke in CI, plus an installer SHA-256 checksum. A successful build is not production acceptance or publisher signing.

## Run locally

Node >=22.13 is required. No npm dependencies are needed to run the server or unit tests.

Set `BRANCH_HUB_ORGANIZATION_ID`, `BRANCH_HUB_BRANCH_ID` and a random 32+ character `BRANCH_HUB_TOKEN` on the server. Run `node branch-hub/server.cjs`, open `http://127.0.0.1:3847/`, then enter the token for local administrator testing. The token is never embedded in the page. Issue separate device tokens from the administrator panel; share only those device credentials with cashiers.

The first startup permanently binds SQLite to the supplied organization and branch. Rebinding an existing data directory is refused. IDs are not yet verified against a signed cloud enrollment, so this manual configuration is for isolated testing only.

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `BRANCH_HUB_DATA_DIR` | Dedicated local data directory |
| `BRANCH_HUB_PORT` | Default 3847 |
| `BRANCH_HUB_HOST` | Default 127.0.0.1; LAN example 0.0.0.0 |
| `BRANCH_HUB_TLS_CERT`, `BRANCH_HUB_TLS_KEY` | PEM certificate/key, both required for LAN |
| `BRANCH_HUB_PRINTERS` | JSON whitelist, e.g. `{"cashier":{"host":"192.168.1.50","port":9100}}` |

Do not expose this listener to the internet. Restrict the host firewall to the branch subnet. Test-only TLS fixtures under `fixtures/` are public test data and are excluded from the installer.

## Print outcomes and recovery

`POST /api/v1/offline/sales/<sale-id>/print` accepts `{ "printerId": "cashier" }`. A repeated request returns the same job. Different printer selection for the same sale conflicts. Cashiers cannot enqueue arbitrary raw jobs; the old generic `/jobs` POST is administrator-only.

- `submitted`: the TCP stack accepted the bytes. This **does not confirm paper output**.
- `failed`: no bytes were attempted. The administrator may explicitly retry using `POST /api/v1/jobs/<job-id>/retry`.
- `uncertain`: bytes may have reached the printer. Automatic and API retry are blocked.
- `sending` after a process crash: the outcome is unknown and the job stays blocked. There is deliberately no blind restart retry.

Manual inspection of uncertain outcomes is required before any separately authorized reprint. Power loss after paper output cannot be made exactly-once with an ordinary raw TCP printer lacking transactional receipt acknowledgement.

## Backup and restore

The administrator UI or `POST /api/v1/backups` creates a server-side `VACUUM INTO` snapshot in the branch data directory's `backups/` folder. Files are validated, permission restricted and flushed. Nothing is downloaded to the browser. Snapshots preserve device hashes, audit history, stock, journals, pending outboxes and printer dispatch state.

Stop the old hub before recovery. From a trusted administrator terminal:

```sh
node branch-hub/restore.cjs /secure/snapshot.sqlite /empty/branch-directory organization_id branch_id
```

Only a standalone snapshot is accepted: active WAL sources, corrupt accounting, missing required tables, newer unsupported schemas, cross-branch data and non-empty targets are rejected. Restore atomically publishes a verified file using an exclusive hard link; the target filesystem must support hard links (NTFS on Windows). It cannot overwrite a running database.

Desktop enrollment generates a private backup key inside the OS-protected configuration. The scheduled service starts an initial encrypted backup and then runs every six hours. It retains the latest 14 successful local archives, and never deletes old archives after a failed backup. `backupMirrorDir` optionally copies and checksum-verifies archives to another configured directory; that directory is not automatically an off-site service.

Export the recovery key from the desktop administrator panel and keep it separately from archives. The native save dialog writes the key directly to the chosen new file; the key is not returned to LAN browsers. Losing both the protected profile and the exported key makes encrypted archives unrecoverable.

Encrypted recovery, after stopping the old hub and setting `BRANCH_HUB_BACKUP_KEY` to the exported key:

```sh
node branch-hub/restore-encrypted.cjs /secure/archive.pbh /empty/branch-directory organization_id branch_id
```

Wrong keys, altered ciphertext or mismatched scope cannot publish a restored database. The low-level raw snapshot API remains available to server-side tests; manually configured CLI servers without a backup key still use raw protected SQLite snapshots. Set `BRANCH_HUB_BACKUP_KEY` and optionally `BRANCH_HUB_BACKUP_MIRROR` for encrypted CLI backups.

## Windows desktop

`desktop.cjs` starts the local server and waits for its readiness message before opening the local UI. It reports child-process failure and prevents a second desktop instance. Packaging includes all runtime modules and UI assets; no test key or device configuration is shipped.

A fresh desktop installation now shows a first-run account/branch wizard. Login goes only to the pinned Supabase project; the server checks the account, `branches.manage` (or platform administrator), current branch RLS and active branch identity again at confirmation. It never invents or silently selects a branch. No password is persisted. The cloud refresh token, local administrator token and backup key are protected in `branch-config.secure.json` using Electron safeStorage (Windows DPAPI). A plaintext legacy configuration is migrated only after encryption verification; unsupported/insecure OS vaults fail closed.

The Windows desktop starts at user login and keeps the local hub running in the tray when its window closes. The tray provides an explicit stop/exit action. This is per-user startup, **not a Windows service running before login**.

Online enrollment logic is tested with controlled responses and the native sandboxed setup UI/DPAPI are exercised on Windows. A real owner's successful sign-in must still be acceptance-tested; no user password was available to this development session. Hardware certificate provisioning remains separate. Existing manual lab profiles without a cloud session do not gain automatic cloud authorization.

### Signed update staging

The administrator-only `/api/v1/updates/stage` accepts a signed manifest and signature only when a trusted Ed25519 public key and encrypted recovery backups have been configured. It enforces project/repository/platform identity, increasing version, expiry, database compatibility, exact size and SHA-256, and allowed GitHub release redirects. A verified encrypted checkpoint is required before the executable becomes staged. The manifest cannot supply its own trusted key.

This does **not install or run the EXE**. Publisher signing, automatic release polling, installation handoff and tested application rollback remain incomplete. No production update authority/key has been configured. The prototype installer itself remains unsigned.

## Cloud transport state

Migration `20261028064511_branch_hub_replication_v1.sql` was applied to **hvqlkapynjfjikqithvd only**, after isolated PostgreSQL 17 RLS/replay tests. It adds three Branch Hub tables and invoker-only functions. Existing sales, stock and canonical accounting tables/records are untouched. Follow-up migrations `20261028065450` and `20261028065739` index these new tables and cache the caller identity in their policies. Anonymous access and authenticated UPDATE/DELETE on replicated financial payloads are denied.

A newly enrolled desktop can refresh its encrypted cloud session and run automatic transport retries with bounded backoff. Rotated credentials must be durably saved by the desktop vault before any financial upload. Failure or internet loss leaves local checkout available.

- Local `offline_outbox` events upload idempotently with matching project, branch, event ID and payload hash. The cloud returns **received**, which is recorded separately in `cloud_sale_receipts`. Reception alone leaves financial outboxes pending. Only a matching committed canonical sale and journal proof can acknowledge them.
- Published price commands download into a durable inbox, update only newer revisions, preserve quantity and historical costs, and reject stale checkout prices. Unknown SKUs and conflicting revisions are retained as conflicts for review. Missing published cost is represented explicitly by zero.
- A cloud command is acknowledged only after its local inbox/outcome/audit commit. Delivery uses per-installation acknowledgements, avoiding cursor gaps from transactions that commit out of order. Backups preserve installation identity for idempotent replay after recovery.

The development branch adds a narrow canonical posting bridge in migration `20261028081704_branch_hub_canonical_posting_v1.sql` (applied only to `hvqlkapynjfjikqithvd` after isolated PostgreSQL 17 canonical posting/replay/rollback tests). It calls the existing `process_sale_idempotent` path for ready products, a single warehouse, base units and cash, with no taxes, discounts or modifiers. Product/warehouse/unit mapping is captured immutably at local checkout. The bridge verifies official sale items, stock effects, current catalog cost and a balanced posted journal in one transaction. A failed check rolls back every canonical side effect; retries reuse the same official sale. The local ACK and proof commit together and recovery rejects missing proofs.

Changed prices/costs, tax rules, stock shortages, unsupported payment methods and unmapped legacy sales remain visible conflicts; they are never silently rewritten or marked posted. Manufacturing, modifiers, returns, other payments and reconciliation of external stock changes remain incomplete. No production financial sample event was created during development. The PostgreSQL CI harness uses pinned snapshots of the existing canonical sale/stock/journal routines inside a disposable fixture schema; this is not a full production clone or production acceptance test.

## Verification

```sh
cd branch-hub
npm test
node packaged-smoke.cjs
```

The complete regression workflow runs on Windows and Linux. The browser workflow uses Chromium to exercise checkout with a lost ACK, reload, stable retry identity and mobile layout while denying external UI requests. Windows build CI installs the generated NSIS EXE into an isolated temporary directory and runs the installed application server. Physical printer/paper, real tablets and production cloud synchronization still require acceptance testing.

## Offline employee access (0.4)

The administrator creates a local account from **إدارة محلية → حساب موظف محلي**, with a unique lowercase username, name, viewer/cashier/stock role and password of at least 12 characters (maximum 128 UTF-8 bytes). A paired device then needs both its own credential and an employee login. Effective permissions are the intersection of the two roles; employee accounts cannot grant administrator privileges. Sales and print requests record `staff:<id>` as the audit actor, ignoring client-supplied actor fields.

Only salted scrypt hashes are stored for passwords, and only SHA-256 digests for random session tokens. Credentials and session tokens are never written to browser storage. Login attempts have persistent per-account and per-device budgets; a maximum of two password derivations run at once. Successful logout, role/password changes, staff disablement or device revocation invalidate sessions. Hub restart and restore require fresh employee login. Backups preserve employee accounts, required-login policy and rate-limit state; schema v5 validates these tables and the policy before restore. Staff accounts remain local to this hub, and do not impersonate individual Supabase users during canonical cloud posting. The cloud connection still uses the enrolled branch administrator's authorized session.

Windows packaging uses pinned electron-builder 26.9.0, including upstream NSIS fix [#9564](https://github.com/electron-userland/electron-builder/pull/9564) for the per-user assisted-installer System.dll race. The workflow builds and performs a fresh silent installation on three independent Windows runners. Each must pass native vault/setup and packaged/installed catalog, checkout, employee-login and backup smoke checks without retrying a failed installation. Successful artifacts include the EXE and its SHA-256; they remain unsigned development builds.
