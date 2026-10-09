# Phase 1B — RLS Policy Consolidation

> Architecture V2 / API & Security Consolidation

## Scope

Phase 1B removes or consolidates **behavior-equivalent** permissive policies where the previous effective behavior can be proven exactly.

No intentional authorization tightening or widening is included.

## Production migrations

- `20261008235837_phase1b_remove_redundant_kitchen_delete_policy`
- `20261008235940_phase1b_consolidate_kitchen_write_policies`
- `20261009000022_phase1b_consolidate_remaining_permissive_policies`

## Changes

### order_kitchen_sends DELETE

Removed:

- `auth_delete_order_kitchen_sends` with `USING (false)`

This policy could never grant a row. The effective delete policy remains:

- `auth_write_order_kitchen_sends_del`

Behavior is unchanged.

### order_kitchen_sends INSERT / UPDATE

Two INSERT policies and two UPDATE policies were replaced with one policy per command.

The replacement preserves the previous permissive-policy OR semantics exactly:

```
accessible source order
OR POS admin
OR current branch + pos.send_kitchen
```

### subscription_plans SELECT

The previous policies were:

```
USING (true)
OR
USING (is_active = true)
```

Effective behavior was therefore `true`.

They were replaced by one `USING (true)` policy, preserving behavior.

This does **not** decide whether inactive plans should remain public in the future. Tightening that behavior requires a separate product/security decision.

### treasury_accounts SELECT

The branch-scoped and organization-scoped SELECT policies were merged into one policy using the exact previous OR logic.

### user_branch_access ALL

The two management policies were merged using the exact previous OR logic:

- platform admin / users.manage path
- POS admin / users.branches.manage path

## Baseline result

The explicit same-role / same-command duplicate groups measured by the P-A query changed:

```
6 -> 0
```

## Important Supabase Advisor distinction

Supabase's `multiple_permissive_policies` advisor can still report overlaps even when the exact P-A grouping is zero.

Why:

- a `FOR ALL` policy also applies to SELECT/INSERT/UPDATE/DELETE;
- `PUBLIC` policies overlap inherited roles such as `anon` and `authenticated`;
- separate admin/read policies can intentionally overlap for the same effective role.

Examples still requiring domain review include:

- inventory unit configuration tables;
- raw_materials;
- plan/subscription tables;
- procurement tables;
- waste categories;
- user_branch_access own-read vs manage-read.

These are **not** blindly removed in Phase 1B.

## Test guard

The integration baseline now requires:

- zero exact duplicate groups for identical `roles + command`;
- consolidated kitchen INSERT/UPDATE policy names present;
- redundant deny-only kitchen delete policy absent.

## Next

Phase 1C should review remaining Supabase Advisor overlaps by domain, starting with catalog/inventory policies where PUBLIC-vs-authenticated inheritance is currently broadest.
