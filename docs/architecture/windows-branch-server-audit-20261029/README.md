# WBS-00 audit evidence

Baseline: `ab0900b342a4ddc16dd41052d18142d052b23106`, `Premieros/.com`, sole hosted project `hvqlkapynjfjikqithvd`.

- `inventory-summary.json`: lexical inventory counts.
- `dynamic-call-review.json`: computed Supabase call sites reviewed in the discovery report.
- `hub-tests.log`: existing eight local foundation tests, all passing.
- `wan-probe.json`: real Chromium requests to an isolated synthetic hub while all non-loopback browser requests are aborted. No cloud credentials or production writes.
- `identity-probes.json`: configured identity succeeds; wrong project, repository and URL fail closed in isolated child processes. No database connection is made.
- `api-contract-check.log`: existing source contract check fails for three relations/views; it does not query a database.
- `typecheck.log`: TypeScript command unavailable after incomplete dependency installation.
- `npm10-ci.log`: incomplete npm 10 compatibility retry, not a successful install.
- `inventory.cjs`, `check-identities.cjs` and `probe-wan.cjs`: read-only source/identity checks and synthetic local probe. They are audit tools, not product implementation.

Run from an isolated repository root at the audited commit with Node >=22.13:

```powershell
node scripts/db/verify-database-identity.js
node scripts/db/verify-project-references.js
node scripts/db/gen-contract.js --check
node --test branch-hub/server.test.cjs
node docs/architecture/windows-branch-server-audit-20261029/inventory.cjs . work/wbs00-evidence
node docs/architecture/windows-branch-server-audit-20261029/check-identities.cjs . work/wbs00-evidence
```

The inventory writes the dependency appendix, direct-call CSV, route JSON, computed-call JSON, migration function-definition CSV and summary into the requested output directory. Its route table links assume the appendix is stored in `docs/architecture`; source line numbers refer to the baseline. It uses only built-in Node modules and reads local source, not Supabase.

The browser probe requires a working Playwright installation and Chromium. Once the ordinary project dependency installation is healthy:

```powershell
node docs/architecture/windows-branch-server-audit-20261029/probe-wan.cjs . work/wbs00-evidence
```

For this audit, Playwright/Chromium came from the desktop's bundled runtime because the application dependency install did not finish. `AUDIT_PLAYWRIGHT_MODULE` can explicitly select an installed Playwright module for this synthetic probe. Application source was not redirected to another project's runtime or database.

The probe launches a new loopback-only hub with synthetic `audit_org` / `audit_branch`, an ephemeral port and a new database directory beneath the evidence output. It never reuses an existing data directory. Non-loopback browser routes are aborted, including a canonical-host canary; other browser-independent operating-system networking is not globally disabled. The 404 root is the observed first broken UI boundary, not a successful offline ERP test. The screenshot is a local artifact; the JSON records the response evidence.

Toolchain observed: Node 24.21.0 and npm 11.19.0 on Windows. `npm ci --ignore-scripts --no-audit --no-fund` failed with EUSAGE and missing optional-platform lock entries. A compatibility retry with npm 10.9.4 produced peer warnings and was interrupted before successful completion. No lockfile/package changes were kept. No full lint/build/unit/integration/E2E pass is claimed.

Reverting the audit PR removes these files with no runtime or database rollback. Never run synthetic restoration, deletion, seed or migration commands against a real branch data directory or hosted project for this audit.
