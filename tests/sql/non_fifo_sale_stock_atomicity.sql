-- Regression checks for the staged non-FIFO sale stock writer.
-- Run on an isolated PremierOS .com clone ONLY, with privileges to access private schema.
-- All writes are rolled back. Replace :sale_id, :material_id and :operation_id with real fixture IDs.
-- Keep execution within a single database connection and transaction.
BEGIN;
SELECT set_config('premieros.v2_movement_test', 'enabled', true);
DO $$
DECLARE
  v_sale_id uuid := :'sale_id';
  v_material_id uuid := :'material_id';
  v_operation_id uuid := :'operation_id';
  v_first jsonb;
  v_replay jsonb;
  v_conflict jsonb;
  v_count integer;
BEGIN
  v_first := private.apply_raw_sale_stock_v4(v_operation_id, v_sale_id, v_material_id, -1, false);
  IF COALESCE((v_first->>'success')::boolean, false) IS NOT TRUE
     OR COALESCE((v_first->>'replayed')::boolean,false) THEN
    RAISE EXCEPTION 'FIRST_WRITE_FAILED: %', v_first;
  END IF;
  v_replay := private.apply_raw_sale_stock_v4(v_operation_id, v_sale_id, v_material_id, -1, false);
  IF COALESCE((v_replay->>'success')::boolean,false) IS NOT TRUE
     OR COALESCE((v_replay->>'replayed')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'IDEMPOTENT_REPLAY_FAILED: %', v_replay;
  END IF;
  v_conflict := private.apply_raw_sale_stock_v4(v_operation_id, v_sale_id, v_material_id, -2, false);
  IF v_conflict->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN
    RAISE EXCEPTION 'CONFLICT_NOT_REJECTED: %', v_conflict;
  END IF;
  SELECT COUNT(*) INTO v_count FROM private.raw_warehouse_movements_v2
    WHERE operation_id = v_operation_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'DUPLICATE_OR_MISSING_MOVEMENT: %', v_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM private.raw_warehouse_movements_v2 m
    JOIN public.inventory_ledger il ON il.id=m.ledger_id
    WHERE m.operation_id=v_operation_id
      AND il.entry_type='sale' AND il.reference_type='sale'
      AND il.reference_id=v_sale_id
      AND il.quantity=-1
  ) THEN
    RAISE EXCEPTION 'MISSING_DOCUMENT_LEDGER_LINK';
  END IF;
END $$;
ROLLBACK;
-- Note: this test does NOT establish overall transactional accounting correctness or concurrency safety.
