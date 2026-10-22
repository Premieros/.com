-- Restore safe tenant deletion while retaining immutable ledger evidence protections.
-- No data is deleted when this migration is installed.
CREATE OR REPLACE FUNCTION private.authorized_full_tenant_purge_evidence(p_organization_id uuid,p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','private','public','pg_temp'
AS $fn$
  SELECT p_organization_id IS NOT NULL AND p_branch_id IS NOT NULL
    AND auth.uid() IS NOT NULL AND public.is_super_admin()
    AND current_setting('app.full_org_purge_org_id',true)=p_organization_id::text
    AND private.authorized_full_tenant_purge_branch(p_branch_id)
    AND EXISTS (SELECT 1 FROM public.branches b
                WHERE b.id=p_branch_id AND b.organization_id=p_organization_id);
$fn$;
REVOKE ALL ON FUNCTION private.authorized_full_tenant_purge_evidence(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.deny_organization_journal_evidence_mutation_v2()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog','private','public','pg_temp'
AS $fn$
BEGIN
  IF TG_OP='DELETE'
    AND private.authorized_full_tenant_purge_evidence(OLD.organization_id, OLD.branch_id)
  THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'PHASE5L_IMMUTABLE_LEDGER_EVIDENCE';
END;
$fn$;

CREATE OR REPLACE FUNCTION private.block_erp_domain_receipt_changes_v2()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog','private','public','pg_temp'
AS $fn$
BEGIN
  IF TG_OP='DELETE'
    AND private.authorized_full_tenant_purge_evidence(OLD.organization_id, OLD.branch_id)
  THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'PHASE8B_IMMUTABLE_DELIVERY_RECEIPT';
END;
$fn$;

-- Existing purge still validates exact org ID and name, phrase, Super Admin,
-- and atomically deletes tenant-owned records while retaining other tenants.
CREATE OR REPLACE FUNCTION public.super_admin_delete_organization(p_organization_id uuid, p_confirm_name text, p_confirm_phrase text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
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
  PERFORM set_config('app.full_org_purge_org_id',p_organization_id::text,true);

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

  PERFORM set_config('app.full_org_purge_org_id','',true);
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
$function$;
