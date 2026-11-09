-- Historical migration already recorded in Premier production Supabase history.
-- Recovered verbatim SQL body to allow disposable CI databases to replay full schema.
-- DO NOT run manually against production; applied there as migration 20261023043004.
CREATE TABLE IF NOT EXISTS private.raw_warehouse_movements_v2 (
 operation_id uuid PRIMARY KEY,
 branch_id uuid NOT NULL,
 warehouse_id uuid NOT NULL,
 raw_material_id uuid NOT NULL,
 quantity_delta numeric(18,4) NOT NULL CHECK (quantity_delta <> 0),
 before_qty numeric(18,4) NOT NULL,
 after_qty numeric(18,4) NOT NULL,
 unit_cost numeric(18,6) NOT NULL CHECK (unit_cost >= 0),
 total_cost numeric(24,6) NOT NULL,
 price_event_id uuid NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (after_qty = before_qty + quantity_delta)
);
ALTER TABLE private.raw_warehouse_movements_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.raw_warehouse_movements_v2 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON private.raw_warehouse_movements_v2 TO service_role;

CREATE OR REPLACE FUNCTION private.apply_raw_warehouse_delta_v2(
 p_operation_id uuid,p_branch_id uuid,p_warehouse_id uuid,p_raw_material_id uuid,
 p_delta numeric,p_allow_negative boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE
 v_previous private.raw_warehouse_movements_v2%ROWTYPE;
 v_current numeric;
 v_live numeric;
 v_next numeric;
 v_price numeric := 0;
 v_price_event uuid;
BEGIN
 IF p_operation_id IS NULL OR p_branch_id IS NULL OR p_warehouse_id IS NULL OR
 p_raw_material_id IS NULL OR p_delta IS NULL OR p_delta=0 OR p_delta<>round(p_delta,4) THEN
  RETURN jsonb_build_object('success',false,'error','INVALID_ARGUMENTS');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.warehouses w
   WHERE w.id=p_warehouse_id AND w.branch_id=p_branch_id AND w.is_active)
 OR NOT EXISTS(SELECT 1 FROM public.raw_materials r
   WHERE r.id=p_raw_material_id AND r.branch_id=p_branch_id) THEN
  RETURN jsonb_build_object('success',false,'error','BRANCH_OR_WAREHOUSE_MISMATCH');
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
   p_branch_id::text||':'||p_warehouse_id::text||':'||p_raw_material_id::text,0));
 SELECT * INTO v_previous FROM private.raw_warehouse_movements_v2
 WHERE operation_id=p_operation_id;
 IF FOUND THEN
  IF v_previous.branch_id<>p_branch_id OR v_previous.warehouse_id<>p_warehouse_id
   OR v_previous.raw_material_id<>p_raw_material_id OR v_previous.quantity_delta<>p_delta THEN
   RETURN jsonb_build_object('success',false,'error','IDEMPOTENCY_CONFLICT');
  END IF;
  RETURN jsonb_build_object('success',true,'replayed',true,'before_qty',v_previous.before_qty,
    'after_qty',v_previous.after_qty,'unit_cost',v_previous.unit_cost);
 END IF;
 SELECT b.quantity INTO v_current FROM private.raw_warehouse_balances_v2 b
 WHERE b.branch_id=p_branch_id AND b.warehouse_id=p_warehouse_id
 AND b.raw_material_id=p_raw_material_id FOR UPDATE;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('success',false,'error','BALANCE_NOT_INITIALIZED');
 END IF;
 SELECT coalesce(sum(b.quantity),0) INTO v_live FROM public.raw_material_batches b
 WHERE b.branch_id=p_branch_id AND b.warehouse_id=p_warehouse_id AND b.raw_material_id=p_raw_material_id;
 IF v_live<>v_current THEN
  RETURN jsonb_build_object('success',false,'error','LEGACY_BALANCE_DRIFT','staged',v_current,'legacy',v_live);
 END IF;
 RETURN jsonb_build_object('success',false,'error','CUTOVER_NOT_ENABLED',
  'reason','Legacy FIFO stock writers are still active; refusing to mutate staging balances');
END;
$$;
REVOKE ALL ON FUNCTION private.apply_raw_warehouse_delta_v2(uuid,uuid,uuid,uuid,numeric,boolean)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.apply_raw_warehouse_delta_v2(uuid,uuid,uuid,uuid,numeric,boolean)
 TO service_role;
