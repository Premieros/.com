# Concrete closeout proposal — approval not yet granted

The request to finish this file is being treated as completion work, not permission to close the draft PR while leaving known discrepancies. No production write, merge, deployment, paid branch or business RPC has been performed in this stage.

## All 150 files now have an individual disposition

`CLOSEOUT_DISPOSITION_150.json` preserves every canonical filename and checksum:

| Proposed disposition | Files | Evidence/decision |
| --- | ---: | --- |
| History proven | 140 | Original exact/equivalent evidence, preserved duplicate counterparts, contiguous batch coverage, 15 later full AST matches, plus eight newly resolved cases |
| Explicit historical-variant acceptance | 7 | Differences remain visible and require approval; preserve production rather than replaying old SQL |
| Actual runtime change needed before acknowledgement | 3 | Automatic day close, email login failure hardening, KDS execution privilege |
| **Total** | **150** | **All remain unacknowledged on production until approved execution** |

The eight additional proven cases are organization module controls; immutable cost snapshots; sale COGS events; orphan/stock COGS events; corrected zero-cost recipe snapshots; the historical nine-row cache repair; kitchen precision; and atomic production raw consumption/waste. Their original history counterparts are pinned in `CLOSEOUT_NEW_PROOFS.json`. No historical repair was rerun.

Function-body comparison tokenizes with pglast 7.22, dropping only whitespace and actual SQL comment tokens. It preserves token kinds and exact token text, including quoted strings, identifiers, constants, directives and operators. A multibyte literal fixture verifies scanner offsets. This extra comparison is distinct from full SQL AST equality. Original and new classifications are preserved rather than retrospectively relabelled.

The original duplicate-exact opening-balance preview is retained with **both** original history counterparts. One canonical acknowledgement can cite both; neither original record is selected for deletion or rewritten as the sole provenance.

## Seven differences requiring an explicit decision

1. Internal trigger EXECUTE boundaries: original GRANT/REVOKE grouping differs; all three live ACLs are postgres/service_role only.
2. Organization provisioning: the canonical historical email regex has two backslashes; production has one. Preserve the production variant and do not redeploy the old function. This is an accepted difference, not a claim of equivalence.
3. Fiscal posting metadata: production uses an inline-constraint/broader historical backfill variant and extra lifecycle view. Fresh incomplete period/posted_at/correlation_id count is **0**. Do not rerun financial backfills to make historical SQL identical.
4. Published-price helper: the original canonical file lacks a terminator. Keep its checksum and existing pinned CI-only correction; current body matches the corrected source, with equivalent built-in type spelling/default SECURITY INVOKER differences. Never submit the invalid original SQL.
5. Direct kitchen material guard: creation and grants have separate historical coverage; later migrations supersede the body. Preserve later production code.
6. Product cutover gate: production explicitly states default SECURITY INVOKER; live body matches, security_definer=false.
7. Unified stock view: view and grants match; COMMENT ON VIEW text differs. Preserve the production comment and record the exact difference.

These seven are intentionally labelled `explicit_historical_variant_acceptance_required`. A ledger checksum acknowledges the reviewed canonical file; it must not be represented as a claim that these seven source texts were executed byte-for-byte.

## Ready-to-review operation order

All SQL below is outside the executable migration directory and is never automatically deployed.

1. Verify GitHub repository `Premieros/.com`, this PR's current head, and production project `hvqlkapynjfjikqithvd`; refresh the read-only preflight. Preserve full ledger rows and function/ACL snapshots before writes.
2. **After approval of the 147-file set including all seven listed variants**, execute `scripts/db/candidates/history147_ACK_ONLY_NOT_A_MIGRATION.sql` as one request. Expected custom count **452 → 599**; Supabase history stays **727**. It checks the full original ledger/history fingerprints, all source names/statement hashes, all 28 live function pins/ACLs, schema/defaults/constraints/RLS, absence of ledger triggers/rules/inheritance, and conflicts before the first insert. It preserves existing rows and supports exact retries. No archived SQL is executed.
3. **After explicit schema/permission approval**, apply the exact bytes of `history-closeout-runtime_INSTALL_ONLY_NOT_A_MIGRATION.sql` as the migration named `premier_history_runtime_closeout`. The file is the transaction **body**, to be run through the project-scoped migration transport; do not add a COMMIT inside that transport. It installs the two absent day-close helpers, updates email/expired-lock handling, and revokes authenticated KDS sweeper execution while preserving service-role execution. Old definitions/ACLs are in `CLOSEOUT_RUNTIME_BEFORE.json`. Installation does **not** schedule a job or call business functions.
4. **Only with separate explicit authorization for recurring business writes**, apply the exact `history-closeout-runtime_SCHEDULER_REQUIRES_SEPARATE_APPROVAL.sql` as `premier_history_auto_close_activation`. It schedules `auto-business-day-close` each minute. Fresh production reads found **9 active fixed-time branches**, no matching current job, and both helper functions absent. Once activated, due daily-close snapshots/state changes can happen immediately, without another chat confirmation. No employee is impersonated; system closes use closed_by=NULL. This activation must never be inferred from approval of metadata or helper installation.
5. After verifying exact runtime history bytes, function bodies/security/search_path/privileges and the active named schedule, execute `history-closeout-final3_ACK_ONLY_NOT_A_MIGRATION.sql` as one request. It refuses to acknowledge the three if scheduling is inactive, any runtime evidence is missing, the previous 147 are incomplete, old ledgers drift, or functions differ. Expected custom count **599 → 602**; expected Supabase history **727 → 729** from the two newly approved runtime steps. No older history row is rewritten.
6. Verify all 602 canonical names/checksums, preserve before/after evidence, inspect scheduler history and actual error results, and rerun the repository checks. Do not fabricate sales, stock or accounting transactions for verification.
7. Merge/close PR #155 **only after separately explicit merge approval and successful post-execution verification**. A green preparation PR alone is not a production closeout.

If any preflight fails, stop and refresh evidence rather than relaxing a pin. If the migration transport records statements differently from the pinned single-string representation, the final-three guard intentionally refuses; inspect the exact stored bytes and test any adapter change before proceeding.

## Validation and precise limits

Preparation also found a report-cutoff dependency: `_build_day_closing_report` can extend an old day's window to now while a cashier shift remains open, even after persisted business-day state has rolled over. The proposed runtime installation includes a narrowly guarded correction requiring `v_window.active_state` before taking that live-window override. The report source/ACL snapshot is in `CLOSEOUT_REPORT_BEFORE.json`; the standalone correction is `history-closeout-report-cutoff_NOT_A_MIGRATION.sql`. The full-schema regression test checks the original overrun, then the corrected snapshot cutoff while leaving the shift open. This is part of the requested automatic-close runtime approval, not a production change performed during preparation.

The first combined candidate run passed all **44 isolated tests** (#42921604247). Its separate Verify run (#42921603931) stopped at a test TypeScript compatibility error (`replaceAll` under the configured library target); the test now uses the repository-compatible global regular expression. Final results for the corrected head must be verified separately.

- The previous 55-file candidate remains independently tested (16 cases) and unchanged.
- The 147-file SQL artifact is byte-compared against its builder. Database transport tests use synthetic, inert source metadata with all 147 canonical record identities: retries, partial state, conflicts, source/global drift, triggers, schema changes, missing live pins, and genuine failure on the 147th insert. These do not replay production business SQL.
- The **actual 147-source production preflight passed under BEGIN READ ONLY**, with acknowledgement INSERTs and writer locks removed. Both original fingerprints matched. No production records were written.
- Runtime tests install captured old definitions and exercise login username/email failures, lock expiry, KDS ACL changes, fixed-time eligibility, idempotent close creation and rollback on report failure. The final-three transport is tested against positive and deliberately incomplete runtime/scheduler states.
- Additional tests on the **full canonical disposable schema** use the real day-close report/normalization/state functions, preserve shift/order contents, verify repeat behavior and exercise actual user-security constraints. The minimal runtime fixture alone is not presented as proof of those real dependencies.
- Scheduler integration itself is not executed on production during preparation. SQL follows the repository's canonical cron statement and [Supabase's documented cron interface](https://supabase.com/docs/guides/cron/quickstart). An approved activation must be followed through to observed real scheduler results; a synthetic cron.job row in transport tests only verifies the acknowledgement guard.
- Final CI links and exact counts are recorded in the PR description after completion. Green tests demonstrate preparation; production closure still requires the explicit decisions above.

## Rollback boundary

Before activation, the runtime installation can be rolled back using the captured old login definitions/ACLs, restoring authenticated KDS access only if that rollback is explicitly approved, and removing newly installed helpers with dependency checks. After activation, stop the named cron job first; verify its name/command/database/owner before calling the documented unschedule operation. Preserve every daily-close snapshot/state transition already produced. Do not silently delete business records, financial evidence, historical migration rows or acknowledged files to simulate a rollback. Any business reversal is a separate reviewed operation.

`docs/CURRENT_WORK_PLAN.md` requires explicit approval before modifying database schema, functions or permissions. The user's original constraints additionally prohibit production writes, merge and business mutations without separate approval. This proposal makes those decisions concrete; it does not grant them.
