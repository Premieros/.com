# P-A — RPC Surface Classification

> Baseline of the production public-schema function surface.
>
> Snapshot findings at review time:
>
> - ~448 functions in `public`
> - ~380 SECURITY DEFINER
> - ~261 SECURITY DEFINER functions executable by `authenticated`
> - 3 SECURITY DEFINER helpers still effectively executable by PUBLIC
> - `register_trial_tenant` intentionally executable by `anon` for public onboarding

## 1. Classification rules

### PUBLIC API

A browser/server client may call this function directly as a supported business contract.

Characteristics:

- business-intent name;
- validates authorization and scope;
- owns transaction boundary;
- idempotent where retry is possible;
- stable typed input/output contract.

Examples today:

`process_sale`, `process_purchase`, `create_order`, `update_order`,
`send_to_kitchen`, `process_refund`, `submit_stock_count`,
`apply_stock_count`, `approve_waste`, `create_production_order`,
`complete_production_order`, `create_warehouse_transfer`,
`post_manual_journal`, `create_supplier_payment`.

### READ API

Stable query/report RPC available to authenticated clients.

Examples:

`get_product_live_costs`, `get_product_operational_composition`,
`get_pos_product_availability`, `get_pos_cart_product_availability`,
`search_inventory_ledger`, reporting/summary RPCs.

### INTERNAL

Implementation helper; client must not call directly.

Signals:

- leading underscore;
- trigger helper;
- posting/FIFO/reconciliation internals;
- repair/backfill function;
- helper accepts low-level quantities/references instead of business command.

Examples:

`_process_sale_core`, `_post_journal_entry`,
`_raw_add`, `_raw_remove_fifo`, `_product_inv_add`,
`_inventory_unit_recipe_cost`, `_product_recipe_cost`,
`_fifo_*`, `_restore_*`, `_settle_*`, trigger functions.

### LEGACY

Compatibility contract with a newer canonical replacement. Retain until caller proof is zero.

Known examples include historical raw inventory bridges and older kitchen/inventory paths documented in `INVENTORY_CONTRACTS.md`.

### ADMIN / PLATFORM API

Supported RPC, but owned by SaaS platform/admin rather than restaurant ERP:

`activate_subscription`, `subscription_*`, `super_admin_*`,
`support_*`, organization/feature-management functions.

### REVIEW

No migration until ownership/callers are proven.

## 2. Immediate security baseline

The following SECURITY DEFINER helper functions were observed with PUBLIC/anon execute capability and are **not considered desired long-term public business APIs**:

- `_raw_inventory_actual_avg_cost_guard()`
- `_raw_price_oversold_batch_from_fifo()`
- `treasury_accounts_fill_model_defaults()`

P-A does not revoke them because P-A is zero-behavior-change. Phase 1 must prove trigger/caller semantics, then revoke direct execution or relocate behind a private boundary.

`register_trial_tenant(...)` is the intentional anonymous onboarding API and must retain explicit abuse/rate-limit/authentication review.

## 3. Authenticated helpers requiring review

A leading underscore should normally mean INTERNAL. Several underscore helpers are still executable by authenticated clients in the current database, including examples such as:

- `_deduct_sale_inventory_with_modifiers_core`
- `_effective_branch_tax`
- `_normalize_raw_purchase_uom`
- `_normalize_thermal_print_payload`
- `_product_inv_add`
- `_product_inv_move`
- `_product_inv_remove_fifo`
- `_treasury_guard`

These are not automatically vulnerabilities: authorization, RLS and caller constraints still matter. They are architectural exposure that Phase 1 should remove where direct client execution is unnecessary.

## 4. Target schema boundary

Target shape:

```
public (or exposed api schema)
  business commands
  approved read APIs

private
  fifo
  posting
  costing helpers
  authorization helpers
  repair helpers
  trigger helpers
```

## 5. Migration sequence for each function

```
classify
-> prove callers
-> add private implementation
-> keep compatibility wrapper if needed
-> switch callers
-> revoke unnecessary grants
-> observe
-> remove legacy wrapper later
```

## 6. Contract requirements for PUBLIC API

Every mutation RPC must document:

- permission;
- organization/branch scope;
- warehouse scope where inventory changes;
- idempotency strategy;
- transaction boundary;
- accounting effects;
- inventory effects;
- audit/correlation behavior;
- reversal behavior;
- error contract.

## 7. CI guardrail

P-A adds integration tests that:

- require RLS on every public base table;
- require exposed public views to be security-invoker;
- fail on unbalanced journals;
- fail on null core branch/warehouse scope in posted operational data;
- lock the known PUBLIC/anon SECURITY DEFINER helper exceptions so the exposure cannot silently grow.

The helper allowlist is a temporary baseline and should shrink in Phase 1.
