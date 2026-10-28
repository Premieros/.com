-- CI-only schema support, read from the .com project's pg_catalog on 2026-10-28.
-- Project hvqlkapynjfjikqithvd only. No business rows or new privileged functions.
-- Production already has this table; the historical repository replay omitted its creation.
CREATE TABLE private.raw_warehouse_movements_v2 (
 operation_id uuid PRIMARY KEY,
 branch_id uuid NOT NULL, warehouse_id uuid NOT NULL, raw_material_id uuid NOT NULL,
 quantity_delta numeric(18,4) NOT NULL CHECK(quantity_delta<>0),
 before_qty numeric(18,4) NOT NULL,after_qty numeric(18,4) NOT NULL,
 unit_cost numeric(18,6) NOT NULL CHECK(unit_cost>=0),total_cost numeric(24,6) NOT NULL,
 price_event_id uuid,created_at timestamptz NOT NULL DEFAULT now(),
 ledger_id bigint UNIQUE REFERENCES public.inventory_ledger(id),entry_type text,
 source_reference_type text,source_reference_id uuid,
 CHECK(after_qty=before_qty+quantity_delta)
);
ALTER TABLE private.raw_warehouse_movements_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.raw_warehouse_movements_v2 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON private.raw_warehouse_movements_v2 TO service_role;
