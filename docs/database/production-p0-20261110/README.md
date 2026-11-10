# Premier production P0 verification — 2026-11-10

Status: read-only production verification passed for the inspected structure and privileges. Source/evidence synchronization only; migration-history reconciliation is NOT performed by this PR.

Project: `hvqlkapynjfjikqithvd`. Compared with `Premieros/.com` main commit `97d4b09e481b10b1620781f138efd4d1e9bbff20`.

## Exact migration correspondence

| Fix | Supabase recorded version | Existing canonical repository version | Recorded name |
| --- | --- | --- | --- |
| Stock valuation branch authorization | 20261110104453 | 20261109180000 | premier_stock_valuation_rpc_branch_auth_20261110 |
| Refund core atomic rollback | 20261110104523 | 20261109183000 | premier_refund_core_atomic_failure_20261110 |
| Stock count atomicity | 20261110104600 | 20261109140000 | premier_stock_count_atomic_failures_20261110 |

Each production history record contains one statement string. All three strings match the corresponding existing canonical SQL file byte for byte as UTF-8, including whitespace and final newline. The original strings are preserved under `migrations/`; complete current `pg_get_functiondef` output is preserved separately under `functions/`. No headers or terminators were added to those originals. SHA-256 hashes, paths, signatures, volatility, search paths and ACL metadata are in `manifest.json`.

These are captured SQL definitions, not executable deployment instructions. Do not pass this archive directory to a SQL runner.

## Read-only verification

Only metadata SELECT queries were executed against production. No refund, stock-count, inventory, financial, or other mutating RPC was invoked. No transaction-based write test was attempted on production.

- **Valuation:** current function body is exactly equal to the body in the canonical/recorded migration. Checks require `auth.uid()`, an explicit branch, `inventory.view`, branch access and warehouse/branch consistency. Result selection is branch scoped. Function is STABLE, SECURITY DEFINER, with `search_path=public, pg_temp`. Effective EXECUTE: anon false; authenticated true.
- **Refund core:** current definition contains three `v_failure := v_res` assignments and three controlled raises, plus the matching `P0001` handler (four abort-marker occurrences total). No `RETURN v_res;` remains. The mutation region is inside the nested BEGIN/EXCEPTION block, so exceptions roll back that block before returning saved failure JSON. `v_failure` is declared outside it. Internal core EXECUTE: anon false; authenticated false; service_role present in ACL. The migration dynamically patches an existing definition rather than containing a full replacement; this audit verifies the patch postconditions and archives the full live definition, but does not claim a complete independent fresh-replay comparison of the entire refund core.
- **Stock count:** current function body is exactly equal to the canonical/recorded replacement. Header and item rows use FOR UPDATE, with ordered item processing. Four controlled abort paths and raised helper-error paths are inside the exception-protected block containing inventory, movements, journals and count status writes. Existing raw unified movement and product non-FIFO helpers remain referenced. Effective EXECUTE: anon false; authenticated true.
- The server-side structure query returned true for all three functions. Definition MD5 values returned by PostgreSQL agree with the locally captured definitions; SHA-256 values are recorded in the manifest.

These checks establish current source and privilege configuration. They do not establish full runtime correctness for all users, concurrent calls or financial scenarios. No business-row contents were retrieved for this audit.

## Duplicate application and two migration ledgers

The three 20261110 versions exist in `supabase_migrations.schema_migrations`; the three 20261109 aliases were absent from that ledger in the targeted query.

The repository runner `scripts/db/apply-migration.js` uses a DIFFERENT ledger: `public.schema_migrations`, keyed by the full filename stem and SHA-256. Its targeted 20261109/20261110 query returned no rows. Therefore a Supabase-applied record does not cause that custom runner to skip the canonical file.

Do not replay these patches on current production: valuation expects the pre-fix `v_scope` baseline; refund expects three old RETURN exits and the old exception handler. Reapplication would fail those baseline guards. Stock-count replacement alone is not a reason to duplicate the three-patch sequence.

This PR preserves all existing executable migration files, names and checksums. It adds NO SQL to `supabase/migrations`, and does not rename immutable migrations or introduce a second executable copy. Archives live outside the directory read by the existing runner and Supabase CLI. Thus normal fresh replay still sees exactly one copy per fix.

Source synchronization does not resolve the existing version/ledger mismatch. Before a future production migration deployment, review the complete local/remote histories and choose an explicitly approved reconciliation plan accounting for BOTH ledgers and any other drift. Do not blindly use db push, --include-all, the custom runner, migration repair, or SQL ledger inserts. No such operation was run here. Remote ledger changes require new approval.

## CI evidence

Re-inspected existing GitHub job/step results on 2026-11-10:

| Earlier run | Fix | verify | disposable PostgreSQL db | browser-smoke |
| --- | --- | --- | --- | --- |
| [42637586086](https://github.com/Premieros/.com/actions/runs/42637586086) | valuation | success | success | success |
| [42639842105](https://github.com/Premieros/.com/actions/runs/42639842105) | refund | success | success | success |
| [42619291971](https://github.com/Premieros/.com/actions/runs/42619291971) | stock count | success | success | success |

DB steps include canonical migration replay and integration/security regressions. Existing tests cover branch/warehouse/permission denial, refund-helper failure rollback, second-line stock-count failure rollback, and successful count retry without duplicate movements. Those tests are restricted to disposable localhost PostgreSQL.

These are historical runs, not CI results for this PR. Current-head CI status will be recorded in the PR after creation. The existing Verify main pull_request workflow is available in source; the deployment workflow triggers on main push/manual dispatch, neither of which is performed here.

## Preservation and scope

No production changes, paid Supabase branch, deployment, merge or auto-merge. No credentials, API keys, personal records or raw operational logs are included. Function bodies contain schema identifiers and generic SQL text only.

Reference: [Supabase migration documentation](https://supabase.com/docs/guides/deployment/database-migrations).
