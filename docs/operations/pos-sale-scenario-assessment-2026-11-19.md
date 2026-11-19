# Premier OS — POS sale safety scenario assessment (19 Nov 2026)

**Scope:** Code, CI, and read-only database inspection. **No customer-production sales were generated.** A green workflow is evidence for its exact tested cases, not proof that every possible checkout outcome is safe. The existing production data cleanup is preserved.

## Scenario coverage and evidence

| Scenario | Automated evidence | Verdict / limitation |
|---|---|---|
| Standard completed cash sale, inventory decrement, COGS + journal | `tests/integration/full-operating-cycle.test.ts` | Exercised in disposable CI PostgreSQL |
| Receipt purchase → manufacture → sale and raw/finished stock | Same integration suite | Exercised in disposable CI |
| Cash/card, credit, taxable/non-taxable and subtotal/line/header discounts | `tests/unit/posSaleScenarioMatrix.test.ts`, `tests/unit/posFinancialSafetyHardening.test.ts` | Checkout arithmetic only; provider charge not verified |
| Mixed cash/card split, failed tender, payment rows, journal balancing, replay and key reuse | `tests/integration/pos-split-tender-idempotent-cycle.test.ts` | Scenario passed in disposable CI using candidate append-only fix; final commit rerun required |
| Offline same-operation replay, changed financial payload, owner/shift/warehouse separation | `tests/unit/offlineSaleIdempotency.test.ts`, `tests/unit/posSaleRetryFinancialMatrix.test.ts`, `tests/unit/offlineWarehouseConcurrentReplay213.test.ts` | Offline queue/projection only; full network outage not proven |
| No inventory, negative stock allowed vs disallowed; replenishment and financial posting | `tests/integration/full-operating-cycle.test.ts` | Exercised in disposable CI |
| Cross-organization branch isolation and incorrect branch transfer | `tests/integration/owner-tenant-isolation.test.ts`, `tests/unit/posStructuralActionSafety.test.ts` | Scenario coverage on disposable CI + unit tests |
| Refund inventory helper failure with rollback of counters/journals | `tests/integration/premier-refund-core-atomic-failure.test.ts` | Failure case verified |
| Shift cutoff and settlement of carried order | `tests/integration/premier-branch-cutoff-shift-handoff.test.ts` | CI only |
| Printer side effect must not roll back committed sale | `tests/unit/posFinancialSafetyHardening.test.ts` | Code contract; real printer hardware not tested |
| Stale settlement preview after switching order/branch | `tests/unit/posScopedSettlementPreview.test.tsx` | Unit test |
| Manual approval-only transfers | `tests/unit/posFinancialSafetyHardening.test.ts` and payment service checks | Offline capture guards; full approval/expiry/provider test not shown |
| Cancel/void, partial transfer, table merge, kitchen sent/unsent quantities | Structural/unsent tests in `tests/unit` and integration tests | Coverage is fragmented; complete kitchen-to-payment journey not established |
| Payment service loss after authorization, simultaneous on-line terminals, real device restart, chargebacks, real provider callbacks | No signed end-to-end acceptance in this audit | **NOT VERIFIED** |
| Happy-path split-tender full refund, restoration of stock and balanced append-only journal | `tests/integration/pos-split-tender-idempotent-cycle.test.ts` | Scenario passed on candidate in disposable CI; final commit rerun required |
| Partial refund, multiple consecutive refunds, refunds at payment-provider boundary | Not covered by this regression | **NOT VERIFIED** |
| Fiscal receipt/tax compliance for contracted region, printer/KDS, physical cash shift close | No real devices/provider acceptance in this audit | **NOT VERIFIED** |

## Confirmed accounting defect and correction candidate

The baseline disposable CI (149/150 integration cases passed) revealed that `process_sale_split` returned `TRANSACTION_FAILED` because it attempted to DELETE already-protected `journal_entry_lines`, linked to immutable `organization_journal_line_evidence_v2`. `process_refund` on split tenders reused the same mutating strategy. This is **a genuine software defect, not bad customer input**. PR [#270](https://github.com/Premieros/.com/pull/270) adds a versioned SQL migration replacing these deletions with append-only, balanced collection reclassification journals. The split sale + full refund regression passed in a disposable CI run with the candidate; the legacy mutation-classification test required updating to correctly expect zero remaining direct finalization mutators. Production still requires a separately verified migration application.

## CI limitations

The GitHub `db` workflow replays migrations on a **disposable PostgreSQL service** and installs an isolated **ready-product batch COGS candidate** from `scripts/db/candidates/premier_ready_product_batch_cogs_NOT_FOR_PRODUCTION.sql`. Thus green CI proves the *CI migration/candidate composition*, not necessarily exact parity of production costing. Verify canonical production-function parity before making a universal costing guarantee. Do not deploy candidate SQL solely to make test outcomes match.

## Release policy

1. **Software verdict** is based on code, build, contracts, database integration and actual security behavior. Historical mistakes in customer-entered records do not count as defects by themselves.
2. Fail an individual scenario when the relevant test fails or is absent; do not convert "not tested" into "passed" or automatically label the entire program broken.
3. Customer data, business onboarding, physical stock counts and actual on-site peripheral support have independent acceptance tracks.
4. Any proposed fixes must first pass a disposable test, then be reviewed and deployed through GitHub. Do not create production sales to collect test evidence.
5. This document is a **scenario assessment**, not a statement that all conceivable payment or stock flows have been certified.
