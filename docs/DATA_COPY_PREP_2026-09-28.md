# DATA COPY PREPARATION — ACTIVE WORK LOG

Repository: `Premieros/.com`
Branch: `development/data-copy-prep-20260928`
Current PR: `#7`
Production Supabase: `hvqlkapynjfjikqithvd`
Source Supabase (READ ONLY): `azzdesuowpdcoflmyezn`
Last updated: 2026-09-29 Africa/Cairo

## Work status

State: **BLOCKED**

Block reason: merge is approved by the user but remains blocked until the PR verification workflow is Green.

Data copy itself is complete through **2026-09-28 23:59:59 Africa/Cairo**. The authoritative cutoff is strictly before `2026-09-29 00:00:00 Africa/Cairo` (`2026-09-28 21:00:00+00`).

## Guardrails

- Source `azzdesuowpdcoflmyezn` is READ ONLY.
- No writes to `Premieros/johna-s`.
- No direct writes to `main`.
- Do not replace the destination schema.
- Do not weaken RLS, permissions, or organization/branch isolation.
- USER triggers may only be disabled inside controlled copy migrations and must be immediately re-enabled.
- Do not copy rows after the approved cutoff.
- Do not merge until CI is Green.

## Baseline

Final validated destination through cutoff:
- sales: 1,244; total: 1,058,504.32
- purchases: 175; total: 344,315.36
- expenses: 94,931.29
- customer payments: 289,649.00
- supplier payments: 26,565.00
- treasury transactions: 705,781.25
- inventory_ledger: 21,728 rows
- raw_material_batches: 11,031 rows
- raw_fifo_debts: 8,694 rows
- raw_fifo_settlements: 3,093 rows
- order_kitchen_voids: 333 rows
- sale_print_events: 541 rows
- shift_operations: 1,471 rows

## Root-cause ledger

- Post-cutoff rows appeared during live-source delta work because UTC 2026-09-28 timestamps can belong to 2026-09-29 in Cairo.
- One post-cutoff Order Item at 00:30 Cairo remained after reconciliation and was removed after dependency verification.
- Large hash differences in Orders/Sales are expected where source rows were updated after cutoff or destination table IDs were intentionally remapped.
- 13 pre-cutoff Order Items had stale quantities/order linkage in destination; Kitchen Send history proved the correct pre-cutoff state.
- inventory ledger cost differences were limited to FIFO repricing fields.
- four raw-material batch quantity differences were exactly explained by post-cutoff consumption and therefore were not copied.

## Change ledger

- Copied missing kitchen inventory events/effects through cutoff.
- Copied sale item inventory effects through cutoff.
- Reconciled inventory ledger and raw material batch IDs through cutoff.
- Copied required FIFO runtime state: parent backfill runs, debts, settlements, rebase snapshots, and rebase settlement snapshots.
- Copied historical kitchen voids, sale print events, and missing shift operations.
- Corrected 13 pre-cutoff Order Items and corresponding Kitchen Sends using source pre-cutoff send history.
- Removed all identified post-cutoff rows introduced during live delta work.
- Preserved destination organization-aware bootstrap/schema and mapped table IDs where source/destination protected table UUIDs differ.

## Verification ledger

- Source remained READ ONLY.
- No writes were made to `Premieros/johna-s`.
- No post-cutoff operational rows remain in checked Orders / Items / Kitchen / Sales / Ledger / Batches / FIFO paths.
- Checked FK orphan counts are zero.
- RLS remains enabled on checked operational and FIFO tables.
- No USER trigger remains disabled.
- Financial aggregates match source through cutoff.
- `sale_item_inventory_effects` and `order_kitchen_inventory_effects` match source IDs through cutoff.
- `inventory_ledger` and `raw_material_batches` match row identity through cutoff.
- FIFO debts and settlements match the cutoff state.

## Production gate

- Data copy: complete.
- Final database validation: complete.
- User merge approval: received.
- GitHub PR: #7.
- Merge remains blocked until CI is Green.
- No additional Production migration is authorized by this merge step.

## Next action

1. Make PR #7 Ready for Review.
2. Re-run/trigger verification on the corrected documentation commit.
3. If CI is Green, merge PR #7 using expected HEAD protection.
4. Verify PR merged and `main` contains the merge commit.

## Mandatory update protocol

- Before every repository write, verify branch and HEAD.
- Any unexpected HEAD = STOP_AND_RECONCILE.
- Keep this log as the mandatory source of truth.
- Record any new blocker before changing Production state.
