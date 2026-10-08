# P-A — Canonical Write-Path Baseline

> Goal: document which layer is allowed to own business mutations before V2 migration.

## 1. Golden rule

For multi-table financial/inventory changes:

```
UI
 -> application/service
 -> canonical RPC business command
 -> transaction
 -> inventory/accounting/audit effects
```

Never:

```
UI
 -> table A insert
 -> table B update
 -> table C insert
 -> hope all three succeed
```

## 2. Current canonical high-risk write paths

| Domain action | Canonical boundary today | Why |
|---|---|---|
| complete sale | `process_sale` / idempotent wrapper | sale + stock + payment/accounting boundary |
| refund | refund RPC family | inventory restoration + financial reversal |
| purchase | `process_purchase` | purchase + receipt stock/accounting semantics |
| kitchen send | `send_to_kitchen` | incremental idempotent kitchen consumption |
| stock count apply | stock-count RPC flow | variance + inventory + journal |
| waste approval | waste approval RPC | FIFO valuation + accounting |
| production | production RPC flow | raw consumption + output valuation |
| manual journal | `post_manual_journal` | validates double entry |
| warehouse transfer | transfer RPC flow | paired source/target effects |
| shift/day close | close/rollover RPC flow | treasury/business-day integrity |

## 3. Catalog/configuration writes

Single-aggregate master-data writes may remain simpler than financial commands, but should converge behind module application services.

Current areas requiring consolidation:

- products/raw materials direct page writes;
- recipe header/items orchestration;
- product-unit and component-link writes;
- import/export executor direct writes;
- inventory-unit configuration.

P-A does not change them. Phase 2 will define canonical item/UOM commands.

## 4. Frontend boundary problem

Current data access is split among:

```
src/api/
src/core/repositories/
src/features/*/services/
src/lib/
page-level Supabase calls
```

Target ownership:

```
modules/<domain>/application
modules/<domain>/infrastructure
```

Pages/components never become the authority for financial, tax, stock or accounting calculations.

## 5. Write-path invariants

Any path that changes inventory/accounting must satisfy:

- explicit branch;
- explicit warehouse for stock movement;
- authenticated actor;
- transaction boundary;
- idempotency for retryable commands;
- immutable source reference;
- reversal path;
- audit/correlation;
- no silent catch-and-ignore for critical writes.

## 6. P-A frozen decisions

- `orders` remain operational.
- `sales` remain posted commercial snapshots.
- inventory ledger/effect traces remain the audit basis while canonical ledger work is designed.
- FIFO and negative-stock debt logic remain server-owned.
- posted accounting must balance.
- client previews do not override server totals.
