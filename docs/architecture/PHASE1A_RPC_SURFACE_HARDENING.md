# Phase 1A — RPC Surface Hardening

> Architecture V2 / API & Security Consolidation
>
> Production migration: `20261008235622_phase1a_rpc_surface_hardening`

## Scope

Phase 1A removes direct Data API execution rights from low-level helpers while preserving supported business RPCs.

No table shape, business calculation, POS flow, accounting logic, or inventory logic was changed.

## Hardened trigger helpers

Direct `PUBLIC`, `anon`, and `authenticated` EXECUTE was revoked from:

- `_raw_inventory_actual_avg_cost_guard()`
- `_raw_price_oversold_batch_from_fifo()`
- `treasury_accounts_fill_model_defaults()`

All three remain attached to their database triggers. Trigger behavior is unaffected by removing client RPC execution rights.

## Hardened low-level helpers

Direct client EXECUTE was revoked from:

- `_deduct_sale_inventory_with_modifiers_core(...)`
- `_effective_branch_tax(uuid)`
- `_normalize_raw_purchase_uom(...)`
- `_normalize_thermal_print_payload(jsonb)`
- `_product_inv_add(...)`
- `_product_inv_move(...)`
- `_product_inv_remove_fifo(...)`
- `_treasury_guard(...)`

Server-side business functions continue to call them internally.

## Supported public business APIs preserved

Verified authenticated EXECUTE remains available on representative supported commands including:

- `process_sale`
- `process_purchase`
- `create_purchase_order`
- `receive_purchase_order`
- `approve_warehouse_transfer`
- `process_treasury_deposit`
- `process_treasury_withdrawal`

## Security advisor result

Before Phase 1A:

- anonymous SECURITY DEFINER warnings: 4
- authenticated SECURITY DEFINER warnings: 261

After Phase 1A:

- anonymous SECURITY DEFINER warnings: 1
- authenticated SECURITY DEFINER warnings: 257

The remaining anonymous SECURITY DEFINER function is `register_trial_tenant(...)`, intentionally exposed for public trial registration. It requires separate abuse/rate-limit review rather than blind revocation.

## CI guard

The Architecture V2 integration baseline now:

- permits only `register_trial_tenant` in the anonymous SECURITY DEFINER allowlist;
- verifies all Phase 1A internal helpers are unreachable by both `anon` and `authenticated`.

## Next Phase 1B

1. classify the remaining 257 authenticated SECURITY DEFINER functions by direct UI caller;
2. separate supported business APIs from helpers/read-only authorization functions;
3. revoke unnecessary direct execution in small domain batches;
4. consolidate duplicated RLS policies only after behavioral equivalence is proven.
