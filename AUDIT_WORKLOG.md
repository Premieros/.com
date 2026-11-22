# PremierOS (.com) — Audit & Remediation Worklog

**Created:** 2026-11-22 (Africa/Cairo)  
**Repository:** `Premieros/.com` (`main`)  
**Database:** Supabase project `hvqlkapynjfjikqithvd`  
**Scope:** tracking and verification only. This document does **not** authorize production code, schema, RLS, or data changes.

## Status legend
- `TODO` pending review
- `INVESTIGATING` evidence being gathered
- `READY` fix and tests designed, awaiting approval when risky
- `DONE` verified with test evidence
- `BLOCKED` dependency or decision required

## Baseline (reported initial read-only inspection, 2026-11-22)
These are preliminary counts from an earlier inspection, **not proof of vulnerabilities**; reproduce queries and record evidence before taking action.

- 151 `public` tables, reportedly 151 with RLS enabled; 24 without RLS policies (could be intentional deny-by-default).
- 444 foreign-key relationships; four sampled reference integrity checks found no orphaned records.
- 300 SECURITY DEFINER functions executable by authenticated role; 5 executable by anonymous role (verify actual grants, schema exposure, and effective access).
- 188 unindexed foreign-key warnings; 82 overlapping RLS policy warnings; 19 row-by-row policy evaluation warnings; 127 unused-index warnings (usage counters and query plans must be checked before removal).
- Test scripts were identified but **not run** in that inspection. Runtime correctness, deployment health, and exhaustive security are **not yet verified**.

## Work items (priority order)

| ID | Priority | Status | Work item | Acceptance criteria |
| --- | --- | --- | --- | --- |
| SEC-01 | P0 | TODO | Audit 5 anonymous-executable SECURITY DEFINER functions | Enumerate signatures, EXECUTE grants, search_path, owner, exposure and internal authorization; remove unneeded exposure only after compatibility review |
| SEC-02 | P0 | TODO | Audit 300 authenticated-executable SECURITY DEFINER functions | Identify sensitive write paths and verify role, tenant, branch and resource ownership checks; no cross-branch escalation |
| SEC-03 | P0 | TODO | Test isolation of branches, companies, warehouses, customer orders and printers | Cross-tenant/branch attempts demonstrably denied, without disrupting normal branch functionality |
| DATA-01 | P0 | TODO | Validate inventory movements, purchases, sales, returns, transfers and accounting posting | Atomicity, idempotency, no duplicate stock deductions or journal entries, consistent balance checks |
| DATA-02 | P1 | TODO | Verify last-approved-price costing rule; identify remaining FIFO/average paths | Costing/reporting sources consistently use last approved price; zero supported when missing; no silent historical restatement |
| SEC-04 | P1 | TODO | Inspect 24 RLS-enabled tables with no policies and 82 overlap warnings | Intent documented; no accidental inaccessible business flow or permissive data leak |
| PERF-01 | P1 | TODO | Prioritize 188 FK index warnings by workload | `EXPLAIN (ANALYZE, BUFFERS)` on safe representative queries; add only justified indexes, using safe migration strategy |
| PERF-02 | P1 | TODO | Review 19 RLS performance warnings | Confirm auth evaluation and query plans; improve without weakening permissions |
| PERF-03 | P2 | TODO | Review 127 unused-index warnings | Check statistics reset/history, write cost and query needs; do not auto-drop indexes |
| APP-01 | P1 | TODO | Run repository verification/build/integration suites | Capture output for `npm run verify`, `npm run verify:full`, `npm run test:integration`; fix confirmed failures |
| APP-02 | P1 | TODO | Check POS/cart/table opening latency and stale items | Cart loads promptly, no duplicate/stale order items, correct resume behavior per order type |
| APP-03 | P1 | TODO | Verify kitchen dispatch, print agent, branch routing and permissions | No cross-branch prints; each order type follows its independent create/send authorization |
| DOC-01 | P2 | TODO | Reconcile `KNOWN_ISSUES.md` with current dependencies and findings | Outdated entries corrected with sources and dates |
| OPS-01 | P0 | TODO | Establish safe migration/test/rollback checklist before fixes | Independent tests, backup/restore path, production approval, and documented rollback for risky changes |

## Execution rules
1. Read-only diagnosis first; do not modify production data, database permissions, migrations, or deployments without explicit approval.
2. For each item record: affected code/functions/tables; reproduction steps; observed result; severity; proposal; test evidence; rollback; commit/PR link; final verification.
3. For security warnings, distinguish executable grant from exploitable access; preserve existing operational behavior.
4. Avoid paid Supabase branches or unnecessary schema migrations. Prefer isolated tests and existing data sources.
5. Update item status only when work is actually performed; do not mark an item `DONE` from a checklist alone.

## Activity log
| Date (Cairo) | Update | Evidence |
| --- | --- | --- |
| 2026-11-22 | Worklog created from preliminary audit summary; no remedial changes executed | Earlier inspection summary in conversation |

## Next starting point
SEC-01: inventory the five anonymous-executable SECURITY DEFINER functions, verify effective grants and misuse paths read-only, then define a minimal safe remediation (if needed).
