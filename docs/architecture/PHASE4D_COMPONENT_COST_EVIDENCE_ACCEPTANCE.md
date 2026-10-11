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
The supplemental migration `20261011080000_phase4d_component_cost_evidence.sql`:
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
