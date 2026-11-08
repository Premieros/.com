# Premier Windows — Signed UI Release Architecture (foundation only)

Status: **DRAFT / staging only; no update channel enabled**. Parent PRs: #133 Windows shell, #134 LAN pilot. This change must not be marketed as an auto-update product.

## Product requirement
Restaurants may operate indefinitely without an internet connection. When a connection is temporarily available, a *future* optional update channel can deliver corrected screens, styles, built JavaScript, and compatible UI-only business fixes without a new NSIS installer. Restaurant receipts, orders, stock, accounting, local SQLite, IndexedDB, device credentials, and backups are NEVER replaced by a UI bundle.

## Trusted roots and boundaries

- Existing desktop application still serves its own installed \`dist/\` at \`http://127.0.0.1:43187\`. The same-origin restriction is essential for existing IndexedDB; no LAN binding or remote JS evaluation.
- \`electron/uiReleaseStore.cjs\` implements **offline validation/staging only**. Feed it a locally available build directory, raw \`manifestText\`, signature and a **release public key pinned inside a reviewed/signed installer**. Nothing supplies that key or calls the staging API in production yet.
- The manifest format is JSON \`{"format":1,"releaseId":"...","files":[{"path":"index.html","sha256":"64 lowercase hex","size":123}]}\`; include every shipped app asset. Signature is Ed25519 over the **exact UTF-8 bytes** of the manifest, base64 encoded. Signing must occur in a protected release process after clean-room build and tests.
- Reject unsigned/tampered manifests, path traversal, case-colliding file names, unsupported file types, excessive package sizes, tampered content, symlinks and unlisted active overrides. Only signed, hash-matching files are copied to a new, versioned staging directory; files are not executed or selected on restart.
- GitHub is the source repository/build pipeline, **not** a remotely trusted origin for loading script files directly. A GitHub Actions build alone does not prove publisher authenticity. Never put private signing keys in source control.
- Do not enable a \`latest\` JSON HTTP downloader or live runtime UI swapping without pinning the signing key, selecting a trusted release host/channel, protecting against rollback/downgrade and replay, implementing HTTPS fetch bounds and safe staged activation, and a separately approved update policy.
- Electron/Node/Branch Hub native/financial engine changes remain signed-installer updates. UI bundles must not contain server code, migration SQL, scripts executed by Node, or database files.

## Release/activation gates still required
1. Choose an organization-held Ed25519 public key, pin it to the signed shell, protect the private key in a release signing service with approval, and implement a verified publish workflow.
2. Add a read-only update check and bounded download in desktop **main process** only; no renderer authority to choose release URL or install arbitrary bytes.
3. Add a versioned UI engine API/DB schema compatibility contract: newer screens must not call absent local APIs. Verify shell version, schema epoch, channel, and signed monotonic release sequence.
4. Install only after an explicit safe point: no open checkout, unresolved printer queue, pending offline outbox or partially posted financial operation; verify usable local database backup/recovery before any schema migration.
5. Implement verified start-up selection/atomic pointer switch, full content integrity recheck, crash-loop rollback to last signed UI, and retention/garbage collection that never deletes customer data. Be aware that serving different JS under the same IndexedDB origin can trigger migrations: coordinate DB version strategy and reject incompatible bundles.
6. Test in Windows CI and on *real* restaurant hardware, offline for extended periods, with LAN waiter/kitchen, a restored backup, corrupt downloads, power loss, and failed startup. CI green alone is not a release approval.

## Scope of this milestone
- New \`electron/uiReleaseStore.cjs\` provides \`validateManifest\`, \`verifyManifest\`, \`verifyFiles\`, \`stageUiRelease\`.
- \`electron/uiReleaseStore.test.cjs\` covers valid stage, wrong signature, changed manifest, tampered assets, symlink, case collision, path traversal, and missing index.
- The Windows build workflow runs these Node unit tests. No private keys, network access, feature toggles, live updates, migrations, deployments, or customer DB writes.
- Rollback: revert this branch's commits; existing installed \`dist/\` and release update policy remain unchanged.

**Important:** installing corrected screens alone does not fix a broken database, unavailable drive, or missing hardware. Local diagnostics, backups and controlled recovery remain necessary.
