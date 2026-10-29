# Windows Branch Server implementation checkpoint — 2026-10-29

Repository: `Premieros/.com`. Sole hosted project: `hvqlkapynjfjikqithvd` (`https://hvqlkapynjfjikqithvd.supabase.co`). Target branch: `development/premier-windows-branch-server-plan`.

**Status: implementation in progress; 0.7.0 is an unsigned development build, not a production-complete release.** The complete Windows Branch Server product contract remains the scope. The full ERP UI must eventually execute its approved business operations locally; the current separate cloud UI and limited local checkout do not satisfy that requirement.

## Source integration

This increment combines the verified development contract at `ab0900b342a4ddc16dd41052d18142d052b23106`, the WBS-00 discovery report, and the same-repository implementation snapshot `4191da9d2aa2c574927e1b0e87b4b4fda318eadf` from PR #127. No other project supplied source code or hosted data. Existing hosted schema and production data were not changed.

The older audit correctly described its audited development branch's 0.1 foundation. It does not describe the later feature snapshot's existing SQLite checkout, pairing, employee access, encryption, cloud transport, raster receipts and bundled React implementation. This checkpoint records the new combined baseline rather than marking those capabilities absent.

## Changes in this increment

- Windows/USB printing through a self-contained .NET 8 helper using the installed Windows spooler. Printer names are exact, validated installed destinations; no shell command contains a printer name or receipt. RAW ESC/POS jobs preserve attempted-versus-uncertain outcomes, return the Windows spool job ID, and never equate spooler submission with confirmed paper output.
- Administrator-only printer discovery and USB/Windows configuration in the local management interface. Discovery/configuration never sends an invoice. The operator must explicitly select a thermal printer; no automatically selected default printer is saved.
- Native Arabic raster rendering at 384, 512 and 576 dots without an interactive desktop renderer, plus DPAPI machine-protection primitives for the service configuration. The existing Electron raster renderer remains available.
- A Windows SCM host and independently owned server/asset lifecycle, LocalService account registration, automatic start and recovery settings, protected ProgramData configuration, graceful stop protocol and credential rotation persistence. **This is preparatory service infrastructure. Secure desktop-to-service state handoff, actual SCM installation/start/reboot/upgrade acceptance and desktop lifecycle integration are not complete. It is not automatically installed or activated by this build.**
- Clean npm installation repaired through the lockfile. The earlier missing optional-platform entries no longer prevent a clean install with the local npm 11 toolchain. The first GitHub run exposed an additional npm 10 lockfile validation difference (nested Vitest esbuild); the lockfile was regenerated with npm 10.9.7 and its clean-install validation rerun. Both toolchains must pass before CI acceptance. The source API contract, application typecheck, unit tests and build pass locally.
- Integration fixtures now publish a manufactured catalog cost of 4 for the existing unchanged COGS=8 assertion, matching the source's current published-cost policy. Return tests recognize the specific current shortage codes while retaining stock, return-line, successful-return, partial-removal rollback and journal assertions. No financial database routine or historical migration was edited.
- Windows build workflow builds and packages the native helper and defines an installed-helper smoke test. A workflow definition is not evidence that the new CI run has completed.

## Verification

| Verification | Recorded result |
|---|---|
| Canonical project management metadata | Exact ID/ref confirmed; `ACTIVE_HEALTHY` |
| Repository/database identity and reference checks | PASS |
| Generated API contract | PASS: 182 RPCs / 55 extracted relation names |
| Application and test TypeScript | PASS |
| Root unit/component suite | PASS: 144/144 |
| Root lint | PASS: zero errors, 39 pre-existing warnings |
| Complete React production build and desktop browser bundle | PASS |
| Branch Hub Node suite | PASS: 76/76 |
| Canonical migration replay | PASS: 575 migrations in a new isolated local PostgreSQL 18 cluster, with the source's two hash-pinned empty-CI compatibility fixtures; no hosted migration |
| Root PostgreSQL integration suite | PASS: 88/88, including the complete operating cycle, RLS, receipt rollback and returns |
| Chromium local UI with external requests denied | PASS: employee login, printer configuration, lost sale reply, reload/retry, one sale/outbox/stock debit and mobile layout |
| Bundled real React UI | PASS: login renders, no Node/preload/hub credential bridge, no desktop service worker |
| Native Windows helper | PASS: DPAPI roundtrip, 18 installed printers discovered, Arabic raster at three widths; **no physical print sent** |
| Packaged Electron runtime | PASS: local health/assets, catalog import, SQLite sale/idempotency, employee access and backup/recovery in fresh synthetic data |
| Final packaged Arabic raster and print queue | PASS: three widths; concurrent submissions/retry yield one receipt at a private loopback TCP emulator, with external requests denied; no physical print |
| GitHub pull request | Draft [#129](https://github.com/Premieros/.com/pull/129); initial npm 10 clean-install failures under repair, CI acceptance pending |
| Publisher signature | NotSigned, as requested for this test build |
| Physical printer/paper, two real branch hosts and devices, SCM restart/reboot, automatic installer update rollback | NOT TESTED / remaining acceptance work |

Lab PostgreSQL used only `127.0.0.1:55893` in a task-owned cluster. Existing PostgreSQL services were not changed. This proves source compatibility and fixture behavior on PostgreSQL 18; it is not proof of a complete deployed cloud clone, complete local-auth parity, or production cutover. The cloud remains PostgreSQL 17. No production test sale, receipt or adjusting journal was created.

The build was tested as an unpacked application in a separate task directory. The existing installed `0.4.1` application was detected and was not replaced. Test scripts used fresh fake profiles/databases and no production credentials. The new installer has not been installed over that profile in this session.

## Build reproduction

Run normal project and `branch-hub` locked installs. On Windows, build the actual React assets and native helper before packaging:

```text
node branch-hub/build-browser-app.cjs
cd branch-hub
npm run build:native
npm run build:win -- --publish never
```

This machine's unsigned test variant used `CSC_IDENTITY_AUTO_DISCOVERY=false`, `--config.win.signAndEditExecutable=false` and `--config.electronDist=<the already verified Electron 38.1.0 dist>`. Resource editing/signing utilities otherwise failed to extract macOS symbolic links without the required Windows privilege. No OS developer-mode, symbolic-link privilege, signing certificate or machine security policy was changed. The test variant retains default Electron executable resources/icon; its NSIS installer is still identified as PremierOS Branch Hub 0.7.0. `--publish never` prevented release publication.

Native smoke verification never invokes the helper's `print` command. A Windows spooler ACK carries `paperConfirmed:false`. Uncertain attempted output remains blocked for operator inspection and cannot be blindly retried.

## Remaining product gates

| WBS area | Actual state / next required work |
|---|---|
| 00 dependency discovery | Evidence and healthy source verification available; owner acceptance still required |
| 01 ownership/conflicts | Existing narrow event/price contracts available; complete domain ownership/identity and central/local edit contracts remain open |
| 02 complete local persistence | PostgreSQL source replay/integration evidence available; native PostgreSQL is the candidate for retaining the complete SQL domain. SQLite is proven only for the existing restricted kernel/queues. Full runtime selection, distribution and parity acceptance are not complete |
| 10/12 enrollment/LAN | Existing cloud enrollment/device/staff/TLS tests pass; real owner enrollment, certificate provisioning and revocation acceptance remain |
| 11 installer/service | Unsigned NSIS and native service infrastructure built; secure state handoff, real service lifecycle, upgrade/uninstall data choices and recovery are unfinished |
| 20/21/22 actual local ERP | Real React assets are bundled, but their cloud operations still require cloud authentication/connectivity. The narrow SQLite checkout is not a full local API adapter, manufacturing/procurement/accounting engine or shared full-ERP LAN backend |
| 30/31 printing | Windows/USB and TCP queue transports implemented/tested within their supported receipt model; physical printer acceptance, complete kitchen routing and broader transaction formatting remain |
| 40–43 sync/reconciliation | Existing ready-product/base-unit/cash canonical bridge remains bounded. Full fiscal/manufactured/multiwarehouse/payment/return and cross-domain replay/reconciliation are not complete. Received transport events are never treated as canonical financial posting without proof |
| 50 updates | Signed staging and recovery checkpoint exist; automatic approved installation/health/rollback remains unfinished |
| 51 backup | SQLite encrypted backup and guarded restore are tested; a full future local PostgreSQL domain requires its own coordinated recovery acceptance |
| 52/53 release/pilot | BLOCKED until the full local flow and real environment acceptance pass. No production cutover is approved by this report |

## Impact and rollback

No hosted DDL, RLS change, production write, main merge or deployment was performed. Changes are application/test/build/documentation files; historical migration Git contents remain unchanged. Revert the implementation PR to restore source behavior. Preserve all branch data directories, encrypted archives, recovery keys and unacknowledged events when testing or reverting an application. This development build must not be described as all phases complete or ready for real branch transactions.
