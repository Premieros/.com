-- Safely guard anonymous bootstrap access to the dining_tables trigger ONLY.
-- The previous Boolean expression dereferenced NEW.name on unrelated orders rows.
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
  IF TG_TABLE_NAME='dining_tables' AND TG_OP IN ('INSERT','UPDATE') THEN
    IF v_uid IS NULL AND current_setting('app.register_branch',true)='on'
       AND NEW.name ~ '^Table (0[1-9]|[1-4][0-9]|50)

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

-- Keep the full purge atomic, but include internal PG error reasons in operator logs.
-- API clients still receive only DELETE_BLOCKED_ATOMICALLY, never raw SQL.
CREATE OR REPLACE FUNCTION public.super_admin_delete_organization(
  p_organization_id uuid,p_confirm_name text,p_confirm_phrase text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $fn$
DECLARE
  v_org public.organizations%ROWTYPE;
  v_preflight jsonb;
  v_branches uuid[];
  v_users uuid[];
  v_user_count integer;
  v_auth_count integer;
  v_nbranches integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success',false,'error','SUPER_ADMIN_REQUIRED');
  END IF;
  IF p_organization_id IS NULL OR p_confirm_phrase IS DISTINCT FROM 'DELETE' THEN
    RETURN jsonb_build_object('success',false,'error','CONFIRMATION_REQUIRED');
  END IF;
  SELECT * INTO v_org FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','ORGANIZATION_NOT_FOUND'); END IF;
  IF v_org.name IS DISTINCT FROM p_confirm_name THEN
    RETURN jsonb_build_object('success',false,'error','ORGANIZATION_NAME_MISMATCH');
  END IF;

  -- Snapshot and lock tenant scope to avoid races with tenant writers.
  SELECT COALESCE(array_agg(id),'{}'::uuid[]) INTO v_branches
    FROM public.branches WHERE organization_id=p_organization_id;
  PERFORM 1 FROM public.branches WHERE id=ANY(v_branches) FOR UPDATE;
  SELECT COALESCE(array_agg(id),'{}'::uuid[]) INTO v_users
    FROM public.users WHERE branch_id=ANY(v_branches) AND role<>'super_admin';
  PERFORM 1 FROM public.users WHERE id=ANY(v_users) FOR UPDATE;

  v_preflight:=private.organization_full_deletion_preflight(p_organization_id);
  IF NOT COALESCE((v_preflight->>'eligible')::boolean,false) THEN
    RETURN jsonb_build_object('success',false,'error','CROSS_ORGANIZATION_DEPENDENCIES','preview',v_preflight);
  END IF;
  v_nbranches:=(v_preflight->>'branches')::integer;
  v_user_count:=(v_preflight->>'users')::integer;

  -- Remove REFERENCES NO ACTION / RESTRICT that would block normal
  -- ON DELETE CASCADE from the selected organization. All predicates are
  -- organization- or branch-scoped and never include global Super Admin IDs.
  DELETE FROM private.erp_domain_event_receipts_v2
    WHERE organization_id=p_organization_id OR branch_id=ANY(v_branches);
  DELETE FROM private.erp_domain_outbox_v2
    WHERE organization_id=p_organization_id OR branch_id=ANY(v_branches);
  DELETE FROM private.organization_journal_line_evidence_v2
    WHERE organization_id=p_organization_id OR branch_id=ANY(v_branches);
  DELETE FROM private.organization_account_sync_requests_v2
    WHERE organization_id=p_organization_id OR branch_id=ANY(v_branches);
  DELETE FROM private.pos_sale_idempotency WHERE branch_id=ANY(v_branches);
  DELETE FROM public.raw_fifo_orphan_sale_cogs_adjustments WHERE branch_id=ANY(v_branches);
  DELETE FROM public.raw_opening_cost_repair_plan WHERE branch_id=ANY(v_branches);
  DELETE FROM public.raw_opening_cost_repair_runs WHERE branch_id=ANY(v_branches);
  DELETE FROM public.employee_receivable_entries WHERE branch_id=ANY(v_branches);
  DELETE FROM public.sale_print_events WHERE branch_id=ANY(v_branches);
  DELETE FROM public.warehouse_transfers WHERE branch_id=ANY(v_branches);
  DELETE FROM public.order_kitchen_voids WHERE branch_id=ANY(v_branches);
  DELETE FROM public.approval_requests WHERE branch_id=ANY(v_branches);
  DELETE FROM public.support_conversations WHERE organization_id=p_organization_id;

  -- Scoped child records must be removed before users/customers are cascaded:
  -- PostgreSQL RESTRICT prevents relying on branch CASCADE for every table.
  DELETE FROM public.customers WHERE branch_id=ANY(v_branches);

  -- Cascade handles all other scoped children of orgs and branches.
  -- Remaining FK checks protect any missed/new dependency.
  DELETE FROM public.organizations WHERE id=p_organization_id;

  -- Deleting the org cascades only its local application user profiles.
  -- Remove their login identities; GLOBAL Super Admins are excluded.
  DELETE FROM auth.sessions WHERE user_id=ANY(v_users);
  DELETE FROM auth.identities WHERE user_id=ANY(v_users);
  DELETE FROM auth.users WHERE id=ANY(v_users);
  GET DIAGNOSTICS v_auth_count=ROW_COUNT;

  INSERT INTO private.organization_deletion_receipts
    (organization_id,organization_name,branch_count,
     application_user_count,auth_accounts_deleted,requested_by)
  VALUES (p_organization_id,v_org.name,v_nbranches,v_user_count,v_auth_count,auth.uid());

  RETURN jsonb_build_object('success',true,'deleted',true,
    'organization_id',p_organization_id,'branches',v_nbranches,
    'users',v_user_count,'auth_accounts_deleted',v_auth_count,
    'super_admin_accounts_preserved',true);
EXCEPTION WHEN OTHERS THEN
  -- Entire function body runs in a subtransaction. Roll back all deletes,
  -- surface a generic error, and never leave a half-deleted organization.
  RAISE WARNING 'Full organization delete aborted (sqlstate: %, reason: %)',SQLSTATE,SQLERRM;
  RETURN jsonb_build_object('success',false,'error','DELETE_BLOCKED_ATOMICALLY');
END;
$fn$;


