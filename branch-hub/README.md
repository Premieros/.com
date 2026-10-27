# PremierOS Branch Hub — development build

Repository: **Premieros/.com**, directory `branch-hub/`. The only authorized cloud project is **hvqlkapynjfjikqithvd**, `john's 1`, `eu-central-1`. No Johna's repository or database is used.

**This is a testable development application, not a production-complete offline ERP.** Do not route real branch transactions through it yet. Cloud accounting reconciliation, taxes, returns, split payments, central enrollment and signed updates remain release blockers.

## Implemented and tested

- Local SQLite checkout API and responsive Arabic UI at `/`, served without external assets. Integer base quantities and integer minor money units. Cash or bank posting in the kernel.
- Atomic sale, stock debit, cost/revenue journal, outbox and actor audit. Insufficient stock or any write failure rolls back all records. Historical line costs remain fixed. No FIFO. Opening cost is supplied by the administrator; a published-price cloud feed is not connected yet.
- Idempotent checkout, including concurrent devices and browser reload after losing the server response. The browser retains the pending checkout key until a confirmed response; credentials stay in memory.
- Administrator-issued per-device credentials, hash-only storage, viewer/cashier/stock roles and immediate revocation. The stock role currently has read access only. This is device authorization, **not individual staff login**.
- TLS-only LAN binding. Certificate verification is exercised in tests. Certificates must be provisioned and trusted separately on each phone/tablet; there is no automated certificate enrollment yet.
- ESC/POS TCP printer worker with a server-generated receipt and one job key per sale. Configured literal private IPv4 printers only. No shell commands. ASCII receipts only; Arabic raster printing, USB and Windows spooler drivers remain unsupported.
- Verified SQLite snapshots and fresh-directory restore, including accounting, pending events, branch identity, foreign keys and printer delivery history.
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

Scheduled retention, encrypted off-machine backup and full disaster-recovery operation remain incomplete. Keep backup copies protected separately.

## Windows desktop

`desktop.cjs` starts the local server and waits for its readiness message before opening the local UI. It reports child-process failure and prevents a second desktop instance. Packaging includes all runtime modules and UI assets; no test key or device configuration is shipped.

For isolated testing only, create `branch-config.json` under Electron userData with `organizationId`, `branchId` and `token`. Optional `host`, `port`, `tlsKey`, `tlsCert`, `localHostname` and `printers` configure the same listener. There is no first-run enrollment wizard or protected credential vault yet. A fresh installation intentionally refuses to assume a branch.

The prototype installer is unsigned. Automatic update/download/install and rollback are not implemented. A trusted publisher identity and release-signing setup are still required before safe automatic rollout.

## Cloud state

Both local outboxes are durable and read-only through staging APIs. No cloud dispatch or acknowledgement is enabled. No financial events are deleted or marked acknowledged just because internet access returns.

The target project's branch/organization RLS and branch foreign key were inspected read-only. There is no Branch Hub-specific ingestion/inbox endpoint installed. Existing `reconcile_offline_sale` is not a complete protocol for this kernel's SKU, journal and event model. Mapping local identifiers and posting exactly once into the canonical cloud accounting must be implemented and integration-tested before activation. No Supabase schema or production records were changed by this work.

## Verification

```sh
cd branch-hub
npm test
node packaged-smoke.cjs
```

The complete regression workflow runs on Windows and Linux. The browser workflow uses Chromium to exercise checkout with a lost ACK, reload, stable retry identity and mobile layout while denying external UI requests. Windows build CI installs the generated NSIS EXE into an isolated temporary directory and runs the installed application server. Physical printer/paper, real tablets and production cloud synchronization still require acceptance testing.
