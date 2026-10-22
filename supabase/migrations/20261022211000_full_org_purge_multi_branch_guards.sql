-- Scoped bypass for an authenticated, independent Super Admin deleting one tenant.
-- The marker contains ONLY the locked branch IDs selected by the full purge RPC.
-- All other users and ordinary operational DELETEs retain existing protections.

CREATE OR REPLACE FUNCTION private.authorized_full_tenant_purge_branch(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private','pg_temp'
AS $fn$
  SELECT p_branch_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND public.is_super_admin()
    AND p_branch_id::text = ANY(string_to_array(COALESCE(current_setting('app.full_org_purge_branch_ids',true),''),','));
$fn$;
REVOKE ALL ON FUNCTION private.authorized_full_tenant_purge_branch(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION private.authorized_full_tenant_purge_branch(uuid)
IS 'Internal scope check for authorized full organization deletion. Normal POS protections remain enforced.';

-- Preserve all existing business-operation guards outside the protected purge.
CREATE OR REPLACE FUNCTION private.guard_default_dining_area_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP='DELETE' AND private.authorized_full_tenant_purge_branch(OLD.branch_id) THEN
    RETURN OLD;
  END IF;
  IF OLD.is_default
     AND current_setting('app.branch_hard_delete_id', true) IS DISTINCT FROM OLD.branch_id::text THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'DEFAULT_DINING_AREA_FIXED',
      DETAIL = 'Main Area is system-managed and cannot be deleted.';
  END IF;
  RETURN OLD;
END;
$fn$;

-- Preserve all existing business-operation guards outside the protected purge.
CREATE OR REPLACE FUNCTION private.guard_default_dining_table_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP='DELETE' AND private.authorized_full_tenant_purge_branch(OLD.branch_id) THEN
    RETURN OLD;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.dining_areas a
    WHERE a.id = OLD.area_id
      AND a.branch_id = OLD.branch_id
      AND a.is_default
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'DEFAULT_DINING_TABLE_FIXED',
      DETAIL = 'The 50 Main Area tables are system-managed and cannot be deleted.';
  END IF;
  RETURN OLD;
END;
$fn$;

-- Preserve all existing business-operation guards outside the protected purge.
CREATE OR REPLACE FUNCTION public._protect_modifier_option_open_order_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP='DELETE' AND private.authorized_full_tenant_purge_branch(OLD.branch_id) THEN
    RETURN OLD;
  END IF;
  IF OLD.branch_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = OLD.branch_id) THEN
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.status IN ('open', 'held')
      AND OLD.id = ANY(COALESCE(oi.modifier_option_ids, ARRAY[]::uuid[]))
  ) THEN
    RAISE EXCEPTION 'MODIFIER_OPTION_IN_OPEN_ORDER';
  END IF;
  RETURN OLD;
END;
$fn$;

-- Preserve all existing business-operation guards outside the protected purge.
CREATE OR REPLACE FUNCTION public.guard_sent_order_item_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
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
$fn$;

-- Preserve all existing business-operation guards outside the protected purge.
CREATE OR REPLACE FUNCTION public.guard_table_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP='DELETE' AND private.authorized_full_tenant_purge_branch(OLD.branch_id) THEN
    RETURN OLD;
  END IF;
  IF OLD.branch_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = OLD.branch_id) THEN
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE table_id = OLD.id AND status IN ('open', 'held')
  ) THEN
    RAISE EXCEPTION 'Cannot delete a table with open orders.';
  END IF;
  RETURN OLD;
END;
$fn$;

-- Preserve all existing business-operation guards outside the protected purge.
CREATE OR REPLACE FUNCTION public.protect_system_accounts()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP='DELETE' AND private.authorized_full_tenant_purge_branch(OLD.branch_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' AND OLD.is_system THEN
    IF OLD.branch_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = OLD.branch_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'SYSTEM_ACCOUNT_PROTECTED: % (%)', OLD.code, OLD.name;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.is_system THEN
    IF NEW.code IS DISTINCT FROM OLD.code OR NEW.account_type IS DISTINCT FROM OLD.account_type THEN
      RAISE EXCEPTION 'SYSTEM_ACCOUNT_PROTECTED: % (%)', OLD.code, OLD.name;
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    NEW.name := btrim(NEW.name);
    IF NEW.name = '' THEN RAISE EXCEPTION 'ACCOUNT_NAME_REQUIRED'; END IF;
    NEW.code := upper(btrim(NEW.code));
    IF NEW.code = '' THEN RAISE EXCEPTION 'ACCOUNT_CODE_REQUIRED'; END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$fn$;

-- Enable the marker only after authorization, confirmation and preflight.
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
  PERFORM set_config('app.full_org_purge_branch_ids',array_to_string(v_branches,','),true);

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
  -- Empty/sent kitchen references are tenant-owned and must be removed
  -- before the orders cascade through sent-item protection checks.
  DELETE FROM public.order_kitchen_inventory_events WHERE branch_id=ANY(v_branches);
  DELETE FROM public.order_kitchen_sends WHERE branch_id=ANY(v_branches);
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

  PERFORM set_config('app.full_org_purge_branch_ids','',true);
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
