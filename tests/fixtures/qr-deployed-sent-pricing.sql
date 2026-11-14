-- Deployed pricing and sent-line guards exercised by QR quantity additions.
CREATE OR REPLACE FUNCTION public._reprice_order_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_partial jsonb;
  v_branch_id uuid;
  v_base_price numeric(14,2);
  v_mod jsonb;
BEGIN
  IF TG_TABLE_NAME='order_items' AND TG_OP IN ('INSERT','UPDATE') THEN
    v_partial:=public._pos_partial_transfer_context(NEW.order_id,NEW.id);
    IF v_partial IS NOT NULL THEN
      IF TG_OP='INSERT' AND NEW.id=(v_partial->>'new_item_id')::uuid
        AND NEW.quantity=(v_partial->>'quantity')::numeric
        AND NEW.discount_amount=(v_partial->>'discount')::numeric
        AND NEW.bonus_quantity=(v_partial->>'bonus')::numeric
        AND NEW.total=(v_partial->>'total')::numeric
        AND EXISTS(SELECT 1 FROM public.order_items i WHERE i.id=(v_partial->>'source_item_id')::uuid
          AND (to_jsonb(i)-ARRAY['id','quantity','discount_amount','bonus_quantity','total'])
            =(to_jsonb(NEW)-ARRAY['id','quantity','discount_amount','bonus_quantity','total'])) THEN RETURN NEW;
      ELSIF TG_OP='UPDATE' AND NEW.id=(v_partial->>'source_item_id')::uuid
        AND OLD.quantity=(v_partial->>'source_quantity')::numeric
        AND NEW.quantity=OLD.quantity-(v_partial->>'quantity')::numeric
        AND NEW.discount_amount=OLD.discount_amount-(v_partial->>'discount')::numeric
        AND NEW.bonus_quantity=OLD.bonus_quantity-(v_partial->>'bonus')::numeric
        AND NEW.total=OLD.total-(v_partial->>'total')::numeric
        AND (to_jsonb(NEW)-ARRAY['quantity','discount_amount','bonus_quantity','total'])
          =(to_jsonb(OLD)-ARRAY['quantity','discount_amount','bonus_quantity','total'])
        AND EXISTS(SELECT 1 FROM public.order_items i WHERE i.id=(v_partial->>'new_item_id')::uuid AND i.order_id=OLD.order_id AND i.quantity=(v_partial->>'quantity')::numeric)
        THEN RETURN NEW;
      END IF;
    END IF;
  END IF;

  SELECT o.branch_id INTO v_branch_id
  FROM public.orders o
  WHERE o.id = NEW.order_id;
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  SELECT p.sale_price INTO v_base_price
  FROM public.products p
  WHERE p.id = NEW.product_id
    AND p.branch_id = v_branch_id
    AND p.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_IN_BRANCH';
  END IF;
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  v_mod := public.resolve_product_modifiers(
    NEW.product_id,
    v_branch_id,
    to_jsonb(COALESCE(NEW.modifier_option_ids, '{}'::uuid[]))
  );
  IF COALESCE((v_mod->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'MODIFIER_VALIDATION_FAILED: %', COALESCE(v_mod->>'error', 'unknown');
  END IF;

  NEW.modifiers_snapshot := COALESCE(v_mod->'snapshot', '[]'::jsonb);
  NEW.unit_price := ROUND(
    GREATEST(COALESCE(v_base_price, 0) + COALESCE((v_mod->>'price_delta')::numeric, 0), 0),
    2
  );
  NEW.discount_amount := ROUND(
    LEAST(GREATEST(COALESCE(NEW.discount_amount, 0), 0), NEW.quantity * NEW.unit_price),
    2
  );
  NEW.bonus_quantity := GREATEST(COALESCE(NEW.bonus_quantity, 0), 0);
  NEW.total := ROUND(NEW.quantity * NEW.unit_price - NEW.discount_amount, 2);
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.guard_sent_order_item_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_partial jsonb;
  v_has_sent boolean := false;
  v_is_reduction boolean := false;
  v_internal boolean := COALESCE(current_setting('app.approved_sent_item_void', true), '') = '1';
  v_pending_event_quantity numeric(14,6) := 0;
BEGIN
  IF TG_OP='DELETE' AND EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id=OLD.order_id
      AND private.authorized_full_tenant_purge_branch(o.branch_id)
  ) THEN RETURN OLD; END IF;
    SELECT
    EXISTS(
      SELECT 1
      FROM public.order_kitchen_sends s
      WHERE s.order_item_id = OLD.id
    )
    OR EXISTS(
      SELECT 1
      FROM public.order_kitchen_inventory_events e
      WHERE e.order_item_id = OLD.id
        AND e.order_id = OLD.order_id
        AND e.settled_sale_id IS NULL
        AND e.sent_quantity > e.voided_quantity
    )
  INTO v_has_sent;

  IF NOT v_has_sent THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_is_reduction := true;
  ELSIF TG_OP = 'UPDATE'
        AND COALESCE(NEW.quantity, 0) < COALESCE(OLD.quantity, 0) THEN
    v_is_reduction := true;
  END IF;

  IF NOT v_is_reduction THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP='UPDATE' THEN
    v_partial:=public._pos_partial_transfer_context(OLD.order_id,OLD.id);
    IF v_partial IS NOT NULL AND OLD.id=(v_partial->>'source_item_id')::uuid
      AND NEW.quantity=OLD.quantity-(v_partial->>'quantity')::numeric
      AND (to_jsonb(NEW)-ARRAY['quantity','discount_amount','bonus_quantity','total'])
        =(to_jsonb(OLD)-ARRAY['quantity','discount_amount','bonus_quantity','total'])
      AND NEW.quantity>=COALESCE((SELECT sum(sent_quantity-voided_quantity) FROM public.order_kitchen_inventory_events WHERE order_id=OLD.order_id AND order_item_id=OLD.id),0)
      AND EXISTS(SELECT 1 FROM public.order_items i WHERE i.id=(v_partial->>'new_item_id')::uuid AND i.quantity=(v_partial->>'quantity')::numeric AND i.order_id=OLD.order_id)
      AND COALESCE((SELECT sum(sent_quantity-voided_quantity) FROM public.order_kitchen_inventory_events WHERE order_id=OLD.order_id AND order_item_id=(v_partial->>'new_item_id')::uuid),0)=(v_partial->>'sent_quantity')::numeric
      THEN RETURN NEW; END IF;
  END IF;

  IF NOT v_internal THEN
    RAISE EXCEPTION 'SENT_ITEM_APPROVAL_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(sum(e.sent_quantity - e.voided_quantity), 0)
  INTO v_pending_event_quantity
  FROM public.order_kitchen_inventory_events e
  WHERE e.order_item_id = OLD.id
    AND e.order_id = OLD.order_id
    AND e.settled_sale_id IS NULL
    AND e.sent_quantity > e.voided_quantity;

  IF TG_OP = 'DELETE' AND v_pending_event_quantity > 0.000001 THEN
    RAISE EXCEPTION 'SENT_ITEM_VOID_INCOMPLETE' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE'
     AND v_pending_event_quantity > COALESCE(NEW.quantity, 0) + 0.000001 THEN
    RAISE EXCEPTION 'SENT_ITEM_VOID_INCOMPLETE' USING ERRCODE = 'P0001';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;
