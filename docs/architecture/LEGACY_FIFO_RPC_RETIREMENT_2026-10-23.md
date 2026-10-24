# Legacy FIFO RPC retirement — 2026-10-23

Project scope: `Premieros/.com`; Supabase `hvqlkapynjfjikqithvd` only.

## Deployed changes
- Migration `remove_legacy_fifo_opening_cost_repair_rpcs`: DROPPED with RESTRICT:
  - `public.raw_opening_cost_apply_repair(uuid)`
  - `public.raw_opening_cost_prepare_repair(uuid)`
  - `public.raw_opening_cost_reverse_repair(uuid)`
- Migration `remove_legacy_fifo_backfill_rpcs`: DROPPED with RESTRICT:
  - `public.raw_fifo_apply_backfill(uuid)`
  - `public.raw_fifo_prepare_backfill(uuid)`
  - `public.raw_fifo_reverse_backfill(uuid)`

SQL function body search showed no internal routine calls to repair functions before removal, and no internal routine calls to backfill functions after removal of repair functions. A verification catalog query returned zero remaining definitions across all six.

## Important limits
- This **does not** eradicate operational FIFO. `_raw_remove_fifo` remains referenced by multiple sale, stock, production, return and transfer functions, and a batch-pricing FIFO trigger remains installed.
- Catalog text searches do not prove there are no application, Edge Function, dashboard or dynamically constructed calls to these dropped RPCs. Search and update these consumers and test before marking integration complete.
- FIFO backfill/repair tables and historical evidence remain; do not drop them until dependency and business integrity checks are complete.
- User-approved policy for raw material recipe cost remains latest published price, or 0 if no published price.
- Existing sales and accounting postings were not rewritten.
