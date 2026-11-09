-- Historical migration already recorded in Premier production Supabase history.
-- Recovered verbatim SQL body to allow disposable CI databases to replay full schema.
-- DO NOT run manually against production; applied there as migration 20261023042826.
CREATE TABLE IF NOT EXISTS private.raw_warehouse_balances_v2 (
 branch_id uuid NOT NULL REFERENCES public.branches(id),
 warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
 raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id),
 quantity numeric(18,4) NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (branch_id, warehouse_id, raw_material_id)
);
ALTER TABLE private.raw_warehouse_balances_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.raw_warehouse_balances_v2 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON private.raw_warehouse_balances_v2 TO service_role;
INSERT INTO private.raw_warehouse_balances_v2 (branch_id,warehouse_id,raw_material_id,quantity)
SELECT b.branch_id,b.warehouse_id,b.raw_material_id,round(sum(b.quantity),4)
FROM public.raw_material_batches b
JOIN public.warehouses w ON w.id=b.warehouse_id AND w.branch_id=b.branch_id
WHERE b.warehouse_id IS NOT NULL
GROUP BY b.branch_id,b.warehouse_id,b.raw_material_id
ON CONFLICT (branch_id,warehouse_id,raw_material_id) DO NOTHING;
COMMENT ON TABLE private.raw_warehouse_balances_v2 IS 'Transition-only warehouse balance baseline for non-FIFO quantity engine; NOT authoritative until all stock writers cut over and reconciliation passes.';
