-- Anonymous trial registration repair: restricted tenant bootstrap plus true trial entitlements.
-- This does not grant general anonymous POS write privileges.

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
BEGIN
  -- Only permit canonical default dining-table provisioning during a newly
  -- registered anonymous tenant's branch bootstrap. All regular POS actions
  -- remain subject to an authenticated operator and permission checks.
  IF TG_TABLE_NAME='dining_tables' AND TG_OP='INSERT'
     AND v_uid IS NULL AND current_setting('app.register_branch',true)='on'
     AND NEW.name ~ '^Table (0[1-9]|[1-4][0-9]|50)$'
     AND EXISTS (SELECT 1 FROM public.dining_areas a
                 WHERE a.id=NEW.area_id AND a.branch_id=NEW.branch_id AND a.is_default)
     AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.branch_id=NEW.branch_id)
  THEN RETURN NEW; END IF;

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
$function$
;

CREATE OR REPLACE FUNCTION public.register_tenant(p_store_name text, p_owner_name text, p_email text, p_password text, p_store_name_en text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_currency text DEFAULT 'EGP'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_branch_id uuid;
  v_warehouse_id uuid;
  v_user_id uuid;
  v_email text;
  v_global_tax numeric(5,2);
  v_global_tax_enabled boolean;
  v_global_currency text;
  v_res jsonb;
  v_slug text;
BEGIN
  v_email := lower(btrim(p_email));

  IF v_email = '' OR v_email !~ '@' OR v_email !~ '\.' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_EMAIL');
  END IF;
  IF p_password IS NULL OR length(p_password) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'WEAK_PASSWORD');
  END IF;
  IF btrim(coalesce(p_store_name, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_STORE_NAME');
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email)
     OR EXISTS (SELECT 1 FROM public.users WHERE email = v_email) THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMAIL_TAKEN');
  END IF;

  v_org_id := gen_random_uuid();
  v_slug := 'org-' || replace(v_org_id::text, '-', '');

  PERFORM set_config('app.register_branch', 'on', true);

  INSERT INTO public.organizations (id, name, slug, is_active)
  VALUES (v_org_id, p_store_name, v_slug, true);

  INSERT INTO public.branches (name, name_en, address, phone, is_active, organization_id)
  VALUES (p_store_name, p_store_name_en, p_address, p_phone, true, v_org_id)
  RETURNING id INTO v_branch_id;

  INSERT INTO public.warehouses (name, branch_id, is_active)
  VALUES (p_store_name || ' - Main', v_branch_id, true)
  RETURNING id INTO v_warehouse_id;

  SELECT COALESCE(tax_rate, 15), COALESCE(tax_enabled, true), COALESCE(currency, 'EGP')
  INTO v_global_tax, v_global_tax_enabled, v_global_currency
  FROM public.settings ORDER BY id LIMIT 1;

  INSERT INTO public.branch_settings (branch_id, tax_rate, tax_enabled, currency, low_stock_threshold)
  VALUES (
    v_branch_id,
    v_global_tax,
    v_global_tax_enabled,
    COALESCE(NULLIF(btrim(p_currency), ''), v_global_currency),
    10
  );

  INSERT INTO public.branch_subscriptions (branch_id, status, trial_starts_at, trial_ends_at)
  VALUES (v_branch_id, 'trial', now(), now() + interval '14 days');

  INSERT INTO public.subscriptions
    (tenant_id,plan_id,status,trial_started_at,trial_ends_at,current_period_start,current_period_end,auto_renew)
  SELECT v_org_id,p.id,'trialing',now(),now()+interval '14 days',
         now(),now()+interval '14 days',false
  FROM public.plans p WHERE p.slug='free' AND p.is_active=true
  ORDER BY p.display_order,p.id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRIAL_PLAN_UNAVAILABLE'; END IF;

  v_res := public.create_user(
    v_email,
    p_password,
    p_owner_name,
    'owner',
    v_branch_id,
    true,
    NULL
  );
  PERFORM set_config('app.register_branch', 'off', true);

  IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'USER_CREATE_FAILED: %', COALESCE(v_res->>'error', 'UNKNOWN');
  END IF;

  v_user_id := (v_res->>'user_id')::uuid;

  INSERT INTO public.organization_members (
    organization_id, user_id, membership_role, is_active
  ) VALUES (
    v_org_id, v_user_id, 'owner', true
  );

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_org_id,
    'branch_id', v_branch_id,
    'warehouse_id', v_warehouse_id,
    'user_id', v_user_id,
    'membership_role', 'owner',
    'trial_days', 14
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'TENANT_REGISTRATION_FAILED', 'detail', SQLERRM);
END;
$function$
;

REVOKE ALL ON FUNCTION public.register_tenant(text,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION public.register_trial_tenant(text,text,text,text,text,text,text,text,text) FROM PUBLIC,authenticated;

GRANT EXECUTE ON FUNCTION public.register_trial_tenant(text,text,text,text,text,text,text,text,text) TO anon;
