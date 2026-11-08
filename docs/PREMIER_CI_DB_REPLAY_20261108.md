# Premier CI database replay repair — 2026-11-08

**Status:** Isolated CI-only repair. Not a database migration; no production database changes or remote writes.

## Incident

After merging Premier POS PR #136 and navigation PR #137, the full \`Verify main\` workflow could not create its disposable PostgreSQL schema. The baseline migration \`20261023150600_raw_published_price_asof_helper.sql\` contains an unterminated SQL statement: it ends a dollar-quoted function body with \`$function$\` rather than \`$function$;\` before its \`REVOKE\` statement. PostgreSQL emits \`syntax error at or near "REVOKE"\` during fresh CI database replay.

Editing that committed historical migration directly would change its migration checksum, violating Premier's immutable migration ledger and potentially breaking real databases that already recorded it.

## Fix

- **Only** when \`scripts/db/apply-migration.js\` receives explicit \`--ci-replay\`, with \`CI=true\` and a connection URL whose hostname is \`localhost\`, \`127.0.0.1\`, or \`[::1]\`, apply an in-memory replacement of the precise missing function terminator to the **one** known file.
- \`scripts/db/ci-migration-compat.js\` verifies the canonical historical Git blob SHA-1 \`81de1ccf1708df17331b34114e00288b384d4560\` and uniqueness of the target anchor. Any drift aborts instead of guessing or modifying SQL automatically.
- The original migration **SHA-256** is still used in \`schema_migrations\` history; the source file and all other migrations are unchanged. All non-CI invocations continue to execute original SQL without transformation.
- The disposable database job in \`.github/workflows/verify-main.yml\` uses the pinned replay mode and executes \`node --test scripts/db/ci-migration-compat.test.mjs\` first.

## Acceptance

Run CI on the PR exact HEAD and inspect all subsequent migrations, integration/RLS tests, browser smoke, and frontend verification; a corrected historical terminator does not prove later migration scripts or business tests pass. Do not deploy, backfill, write to live schema, or silently bypass failing tests.

## Next remediation

The central financial server guard for unfinished kitchen sends remains an **unapplied** candidate under \`scripts/db/candidates/\` in main. UI-side POS improvements were merged but do not replace server-side transaction-locked safety checks. Johna's remains read-only.
