-- NOT FOR PRODUCTION. Candidate for isolated CI Postgres only.
-- Never run on the Premier production Supabase project without owner approval.
-- Target baseline: Premier production function definitions read-only 2026-11-08.
-- Preserve original SECURITY DEFINER, search_path, grants, return contract and writers.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

DO $settlement_guard$
DECLARE
  v_definition text;
  v_old text := $old$
  IF p_warehouse_id IS NULL
     OR v_order.inventory_warehouse_id IS DISTINCT FROM p_warehouse_id THEN
$old$;
  v_new text := $new$
  -- PREMIER_ORDER_FULL_SEND_REQUIRED_20261108: check after locking the order.
  IF EXISTS (
    SELECT 1
    FROM public.order_items oi
    LEFT JOIN public.order_kitchen_sends s
      ON s.order_item_id = oi.id AND s.order_id = oi.order_id
    WHERE oi.order_id = p_order_id
      AND oi.quantity > COALESCE(s.sent_quantity, 0) + 0.000001
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FULLY_SENT');
  END IF;

  IF p_warehouse_id IS NULL
     OR v_order.inventory_warehouse_id IS DISTINCT FROM p_warehouse_id THEN
$new$;
BEGIN
  SELECT pg_get_functiondef('public._prepare_kitchen_sale_settlement(uuid,uuid,uuid,jsonb)'::regprocedure)
    INTO STRICT v_definition;
  IF md5(v_definition) <> '7bd3f7ac00ec8fd217bf27be451c1a73' THEN
    RAISE EXCEPTION 'PREMIER_SETTLEMENT_BASELINE_DRIFT';
  END IF;
  IF length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old) THEN
    RAISE EXCEPTION 'PREMIER_SETTLEMENT_ANCHOR_DRIFT';
  END IF;
  EXECUTE replace(v_definition, v_old, v_new);
END;
$settlement_guard$;

DO $print_guard$
DECLARE
  v_definition text;
  v_old_lock text := $old$
  WHERE o.id=p_order_id;
$old$;
  v_new_lock text := $new$
  WHERE o.id=p_order_id
  FOR UPDATE;
$new$;
  v_old_gate text := $old$
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
$old$;
  v_new_gate text := $new$
  -- PREMIER_ORDER_FULL_SEND_REQUIRED_20261108: locked, fail-closed customer check.
  IF EXISTS (
    SELECT 1
    FROM public.order_items oi
    LEFT JOIN public.order_kitchen_sends s
      ON s.order_item_id = oi.id AND s.order_id = oi.order_id
    WHERE oi.order_id = p_order_id
      AND oi.quantity > COALESCE(s.sent_quantity, 0) + 0.000001
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FULLY_SENT');
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
$new$;
BEGIN
  SELECT pg_get_functiondef('public.enqueue_cloud_open_order_print(uuid,jsonb,text)'::regprocedure)
    INTO STRICT v_definition;
  IF md5(v_definition) <> '79d0a8973a55b7e85ea6655c3df53f90' THEN
    RAISE EXCEPTION 'PREMIER_PRINT_BASELINE_DRIFT';
  END IF;
  IF length(v_definition) - length(replace(v_definition, v_old_lock, '')) <> length(v_old_lock)
     OR length(v_definition) - length(replace(v_definition, v_old_gate, '')) <> length(v_old_gate) THEN
    RAISE EXCEPTION 'PREMIER_PRINT_ANCHOR_DRIFT';
  END IF;
  v_definition := replace(v_definition, v_old_lock, v_new_lock);
  v_definition := replace(v_definition, v_old_gate, v_new_gate);
  EXECUTE v_definition;
END;
$print_guard$;

-- Postconditions: the same authorization and business contracts still exist.
DO $verify$
DECLARE
  v_settlement text := pg_get_functiondef('public._prepare_kitchen_sale_settlement(uuid,uuid,uuid,jsonb)'::regprocedure);
  v_print text := pg_get_functiondef('public.enqueue_cloud_open_order_print(uuid,jsonb,text)'::regprocedure);
BEGIN
  IF position('PREMIER_ORDER_FULL_SEND_REQUIRED_20261108' IN v_settlement) = 0
    OR position('PREMIER_ORDER_FULL_SEND_REQUIRED_20261108' IN v_print) = 0
    OR position('FOR UPDATE' IN v_print) = 0
    OR position('user_may_access_branch' IN v_settlement) = 0
    OR position('user_may_access_branch' IN v_print) = 0
    OR position('IDEMPOTENCY_KEY_REQUIRED' IN v_print) = 0 THEN
    RAISE EXCEPTION 'PREMIER_POS_GUARD_POSTCONDITION_FAILED';
  END IF;
END;
$verify$;
COMMIT;
