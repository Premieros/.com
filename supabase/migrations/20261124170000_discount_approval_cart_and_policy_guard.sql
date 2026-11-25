-- Draft only: verify on disposable CI before release.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Compare the complete multiset of financially relevant item attributes.
-- Ignore presentation-only values (notes, display prices, total), which
-- canonical sale pricing derives independently. Preserve duplicates.
CREATE OR REPLACE FUNCTION public.discount_approval_cart(p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $cart$
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
  IF jsonb_array_length(p_items) = 0 THEN RETURN NULL; END IF;
  RETURN (
      SELECT jsonb_agg(line ORDER BY line)
      FROM (
        SELECT jsonb_build_object(
          'product_id', value->>'product_id',
          'unit_name', COALESCE(value->>'unit_name',''),
          'quantity', (value->>'quantity')::numeric,
          'discount_amount', COALESCE((value->>'discount_amount')::numeric,0),
          'bonus_quantity', COALESCE((value->>'bonus_quantity')::numeric,0),
          'modifier_option_ids', (
            SELECT COALESCE(jsonb_agg(mod ORDER BY mod),'[]'::jsonb)
            FROM jsonb_array_elements(COALESCE(value->'modifier_option_ids','[]'::jsonb)) AS m(mod)
          )
        ) AS line FROM jsonb_array_elements(p_items)
      ) normalized
    );
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
  -- Malformed request payloads cannot block unrelated valid approvals.
  RETURN NULL;
END;
$cart$;
REVOKE ALL ON FUNCTION public.discount_approval_cart(jsonb) FROM PUBLIC, anon, authenticated;

DO $migration$
DECLARE
  target regprocedure;
  definition text;
  old_predicate constant text := '(entity_id IS NOT DISTINCT FROM p_order_id)';
  new_predicate constant text := '(entity_id IS NOT DISTINCT FROM p_order_id)
      AND (p_order_id IS NOT NULL OR
        public.discount_approval_cart(payload->''cart'') = public.discount_approval_cart(p_items))';
  policy_anchor constant text := 'IF NOT public.can_approve_by_policy(''manager:''||v_req.action_type,v_req.branch_id,v_amount,''approvals.review'') THEN';
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'public.process_sale(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer)'::regprocedure,
    'public.process_sale_split(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text,jsonb,uuid,text,uuid,uuid,integer)'::regprocedure
  ] LOOP
    definition := pg_get_functiondef(target);
    IF position(old_predicate IN definition) = 0 THEN
      RAISE EXCEPTION 'Expected discount scope predicate missing in %', target;
    END IF;
    EXECUTE replace(definition, old_predicate, new_predicate);
  END LOOP;

  target := 'public.decide_manager_approval(uuid,boolean,text)'::regprocedure;
  definition := pg_get_functiondef(target);
  IF position(policy_anchor IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected approval policy anchor missing in %', target;
  END IF;
  -- A malicious discount request must not choose the manager's threshold by
  -- supplying a smaller unrelated total or amount. Reject invalid amounts
  -- on approval; still permit an authorized manager to reject such requests.
  EXECUTE replace(definition, policy_anchor, $guard$
  IF v_req.action_type = 'discount' THEN
    IF COALESCE(v_req.payload->>'discount_amount','') !~ '^[0-9]+([.][0-9]+)?$' THEN
      IF p_approve THEN RETURN jsonb_build_object('success',false,'error','INVALID_DISCOUNT_APPROVAL_AMOUNT'); END IF;
      v_amount := 0;
    ELSE
      v_amount := (v_req.payload->>'discount_amount')::numeric;
      IF p_approve AND v_amount <= 0 THEN
        RETURN jsonb_build_object('success',false,'error','INVALID_DISCOUNT_APPROVAL_AMOUNT');
      END IF;
    END IF;
  END IF;
  $guard$ || policy_anchor);
END;
$migration$;
