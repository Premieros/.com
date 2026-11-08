-- NOT FOR PRODUCTION. Controlled rollback candidate; run ONLY in isolated reviewed DB.
-- Restores the exact inspected Premier function definitions, not customer data.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

DO $settlement_rollback$
DECLARE
  v_definition text;
  v_guard text := $new$
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

$new$;
BEGIN
  SELECT pg_get_functiondef('public._prepare_kitchen_sale_settlement(uuid,uuid,uuid,jsonb)'::regprocedure)
    INTO STRICT v_definition;
  IF length(v_definition) - length(replace(v_definition, v_guard, '')) <> length(v_guard) THEN
    RAISE EXCEPTION 'PREMIER_SETTLEMENT_ROLLBACK_DRIFT';
  END IF;
  v_definition := replace(v_definition, v_guard, '');
  IF md5(v_definition) <> '7bd3f7ac00ec8fd217bf27be451c1a73' THEN
    RAISE EXCEPTION 'PREMIER_SETTLEMENT_ROLLBACK_ORIGINAL_MISMATCH';
  END IF;
  EXECUTE v_definition;
END;
$settlement_rollback$;

DO $print_rollback$
DECLARE
  v_definition text;
  v_guard text := $new$
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

$new$;
  v_locked text := $new$
  WHERE o.id=p_order_id
  FOR UPDATE;
$new$;
  v_original text := $old$
  WHERE o.id=p_order_id;
$old$;
BEGIN
  SELECT pg_get_functiondef('public.enqueue_cloud_open_order_print(uuid,jsonb,text)'::regprocedure)
    INTO STRICT v_definition;
  IF length(v_definition) - length(replace(v_definition, v_guard, '')) <> length(v_guard)
    OR length(v_definition) - length(replace(v_definition, v_locked, '')) <> length(v_locked) THEN
    RAISE EXCEPTION 'PREMIER_PRINT_ROLLBACK_DRIFT';
  END IF;
  v_definition := replace(v_definition, v_guard, '');
  v_definition := replace(v_definition, v_locked, v_original);
  IF md5(v_definition) <> '79d0a8973a55b7e85ea6655c3df53f90' THEN
    RAISE EXCEPTION 'PREMIER_PRINT_ROLLBACK_ORIGINAL_MISMATCH';
  END IF;
  EXECUTE v_definition;
END;
$print_rollback$;
COMMIT;
