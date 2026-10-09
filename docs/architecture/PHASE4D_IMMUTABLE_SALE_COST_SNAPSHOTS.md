# Phase 4D — Immutable Sale Cost Snapshots

## Purpose

Make future Actual-vs-Theoretical cost variance historically exact without rewriting historical sales or changing FIFO/accounting writers.

Phase 4D captures theoretical and Standard Cost at the moment each new sale item is inserted.

## Production migration

`20261009134308_phase4d_immutable_sale_cost_snapshots`

## Canonical snapshot storage

The single source of truth is:

`private.sale_item_cost_snapshots`

A snapshot row stores:

- sale item / sale / branch / product
- sold quantity
- theoretical unit and total cost
- Standard unit and total cost when configured
- theoretical status
- recipe id/version
- selected modifier option ids
- modifier theoretical cost delta
- modifier effect count
- missing modifier cost count
- costing model version
- calculation basis payload
- capture timestamp

No theoretical snapshot columns remain on `public.sale_items`.

This avoids two competing sources of truth.

## Capture timing

Trigger:

`trg_capture_sale_item_cost_snapshot`

runs:

`AFTER INSERT ON public.sale_items`

and calls:

`private.capture_sale_item_cost_snapshot_trigger()`

The trigger is private, SECURITY DEFINER, has an explicit search path, and is not executable by anon/authenticated roles.

## Snapshot calculation

`private.compute_sale_item_cost_snapshot(...)`

resolves:

1. canonical item mapping;
2. current theoretical product cost;
3. active recipe id/version;
4. selected modifier inventory effects;
5. raw-material or semi-finished modifier target costs;
6. effective Standard Cost at capture time.

The stored snapshot therefore preserves the cost inputs used at the time the sale item was created.

## Modifier handling

Selected modifier option ids are persisted in the snapshot.

Modifier inventory effects contribute:

```
modifier theoretical delta =
sum(quantity_delta * target_unit_cost)
```

Snapshot theoretical unit cost:

```
base theoretical cost + modifier theoretical delta
```

when every required modifier cost input is available.

If a required modifier target cost is unavailable, the snapshot is marked:

`MISSING_INPUT`

rather than inventing a value.

## Standard Cost

If an effective-dated Standard Cost exists at capture time, it is stored in the same immutable snapshot.

Historical Standard variance therefore does not depend on future changes to the Standard Cost table.

## Failure isolation

Snapshot capture must not break sale posting.

Any capture error is written to:

`private.sale_item_cost_snapshot_failures`

The sale item itself is allowed to continue.

Health reporting distinguishes:

- snapshotted rows;
- AVAILABLE theoretical snapshots;
- MISSING_INPUT snapshots;
- capture failures;
- missing snapshot without a recorded failure.

Silent missing snapshots are treated as an invariant failure.

## Snapshot health

Private view:

`private.sale_item_cost_snapshot_health`

Control table:

`private.costing_v2_control`

The control row stores the timestamp from which immutable sale snapshots are expected.

Historical sale items created before that timestamp are intentionally not backfilled with guessed values.

## Historical compatibility

Old sales keep the Phase 4C behavior:

`CURRENT_RECIPE_REFERENCE_NOT_HISTORICAL`

when current-reference theoretical cost is complete and the sale has no unmodeled modifiers.

No old sale is relabeled as an immutable historical snapshot.

## Sale variance V2

Private view:

`private.canonical_sale_cost_variance_v2`

Resolution rules:

### New snapshot-era sale items

Use only:

`private.sale_item_cost_snapshots`

If the expected snapshot is absent, theoretical variance remains incomplete.

The view does not silently fall back to today's recipe for snapshot-era sales.

### Historical sale items

Before the snapshot start timestamp:

- current recipe/reference cost remains available as a clearly labeled non-historical comparison;
- legacy modifier-bearing rows remain `MODIFIER_UNMODELED` when no immutable snapshot exists.

### Theoretical basis values

- `IMMUTABLE_SALE_SNAPSHOT_V1`
- `CURRENT_RECIPE_REFERENCE_NOT_HISTORICAL`
- `MIXED_SNAPSHOT_AND_CURRENT_REFERENCE`
- `INCOMPLETE`

## Read APIs

Permission-checked RPCs:

- `get_sale_cost_variance_v2`
- `get_purchase_cost_variance_v2`
- `get_costing_snapshot_health_v2`

All require:

- authenticated user;
- branch access;
- `reports.costing` permission.

Pagination limits are enforced on the variance RPCs.

Anonymous execution is revoked.

## Storage security

The private snapshot/control/failure tables:

- live in the private schema;
- have RLS enabled as defense in depth;
- are not readable by anon/authenticated browser roles;
- are SELECT-only for service_role;
- cannot be INSERTed/UPDATEd/DELETEd by service_role.

Writes happen only through the private SECURITY DEFINER capture path.

## Production smoke test

A transactionally rolled-back test inserted:

1. one plain sale item;
2. one sale item with real modifier inventory effects.

Verified:

- plain theoretical snapshot status: AVAILABLE;
- plain theoretical unit cost: 59.19;
- modifier snapshot status: AVAILABLE;
- modifier inventory effects captured: 2;
- modifier theoretical delta: 23.10;
- selected modifier options preserved;
- updating refunded quantity did not alter the snapshot;
- residual test sale items: 0;
- residual snapshots: 0;
- residual failures: 0.

## Production baseline after migration

- duplicate theoretical columns on sale_items: 0;
- snapshot triggers on sale_items: 1;
- snapshot failures: 0;
- silent missing snapshots: 0;
- authenticated direct snapshot access: none;
- service_role snapshot writes: none;
- sale variance rows remain aligned with eligible sales.

At migration time there were no real sale items created after the snapshot control timestamp, so the permanent snapshot table remained empty until the next real sale.

## CI guard

Architecture V2 integration tests now require:

- no theoretical snapshot columns on sale_items;
- exactly one private snapshot trigger;
- trigger is SECURITY DEFINER with explicit search_path;
- authenticated cannot read private snapshots;
- service_role cannot mutate private snapshots;
- zero silent missing snapshots;
- zero snapshot failures;
- V2 sale variance row count equals eligible sales;
- snapshot basis is only used when every net line is snapshotted;
- current-reference basis is only used for legacy rows;
- Actual-vs-Theoretical variance requires complete inputs;
- variance/health RPCs are unavailable to anon and available to authenticated users.

## Next step

Phase 4E should expose the variance model in reporting UI and add trend summaries:

- Actual Food Cost %
- Theoretical Food Cost %
- Actual vs Theoretical variance
- Purchase price variance
- Standard Cost variance when Standard Cost is configured

The reporting layer should preserve basis/status fields instead of hiding incomplete data.
