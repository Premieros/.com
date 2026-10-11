# Premier Architecture V2 — Phase 4D component-level acceptance hardening

## Decision
Do not change the roadmap, and do not mark Phase 4D complete solely because a migration landed. Phase 5 work that already exists in the repository is not a substitute for verifying this gate.

## Previously merged baseline
- Original migration: `20261009134308_phase4d_immutable_sale_cost_snapshots.sql`.
- Production snapshot truth: `private.sale_item_cost_snapshots` (not extra columns on `public.sale_items`).
- Trigger: `trg_capture_sale_item_cost_snapshot` AFTER INSERT.
- Sale theoretical/standard snapshot cost, effective-date context, selected modifier IDs, and the aggregate modifier delta already exist.
- Historical sales are not backfilled from today's recipe; historical current-reference comparisons carry a distinct basis.

## Identified acceptance gap
The prior `basis` JSON recorded total costs, recipe identifiers, modifier effect counts, and aggregated modifier delta, but **did not retain the priced cost contribution of every BOM line or selected modifier inventory effect**.

An immutable total is good enough for top-level historical variance but insufficient to audit the component-level calculation after later recipe or supplier price changes.

## Additive implementation
The supplemental migration `20261011080408_phase4d_component_cost_evidence.sql`:
- Does not alter canonical/legacy item relationships, sale prices, inventory posting, FIFO, accounting journals, or historical rows.
- Adds a *private* function to freeze component-level evidence.
- Adds a call inside the existing AFTER INSERT trigger function; does **not** create a second capture trigger or second snapshot table.
- Writes a `component_cost_evidence` JSON object into the existing immutable private `basis` payload.
- Retains one entry per direct active recipe raw-material line and linked inventory-unit cost contribution, including source ID, normalized quantity, unit cost, and extended cost.
- Retains one entry per selected modifier inventory effect, including option/effect IDs, target type/ID, quantity delta, target cost, and extended modifier cost.
- Computes reconciliation flags against the **existing** base theoretical unit cost and modifier delta; never substitutes a recalculated total for the existing sale snapshot.
- Explicitly counts zero/missing ingredient-cost inputs and identifies mismatch as `COST_MISMATCH` rather than silently passing an unreconciled breakdown.
- Handles non-manufactured products as `STORED_PRODUCT_REFERENCE`; these have a stored-product price reference rather than a manufactured BOM.
- Catches supplemental evidence errors inside the capture function so a failure of the new detail collection does not discard the original cost snapshot or reject the sale.

## Evidence status contract
- `RECONCILED`: manufactured BOM details and modifier effects reconcile to original snapshot totals, with no missing reference inputs.
- `MISSING_COMPONENT_REFERENCE_COST`: at least one charged recipe/group component was recorded with unavailable/non-positive reference cost.
- `MISSING_MODIFIER_REFERENCE_COST`: at least one modifier effect had unavailable/non-positive target cost.
- `COST_MISMATCH`: priced-line totals differ from the existing resolver totals (which remain authoritative).
- `STORED_PRODUCT_REFERENCE`: non-manufactured product uses a stored cost reference.
- `CAPTURE_ERROR`: the supplemental detail process failed; original immutable total snapshot is preserved.

The evidence is at **costing-line resolution**: direct recipe raw-material lines plus linked inventory units (each priced as a unit). A linked inventory unit's nested raw-material internals are not separately frozen in this increment; its resolved unit cost is frozen. Do not label this a fully exploded multi-level BOM history.

## Production validation gate
1. Run the read-only / CI contract checks.
2. Transactional smoke with a plain sale item and real modifier option, confirming the new JSON detail, reconciliation, and missing input status.
3. Verify snapshot remains unchanged after ordinary `refunded_quantity` updates.
4. Prove browser roles and service_role cannot mutate the private snapshot.
5. Roll back all smoke rows, verify zero residue, verify no increase in snapshot failure/health anomalies.
6. Record the exact production migration history version, review CI and PR before merging.
7. No speculative backfill for historical sales.

Do not call Phase 4D fully accepted before those deployment-time checks are met.

## Fail-closed refinement
Follow-up production migration: `20261011081037_phase4d_fail_closed_missing_component_cost.sql`.

For *new* snapshots where the component evidence is incomplete, its legacy component
calculation is retained only as `basis.theoretical_partial_unit_cost` and
`basis.theoretical_partial_total_cost`. The authoritative `theoretical_status`
is `MISSING_INPUT` and the completed theoretical unit/total fields are null.
This prevents an underpriced recipe being counted as a completed historical food-cost
variance. The original cost resolver, FIFO, checkout prices and posted COGS remain
unchanged. No legacy snapshots are reconstructed.

## Production execution — 2026-10-11
- Supabase project: `hvqlkapynjfjikqithvd` (`Premieros/.com` only).
- Applied migration history: `20261011080408_phase4d_component_cost_evidence`.
- Production resolver exists and is called by the original single AFTER INSERT sale-item capture trigger.
- Direct EXECUTE: anon, authenticated, and service_role denied.
- Transactional smoke inserted 2 temporary sale-items against a real existing sale, product and modifier:
  - plain theoretical unit cost = 140.00;
  - selected modifier theoretical unit delta = 93.21;
  - modified theoretical unit cost = 233.21;
  - 2 priced base recipe lines; 5 selected modifier effect lines;
  - detail-to-total reconciliation = true for both base and modifier;
  - one zero-price recipe component retained as `MISSING_COMPONENT_REFERENCE_COST`;
  - updating `refunded_quantity` left immutable snapshot unchanged;
  - service_role UPDATE on private snapshot denied;
  - intentional subtransaction rollback complete with zero residual sale-items, snapshots and capture failures.
- Existing canonical snapshot and failure counts remained zero.

## CI limitations
- `verify` job passed after syncing the existing frontend contract and replacing unsafe `any` casts in Costing V2 RPCs.
- The full `db` CI job fails on several legacy/test-environment baseline checks (empty operating datasets, CI-only SECURITY DEFINER fixture grants, and an unscoped synthetic organization/branch during the full operating cycle).
- The new migration compiled during the CI migration stage and the dedicated component-evidence integration tests passed; this does **not** imply all unrelated regression checks are green.
- Keep PR #81 as draft and keep the merge gate closed until these pre-existing CI failures are triaged or genuinely resolved; no baseline checks should be deleted or bypassed to force green.

## Post fail-closed production smoke
- Applied migration: `20261011081037_phase4d_fail_closed_missing_component_cost`.
- For both plain and modified sample sale items, missing recipe-cost input correctly makes `theoretical_status=MISSING_INPUT`, with completed theoretical cost null.
- Partial unit cost is frozen in the private JSON basis: 140.00 (plain) and 233.21 (modified).
- Full line-level evidence: 2 base recipe lines, 5 modifier effects; both subtotals reconcile.
- Private write denial and normal refunded quantity update verified again.
- Transaction rolled back with 0 residual sale rows, 0 snapshot rows, and 0 failures.
- New dedicated CI Phase 4D tests passed: 3/3 including independent synthetic BOM and real modifier effects inside a rollback transaction.
- The pre-existing full DB regression suite remains 8 failures in its P-A and full-operating-cycle fixtures; PR remains draft until that separate gate is resolved.

## CI status after fixture privilege hardening
GitHub Actions run 38124046679:
- verify job: PASS.
- dedicated Phase 4D integration: 3/3 PASS.
- full DB integration: 36 PASS / 8 FAIL (previously 35 PASS / 9 FAIL).
- the CI-only unexpected PUBLIC/anon SECURITY DEFINER execution finding is resolved.
- remaining failures are tracked in https://github.com/Premieros/.com/issues/82
- browser smoke skipped because DB job failed; PR remains a draft.
