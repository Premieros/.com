-- Read-only snapshot of deployed guards/totals. Other ERP modules are fixture dependencies.
CREATE OR REPLACE FUNCTION public._sync_order_totals_from_items()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order_id uuid;
  v_branch_id uuid;
  v_subtotal numeric(14,2);
  v_discount numeric(14,2);
  v_tax_enabled boolean;
  v_tax_rate numeric;
  v_tax numeric(14,2);
  v_total numeric(14,2);
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  SELECT branch_id, GREATEST(COALESCE(discount_amount, 0), 0)
  INTO v_branch_id, v_discount
  FROM public.orders WHERE id = v_order_id;
  IF v_branch_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT ROUND(COALESCE(SUM(total), 0), 2)
  INTO v_subtotal
  FROM public.order_items WHERE order_id = v_order_id;

  v_discount := LEAST(v_discount, v_subtotal);
  SELECT t.tax_enabled, t.tax_rate INTO v_tax_enabled, v_tax_rate
  FROM public._effective_branch_tax(v_branch_id) t;
  v_tax := CASE WHEN COALESCE(v_tax_enabled, false)
    THEN ROUND((v_subtotal - v_discount) * COALESCE(v_tax_rate, 0) / 100, 2)
    ELSE 0 END;
  v_total := ROUND(v_subtotal - v_discount + v_tax, 2);

  UPDATE public.orders
  SET subtotal = v_subtotal,
      discount_amount = v_discount,
      tax_amount = v_tax,
      total = v_total,
      updated_at = now()
  WHERE id = v_order_id;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_pos_permission_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_partial jsonb;
  v_uid uuid := auth.uid();
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
  v_print_only_mutation boolean := false;
  v_item_transfer_context boolean := false;
  v_sent_item_void_context boolean := false;
  v_pos_action_context boolean := false;
BEGIN
  IF v_is_service_role OR v_uid IS NULL THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

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

  IF TG_TABLE_NAME='order_kitchen_sends' THEN
  IF TG_OP IN ('INSERT','UPDATE') THEN
    v_partial:=public._pos_partial_transfer_context(NEW.order_id,NEW.order_item_id);
    IF v_partial IS NOT NULL AND NEW.sent_quantity=COALESCE((SELECT sum(sent_quantity-voided_quantity)
      FROM public.order_kitchen_inventory_events WHERE order_item_id=NEW.order_item_id AND order_id=NEW.order_id),0) THEN
      IF TG_OP='INSERT' AND NEW.order_item_id=(v_partial->>'new_item_id')::uuid
        AND NEW.sent_quantity=(v_partial->>'sent_quantity')::numeric
        AND EXISTS(SELECT 1 FROM public.order_kitchen_sends s WHERE s.order_item_id=(v_partial->>'source_item_id')::uuid
          AND s.branch_id=NEW.branch_id AND s.sent_by IS NOT DISTINCT FROM NEW.sent_by AND s.sent_at=NEW.sent_at) THEN RETURN NEW;
      ELSIF TG_OP='UPDATE' AND NEW.order_item_id=(v_partial->>'source_item_id')::uuid
        AND NEW.sent_quantity=OLD.sent_quantity-(v_partial->>'sent_quantity')::numeric
        AND (to_jsonb(NEW)-'sent_quantity')=(to_jsonb(OLD)-'sent_quantity') THEN RETURN NEW;
      END IF;
    END IF;
  END IF;

  END IF;
  IF TG_TABLE_NAME='orders' THEN
  IF TG_OP='UPDATE'
    AND public.can_permission('pos.order.transfer') AND public.user_may_access_branch(OLD.branch_id)
    AND COALESCE(current_setting('app.pos_item_transfer_branch_id',true),'')=OLD.branch_id::text
    AND OLD.id::text IN (COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),''),COALESCE(current_setting('app.pos_item_transfer_target_order_id',true),''))
    AND (to_jsonb(NEW)-ARRAY['kitchen_status','kitchen_sent_at','kitchen_ready_at','updated_at'])=(to_jsonb(OLD)-ARRAY['kitchen_status','kitchen_sent_at','kitchen_ready_at','updated_at'])
    AND (
      (NEW.kitchen_status='pending' AND NOT EXISTS(SELECT 1 FROM public.order_kitchen_sends WHERE order_id=OLD.id AND sent_quantity>0))
      OR (NEW.kitchen_status='sent' AND EXISTS(SELECT 1 FROM public.order_kitchen_sends WHERE order_id=OLD.id AND sent_quantity>0))
      OR (NEW.kitchen_status='served' AND EXISTS(SELECT 1 FROM public.order_kitchen_sends WHERE order_id=OLD.id AND sent_quantity>0)
        AND NOT EXISTS(SELECT 1 FROM public.order_kitchen_sends oks LEFT JOIN public.order_kitchen_served_quantities ksb ON ksb.order_id=oks.order_id AND ksb.order_item_id=oks.order_item_id
          WHERE oks.order_id=OLD.id AND oks.sent_quantity>COALESCE(ksb.served_quantity,0)))
    ) THEN RETURN NEW; END IF;
  END IF;

  IF TG_TABLE_NAME='sales' THEN
    IF TG_OP='INSERT' AND NOT public.can_permission('pos.payment.take') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.payment.take';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME='order_kitchen_sends' THEN
    v_sent_item_void_context :=
      public._sent_item_void_context_matches(
        CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END,
        CASE WHEN TG_OP='DELETE' THEN OLD.order_item_id ELSE NEW.order_item_id END
      );
    IF NOT public.can_permission('pos.send_kitchen')
       AND NOT v_sent_item_void_context THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.send_kitchen';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME='orders' THEN
    IF TG_OP='INSERT' THEN
      IF NOT public.can_permission('pos.order.create') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.create'; END IF;
      RETURN NEW;
    END IF;
    IF TG_OP='DELETE' THEN
      IF NOT public.can_permission('pos.cancel_order') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.cancel_order'; END IF;
      RETURN OLD;
    END IF;

    v_print_only_mutation :=
      (NEW.print_status IS DISTINCT FROM OLD.print_status OR NEW.printed_at IS DISTINCT FROM OLD.printed_at)
      AND (to_jsonb(NEW)-ARRAY['print_status','printed_at','updated_at']::text[])
        = (to_jsonb(OLD)-ARRAY['print_status','printed_at','updated_at']::text[]);
    IF v_print_only_mutation THEN
      IF NOT public.can_permission('pos.receipt.print') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.receipt.print'; END IF;
      RETURN NEW;
    END IF;

    IF NEW.kitchen_status IS DISTINCT FROM OLD.kitchen_status
       AND (to_jsonb(NEW)-ARRAY['kitchen_status','kitchen_sent_at','kitchen_ready_at','updated_at']::text[])
         = (to_jsonb(OLD)-ARRAY['kitchen_status','kitchen_sent_at','kitchen_ready_at','updated_at']::text[]) THEN
      IF OLD.kitchen_status='pending'
         AND NEW.kitchen_status='sent'
         AND public.can_permission('pos.send_kitchen')
         AND EXISTS(SELECT 1 FROM public.order_kitchen_sends s WHERE s.order_id=OLD.id) THEN
        RETURN NEW;
      END IF;

      -- A served order may receive later additions. This is still a
      -- send-to-kitchen transition, not broad KDS management. Allow it only
      -- when an authoritative served baseline exists and cumulative sent
      -- quantity now exceeds that baseline for at least one line.
      IF OLD.kitchen_status='served'
         AND NEW.kitchen_status='sent'
         AND public.can_permission('pos.send_kitchen')
         AND EXISTS(
           SELECT 1
           FROM public.order_kitchen_sends s
           JOIN public.order_kitchen_served_quantities ksb
             ON ksb.order_id = OLD.id
            AND ksb.order_item_id = s.order_item_id
           WHERE s.order_id = OLD.id
             AND COALESCE(s.sent_quantity,0) > COALESCE(ksb.served_quantity,0)
         ) THEN
        RETURN NEW;
      END IF;
      IF NOT public.can_permission('pos.kds_update') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.kds_update'; END IF;
      RETURN NEW;
    END IF;

    IF NEW.station IS DISTINCT FROM OLD.station
       AND (to_jsonb(NEW)-ARRAY['station','updated_at']::text[])=(to_jsonb(OLD)-ARRAY['station','updated_at']::text[]) THEN
      IF NOT public.can_permission('pos.kds_update') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.kds_update'; END IF;
      RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status='cancelled' AND NOT public.can_permission('pos.cancel_order') THEN
        -- Empty-source cancellation created by the exact item-transfer RPC is structural,
        -- not a user void/cancel action.
        IF NOT (
          COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),'')=OLD.id::text
          AND public.can_permission('pos.order.transfer')
        )
        -- A signed sent-item Void may structurally close its own now-empty order.
        -- This does not grant the caller generic pos.cancel_order authority.
        AND NOT public._sent_item_void_context_matches(OLD.id,NULL) THEN
          RAISE EXCEPTION 'PERMISSION_DENIED:pos.cancel_order';
        END IF;
      ELSIF NEW.status='completed' THEN
        IF NOT public.can_permission('pos.payment.take') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.payment.take'; END IF;
        v_pos_action_context :=
          public._pos_action_context_matches(OLD.id,'pos.payment.take');
        IF NOT public.can_permission('pos.order.edit')
           AND NOT v_pos_action_context
           AND (to_jsonb(NEW)-ARRAY['status','payment_status','payment_at','updated_at']::text[])
             IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','payment_status','payment_at','updated_at']::text[]) THEN
          RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.edit';
        END IF;
      ELSIF NEW.status IN ('open','held') AND NOT public.can_permission('pos.hold') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.hold';
      END IF;
    END IF;

    IF NEW.table_id IS DISTINCT FROM OLD.table_id
       AND OLD.table_id IS NOT NULL
       AND NOT public.can_permission('pos.order.transfer') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.transfer';
    END IF;

    v_sent_item_void_context :=
      public._sent_item_void_context_matches(OLD.id, NULL);

    v_pos_action_context :=
      public._pos_action_context_matches(OLD.id,'pos.payment.take')
      OR public._pos_action_context_matches(OLD.id,'pos.send_kitchen')
      OR public._pos_action_context_matches(OLD.id,'pos.cancel_order');

    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
       AND NOT public.can_permission('pos.order.edit')
       AND NOT v_sent_item_void_context
       AND NOT v_pos_action_context THEN
      -- Recalculation/status bookkeeping inside the exact item transfer is permitted
      -- by transfer permission without broad edit permission.
      IF NOT (
        (
          COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),'')=OLD.id::text
          OR COALESCE(current_setting('app.pos_item_transfer_target_order_id',true),'')=OLD.id::text
        )
        AND public.can_permission('pos.order.transfer')
      ) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.edit';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME='order_items' THEN
    IF TG_OP='INSERT' THEN
      IF NOT public.can_permission('pos.order.create') AND NOT public.can_permission('pos.order.edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.edit';
      END IF;
      RETURN NEW;
    END IF;
    v_sent_item_void_context :=
      public._sent_item_void_context_matches(OLD.order_id, OLD.id);

    IF TG_OP='DELETE' THEN
      IF NOT public.can_permission('pos.void')
         AND NOT v_sent_item_void_context THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.void';
      END IF;
      RETURN OLD;
    END IF;

    IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      v_item_transfer_context :=
        COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),'')=OLD.order_id::text
        AND COALESCE(current_setting('app.pos_item_transfer_target_order_id',true),'')=NEW.order_id::text
        AND COALESCE(current_setting('app.pos_item_transfer_item_ids',true),'') LIKE '%' || OLD.id::text || '%'
        AND public.can_permission('pos.order.transfer');

      IF NOT v_item_transfer_context AND NOT public.can_permission('pos.order.split') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.split';
      END IF;
    ELSIF NOT public.can_permission('pos.order.edit')
       AND NOT v_sent_item_void_context THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.edit';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_pos_operator_ownership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_is_service_role boolean:=COALESCE(current_setting('role',true),'')='service_role'
    OR COALESCE(current_setting('request.jwt.claim.role',true),'')='service_role';
  v_is_db_admin boolean:=COALESCE(current_setting('role',true),'') IN('','none','postgres','supabase_admin')
    AND session_user IN('postgres','supabase_admin');
  v_can_manage_others boolean:=false;
  v_owner_id uuid;
  v_branch_id uuid;
  v_new_owner_id uuid;
  v_new_branch_id uuid;
  v_transfer_context boolean:=false;
  v_item_transfer_context boolean:=false;
  v_order_item_transfer_context boolean:=false;
  v_table_item_transfer_context boolean:=false;
  v_new_order_item_transfer_context boolean:=false;
  v_owner_mutation boolean:=false;
  v_sent_item_void_context boolean:=false;
  v_pos_action_context boolean:=false;
  v_partial jsonb;
BEGIN
  -- Only permit canonical default dining-table provisioning during a newly
  -- registered anonymous tenant's branch bootstrap. All regular POS actions
  -- remain subject to an authenticated operator and permission checks.
  IF TG_TABLE_NAME='dining_tables' AND TG_OP IN ('INSERT','UPDATE') THEN
    IF v_uid IS NULL AND current_setting('app.register_branch',true)='on'
       AND NEW.name ~ '^Table (0[1-9]|[1-4][0-9]|50)$'
       AND EXISTS (SELECT 1 FROM public.dining_areas a
                   WHERE a.id=NEW.area_id AND a.branch_id=NEW.branch_id AND a.is_default)
       AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.branch_id=NEW.branch_id)
    THEN RETURN NEW; END IF;
  END IF;

  IF v_is_service_role OR v_is_db_admin THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  IF public.is_pos_admin() THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  v_can_manage_others:=public.can_manage_other_pos_orders();

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

  IF TG_TABLE_NAME='orders' THEN
    IF TG_OP='INSERT' THEN
      IF NOT public.user_may_access_branch(NEW.branch_id) THEN
        RAISE EXCEPTION 'BRANCH_MISMATCH';
      END IF;
      IF NEW.cashier_id IS NULL THEN
        NEW.cashier_id:=v_uid;
      ELSIF NEW.cashier_id IS DISTINCT FROM v_uid THEN
        v_new_order_item_transfer_context :=
          COALESCE(current_setting('app.pos_item_transfer_new_order_owner_id',true),'')=NEW.cashier_id::text
          AND COALESCE(current_setting('app.pos_item_transfer_branch_id',true),'')=NEW.branch_id::text
          AND public.can_permission('pos.order.transfer');
        IF NOT v_new_order_item_transfer_context THEN
          RAISE EXCEPTION 'ORDER_OPERATOR_ASSIGNMENT_FORBIDDEN';
        END IF;
      END IF;
      RETURN NEW;
    END IF;

    IF TG_OP='DELETE' THEN
      IF NOT public.user_may_access_branch(OLD.branch_id) THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;
      IF OLD.cashier_id IS DISTINCT FROM v_uid AND NOT v_can_manage_others THEN
        RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
      END IF;
      RETURN OLD;
    END IF;

    IF NOT public.user_may_access_branch(OLD.branch_id) THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;

    v_order_item_transfer_context :=
      (
        COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),'')=OLD.id::text
        OR COALESCE(current_setting('app.pos_item_transfer_target_order_id',true),'')=OLD.id::text
      )
      AND COALESCE(current_setting('app.pos_item_transfer_branch_id',true),'')=OLD.branch_id::text
      AND public.can_permission('pos.order.transfer');

    v_owner_mutation:=
      (to_jsonb(NEW)-ARRAY['kitchen_status','kitchen_sent_at','kitchen_ready_at','station','print_status','printed_at','updated_at']::text[])
      IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['kitchen_status','kitchen_sent_at','kitchen_ready_at','station','print_status','printed_at','updated_at']::text[]);

    IF NEW.cashier_id IS DISTINCT FROM OLD.cashier_id THEN
      v_transfer_context:=
        COALESCE(current_setting('app.pos_operator_transfer_order_id',true),'')=OLD.id::text
        AND COALESCE(current_setting('app.pos_operator_transfer_target_id',true),'')=COALESCE(NEW.cashier_id::text,'')
        AND public.can_permission('pos.order.transfer');
      IF NOT v_transfer_context THEN RAISE EXCEPTION 'ORDER_TRANSFER_RPC_REQUIRED'; END IF;
      IF
        (to_jsonb(NEW)-ARRAY['cashier_id','kitchen_status','kitchen_sent_at','kitchen_ready_at','station','print_status','printed_at','updated_at']::text[])
        IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['cashier_id','kitchen_status','kitchen_sent_at','kitchen_ready_at','station','print_status','printed_at','updated_at']::text[])
      THEN
        RAISE EXCEPTION 'ORDER_TRANSFER_MUTATION_SCOPE';
      END IF;
      RETURN NEW;
    END IF;

    v_sent_item_void_context :=
      public._sent_item_void_context_matches(OLD.id, NULL);

    v_pos_action_context :=
      public._pos_action_context_matches(OLD.id,'pos.payment.take')
      OR public._pos_action_context_matches(OLD.id,'pos.send_kitchen')
      OR public._pos_action_context_matches(OLD.id,'pos.cancel_order');

    IF v_owner_mutation
       AND OLD.cashier_id IS DISTINCT FROM v_uid
       AND NOT v_can_manage_others
       AND NOT v_order_item_transfer_context
       AND NOT v_sent_item_void_context
       AND NOT v_pos_action_context THEN
      RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
    END IF;
    IF NEW.table_id IS DISTINCT FROM OLD.table_id AND NOT public.can_permission('pos.order.transfer') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.transfer';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME='order_items' THEN
    IF TG_OP='INSERT' THEN
      SELECT o.cashier_id,o.branch_id INTO v_owner_id,v_branch_id
      FROM public.orders o WHERE o.id=NEW.order_id;
      IF v_branch_id IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
      IF NOT public.user_may_access_branch(v_branch_id) THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;
      IF v_owner_id IS DISTINCT FROM v_uid AND NOT v_can_manage_others THEN
        RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
      END IF;
      RETURN NEW;
    END IF;

    SELECT o.cashier_id,o.branch_id INTO v_owner_id,v_branch_id
    FROM public.orders o WHERE o.id=OLD.order_id;
    IF v_branch_id IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
    IF NOT public.user_may_access_branch(v_branch_id) THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;

    v_sent_item_void_context :=
      public._sent_item_void_context_matches(OLD.order_id, OLD.id);

    IF TG_OP='UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      v_item_transfer_context :=
        COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),'')=OLD.order_id::text
        AND COALESCE(current_setting('app.pos_item_transfer_target_order_id',true),'')=NEW.order_id::text
        AND public.can_permission('pos.order.transfer');
    END IF;

    IF v_owner_id IS DISTINCT FROM v_uid
       AND NOT v_can_manage_others
       AND NOT v_item_transfer_context
       AND NOT v_sent_item_void_context THEN
      RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
    END IF;

    IF TG_OP='DELETE' THEN RETURN OLD; END IF;

    IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      SELECT o.cashier_id,o.branch_id INTO v_new_owner_id,v_new_branch_id
      FROM public.orders o WHERE o.id=NEW.order_id;
      IF v_new_branch_id IS NULL THEN RAISE EXCEPTION 'TARGET_ORDER_NOT_FOUND'; END IF;
      IF v_new_branch_id IS DISTINCT FROM v_branch_id THEN RAISE EXCEPTION 'CROSS_BRANCH_ORDER_ITEM_MOVE'; END IF;
      IF v_new_owner_id IS DISTINCT FROM v_uid AND NOT v_can_manage_others AND NOT v_item_transfer_context THEN
        RAISE EXCEPTION 'TARGET_ORDER_OPERATOR_REQUIRED';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME='dining_tables' THEN
    v_table_item_transfer_context :=
      (
        COALESCE(current_setting('app.pos_item_transfer_source_table_id',true),'')=OLD.id::text
        OR COALESCE(current_setting('app.pos_item_transfer_target_table_id',true),'')=OLD.id::text
      )
      AND COALESCE(current_setting('app.pos_item_transfer_branch_id',true),'')=OLD.branch_id::text
      AND public.can_permission('pos.order.transfer');

    v_sent_item_void_context := EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.table_id = OLD.id
        AND COALESCE(current_setting('app.sent_item_void_order_id',true),'') = o.id::text
        AND public._sent_item_void_context_matches(o.id, NULL)
    );

    IF TG_OP='DELETE' THEN
      IF NOT v_can_manage_others
         AND NOT v_table_item_transfer_context
         AND NOT v_sent_item_void_context
         AND EXISTS(
           SELECT 1 FROM public.orders o
           WHERE o.table_id=OLD.id AND o.status IN('open','held')
             AND o.cashier_id IS DISTINCT FROM v_uid
         ) THEN
        RAISE EXCEPTION 'TABLE_OPERATOR_REQUIRED';
      END IF;
      RETURN OLD;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      IF NOT v_can_manage_others
         AND NOT v_table_item_transfer_context
         AND NOT v_sent_item_void_context
         AND EXISTS(
           SELECT 1 FROM public.orders o
           WHERE o.table_id=OLD.id AND o.status IN('open','held')
             AND o.cashier_id IS DISTINCT FROM v_uid
         ) THEN
        RAISE EXCEPTION 'TABLE_OPERATOR_REQUIRED';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
