# Post-Phase 8C ERP cross-domain integrity checkpoint — 2026-10-12

## Canonical scope and safety

- GitHub repository: `Premieros/.com`, post-merge `main` commit `6214f9f6db138f70f1574ecebaae2bca3b7fc84b`.
- Only database reviewed: Supabase project `hvqlkapynjfjikqithvd`.
- Inspection uses SELECT-only queries. **No production rows, RLS, triggers, constraints, schema objects, or historical journal/stock entries were altered by this audit.**
- Script: `scripts/audit/erp-cross-domain-readonly.sql` (20 findings rows: 16 BLOCK, 2 REVIEW, 2 INFO). Run under a DBA/operator context; it accesses `private` canonical diagnostic views. Never expose those views to the browser to run it.

## Verified repository release

- PR #89 (Phase 8C scheduled verified event worker + procurement receipt regressions) was squash-merged to `main` as `6214f9f6...`.
- Its exact PR head passed `verify`, `db`, and `browser-smoke` in GitHub Actions run `38144580154`.
- Post-merge `main` passed Verify main (`38248467076`) and GitHub Pages deployment (`38248467040`).
- Database already held migration `20261011133446`. The scheduled `erp-domain-outbox-v2` job was active with a one-minute cadence and recorded **1,362 successful, 0 failed** invocations at inspection. **No live domain events or processed event receipts were present:** a successful cron invocation does not prove live event delivery or autonomous AI behavior.

## Database integrity results

| Check | Observed result | Interpretation |
|---|---:|---|
| 16 cross-domain BLOCK checks in the new SQL script | 0 violations each | Branch/warehouse, item ownership, recipes, sale/purchase lines, account/period scope, posted journal balance, FIFO debt arithmetic, allowed-negative-stock policy, and canonical inventory reconciliation pass on the inspected snapshot. |
| Broader point-in-time ownership/scope checks performed during inspection | 28 with 0 violations | Supplemental checks covering ledger raw/product ownership, batches, orders and purchases. Not all are duplicated in the new script. |
| Posted journal headers / journal lines | 2,247 / 7,259 | Posted journals balanced; private immutable journal evidence also contained 7,259 rows. |
| Raw-material branch inventory rows | 525 | 147 negative rows; **all 147 were in branches whose effective policy explicitly allows negative stock**. |
| Raw FIFO debts | 8,718 total, 6,453 with outstanding quantities | Expected debt-backed negative-stock mechanism exists; settlement aggregate agrees with recorded debt settlement for all observed debts, and none were oversettled. These counts are **not** an authorization to erase or settle debt. |
| Raw batch sum vs raw material branch balance | 9 differing item-branch pairs | Diagnostic only: raw operational balance is authoritative, not historical batch sum. Total absolute delta was 96.9250 quantity units (do not treat mixed units as a money or stock valuation). |
| Classified review-only discrepancies | 8 cases | Six `HISTORICAL_OPENING_REBASE`, one `TRANSACTION_BASELINE_DRIFT`, one `UNTRACKED_NEGATIVE_STOCK_PATH`. All are existing manual-only cases, no automatic repair. |
| **Additional batch/operational mismatch outside review cases** | **1 pair, absolute delta 0.3000** | Requires source transaction/FIFO history classification; do not adjust batches or operational stock by hand. |
| Canonical inventory reconciliation | 537 balances, 0 statuses other than `MATCH` | Current canonical quantity reconciliation is green even when legacy batch history differs. |

The `0.3000` observation is a newly *detected review candidate*, not proof of an operational balance defect. It is outside the eight currently classified `private.canonical_inventory_review_cases`. Resolve its provenance before changing any diagnostic thresholds or policies. Raw batch quantities are allowed to diverge from branch operational summaries in legacy cases; see `docs/architecture/PHASE3B_CANONICAL_INVENTORY_BALANCE_PROJECTION.md` and `PHASE3D_INVENTORY_REVIEW_EVIDENCE.md`.

## Security review queue (no policy changes in this branch)

Supabase security advisors reported 272 WARN observations, notably 270 authenticated-callable SECURITY DEFINER function notices, one anonymous-callable function notice, and disabled leaked-password protection. There were also 34 INFO entries for RLS without policies, many in sealed `private` tables. These are *review candidates*, not 272 proven vulnerabilities. Check each function's grants, internal authorization and intended exposure before restricting it. All 141 inspected `public` base tables had RLS enabled.

References:
- [Supabase SECURITY DEFINER review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Supabase leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

## Next controlled steps

1. Investigate the single 0.3000 mismatch with ledger, batch and FIFO sources; produce evidence and classify it for human review. Never auto-correct history.
2. Add explicit warehouse/procurement/receipt end-to-end tests for production document variants, including idempotency and refunds, using isolated rollback fixtures.
3. Prove a **new committed** outbox event is consumed and acknowledged exactly once, under a separately approved test plan that cannot affect live purchases, stock or accounting. Cron success alone is insufficient.
4. Review offline/local-first state, negative-stock policies and POS synchronization against the server's authoritative commands. Preserve idempotency, tenant permissions and correct branch scoping.
5. Audit and prioritize exposed SECURITY DEFINER RPCs. Do not alter RLS or grants without explicit schema/security approval.
6. Finish organization-account posting/read cutover only after side-by-side reconciliation, test coverage, and a separately approved rollout/rollback plan. Provider-backed AI agents remain future work.

## Running the guard

Execute the SQL as an authorized operator through a read-only SQL connection or SQL editor:

```sh
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/audit/erp-cross-domain-readonly.sql
```

A `BLOCK` finding greater than zero is a candidate invariant violation requiring triage, not an instruction to mutate production. `REVIEW` findings are historical/provenance investigations and may remain open while canonical reconciliation stays green. `INFO` findings indicate configured business behavior.
