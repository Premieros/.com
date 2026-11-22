-- Order-item writes can refresh the order header before the split updates it.
-- Apply the financial allocation to the locked pre-move snapshots.
DO $migration$
DECLARE
  v_definition text := pg_get_functiondef(
    'public.perform_pos_order_action(text,uuid,jsonb,text)'::regprocedure
  );
  v_old text := $old$
    UPDATE public.orders
    SET discount_amount = GREATEST(COALESCE(discount_amount,0) - v_source_order_discount, 0),
        tax_amount = GREATEST(COALESCE(tax_amount,0) - v_source_tax, 0)
    WHERE id = p_order_id;
    UPDATE public.orders
    SET discount_amount = COALESCE(discount_amount,0) + v_source_order_discount,
        tax_amount = COALESCE(tax_amount,0) + v_source_tax
    WHERE id = v_target_id;
$old$;
  v_new text := $new$
    UPDATE public.orders
    SET discount_amount = GREATEST(COALESCE(v_order.discount_amount,0) - v_source_order_discount, 0),
        tax_amount = GREATEST(COALESCE(v_order.tax_amount,0) - v_source_tax, 0)
    WHERE id = p_order_id;
    UPDATE public.orders
    SET discount_amount = COALESCE(v_target_order.discount_amount,0) + v_source_order_discount,
        tax_amount = COALESCE(v_target_order.tax_amount,0) + v_source_tax
    WHERE id = v_target_id;
$new$;
  v_ratio_old text := $old$
    v_source_order_discount := round(COALESCE(v_order.discount_amount, 0) * v_order_ratio, 4);
    v_source_tax := round(COALESCE(v_order.tax_amount, 0) * v_order_ratio, 4);
$old$;
  v_ratio_new text := $new$
    v_source_order_discount := round(COALESCE(v_order.discount_amount, 0) * v_order_ratio, 2);
    v_source_tax := round(COALESCE(v_order.tax_amount, 0) * v_order_ratio, 2);
$new$;
BEGIN
  IF strpos(v_definition, v_old) = 0 OR strpos(v_definition, v_ratio_old) = 0 THEN
    RAISE EXCEPTION 'POS order split definition differs from the expected version';
  END IF;
  EXECUTE replace(replace(v_definition, v_old, v_new), v_ratio_old, v_ratio_new);
END;
$migration$;
