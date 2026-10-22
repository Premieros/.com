-- Global Super Admin identities + explicit full tenant purge.
-- Removes ALL data belonging to the selected organization, including ledger history,
-- only after deliberate Super Admin confirmation. Other tenants and Super Admin auth
-- accounts are preserved. Do not use this RPC for routine test fixture cleanup.

-- A Super Admin is a GLOBAL platform user, not an organization/branch member.
ALTER TABLE public.users ALTER COLUMN branch_id DROP NOT NULL;
-- Historical Super Admin accounts were attached to tenant branches only because
-- branch_id was required. Unlink without recreating accounts or touching auth.users.
SELECT set_config('app.register_branch','on',true);
UPDATE public.users SET branch_id=NULL WHERE role='super_admin' AND branch_id IS NOT NULL;
DELETE FROM public.organization_members m USING public.users u
WHERE m.user_id=u.id AND u.role='super_admin';
DELETE FROM public.user_branch_access a USING public.users u
WHERE a.user_id=u.id AND u.role='super_admin';

CREATE OR REPLACE FUNCTION private.ensure_global_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  IF NEW.role='super_admin' THEN NEW.branch_id:=NULL; END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_01_global_super_admin ON public.users;
CREATE TRIGGER trg_01_global_super_admin
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION private.ensure_global_super_admin();
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_super_admin_global_scope_check;
ALTER TABLE public.users ADD CONSTRAINT users_super_admin_global_scope_check
CHECK ((role='super_admin' AND branch_id IS NULL) OR (role<>'super_admin' AND branch_id IS NOT NULL));
COMMENT ON COLUMN public.users.branch_id IS 'Nullable ONLY for global Super Admin. Tenant user accounts must have a branch.';

-- Do not move an existing Super Admin back to a tenant during bootstrap.
-- Legacy bootstrap with explicit branch_id is normalized by the above trigger.

CREATE OR REPLACE FUNCTION private.organization_full_deletion_preflight(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $fn$
DECLARE
  v_org public.organizations%ROWTYPE;
  v_branches uuid[];
  v_users uuid[];
  v_nbranches integer;
  v_nusers integer;
  v_nadmins integer;
  v_docs bigint;
  v_blockers jsonb:='[]'::jsonb;
  v_fk record;
  v_count bigint;
  v_filter text;
  v_scope text;
BEGIN
  SELECT * INTO v_org FROM public.organizations WHERE id=p_organization_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','ORGANIZATION_NOT_FOUND'); END IF;

  SELECT COALESCE(array_agg(b.id),'{}'::uuid[]),count(*)::int INTO v_branches,v_nbranches
  FROM public.branches b WHERE b.organization_id=p_organization_id;
  SELECT COALESCE(array_agg(u.id),'{}'::uuid[]),count(*)::int INTO v_users,v_nusers
  FROM public.users u WHERE u.branch_id=ANY(v_branches) AND u.role<>'super_admin';
  SELECT count(*)::int INTO v_nadmins FROM public.users WHERE role='super_admin';

  SELECT (
    (SELECT count(*) FROM public.sales WHERE branch_id=ANY(v_branches))+
    (SELECT count(*) FROM public.orders WHERE branch_id=ANY(v_branches))+
    (SELECT count(*) FROM public.purchases WHERE branch_id=ANY(v_branches))+
    (SELECT count(*) FROM public.journal_entries WHERE branch_id=ANY(v_branches))+
    (SELECT count(*) FROM public.inventory_ledger WHERE branch_id=ANY(v_branches))+
    (SELECT count(*) FROM public.support_conversations WHERE organization_id=p_organization_id)
  ) INTO v_docs;

  -- Only cross-tenant references block an otherwise complete purge. Never
  -- delete/update a row of another tenant just to satisfy a foreign key.
  IF EXISTS (SELECT 1 FROM public.organization_members m
      WHERE m.organization_id=p_organization_id AND m.user_id<>ALL(v_users))
      OR EXISTS (SELECT 1 FROM public.organization_members m
      WHERE m.user_id=ANY(v_users) AND m.organization_id<>p_organization_id)
  THEN v_blockers:=v_blockers||jsonb_build_array('CROSS_ORGANIZATION_MEMBERSHIP'); END IF;

  IF EXISTS (SELECT 1 FROM public.user_branch_access a
       WHERE a.user_id=ANY(v_users) AND a.branch_id<>ALL(v_branches))
  THEN v_blockers:=v_blockers||jsonb_build_array('CROSS_ORGANIZATION_USER_ACCESS'); END IF;

  IF EXISTS (SELECT 1 FROM public.warehouse_transfers t
      WHERE (t.branch_id=ANY(v_branches)) IS DISTINCT FROM (t.to_branch_id=ANY(v_branches))
      AND (t.branch_id=ANY(v_branches) OR t.to_branch_id=ANY(v_branches)))
  THEN v_blockers:=v_blockers||jsonb_build_array('CROSS_ORGANIZATION_WAREHOUSE_TRANSFER'); END IF;

  IF EXISTS (SELECT 1 FROM public.treasury_transactions t
      WHERE t.branch_id<>ALL(v_branches)
        AND (t.from_branch_id=ANY(v_branches) OR t.to_branch_id=ANY(v_branches)))
  THEN v_blockers:=v_blockers||jsonb_build_array('CROSS_ORGANIZATION_TREASURY_TRANSFER'); END IF;

  -- If another tenant owns a row that references a soon-to-be-deleted user,
  -- this preview refuses the purge. Dynamic FK metadata catches new relations.
  FOR v_fk IN
    SELECT c.conrelid::regclass child_table, a.attname child_column,
      EXISTS(SELECT 1 FROM pg_attribute sa WHERE sa.attrelid=c.conrelid
        AND sa.attname='branch_id' AND NOT sa.attisdropped) has_branch,
      EXISTS(SELECT 1 FROM pg_attribute sa WHERE sa.attrelid=c.conrelid
        AND sa.attname='organization_id' AND NOT sa.attisdropped) has_org,
      EXISTS(SELECT 1 FROM pg_attribute sa WHERE sa.attrelid=c.conrelid
        AND sa.attname='tenant_id' AND NOT sa.attisdropped) has_tenant
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    WHERE c.contype='f' AND c.confrelid='public.users'::regclass
      AND array_length(c.conkey,1)=1
      AND c.conrelid NOT IN (
         'public.organization_members'::regclass,
         'public.user_branch_access'::regclass,
         'public.user_kitchen_station_assignments'::regclass
      )
  LOOP
    v_scope := CASE WHEN v_fk.has_branch THEN 'branch_id'
      WHEN v_fk.has_org THEN 'organization_id'
      WHEN v_fk.has_tenant THEN 'tenant_id' ELSE NULL END;
    IF v_scope='branch_id' THEN
      v_filter := format(' AND (branch_id IS NULL OR branch_id<>ALL($2))');
    ELSIF v_scope IS NOT NULL THEN
      v_filter := format(' AND (%I IS NULL OR %I<>$2)',v_scope,v_scope);
    ELSE
      v_filter := '';
    END IF;
    IF v_scope='branch_id' THEN
      EXECUTE format('SELECT count(*) FROM %s WHERE %I=ANY($1)%s',
           v_fk.child_table,v_fk.child_column,v_filter)
      INTO v_count USING v_users,v_branches;
    ELSIF v_scope IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %s WHERE %I=ANY($1)%s',
           v_fk.child_table,v_fk.child_column,v_filter)
      INTO v_count USING v_users,p_organization_id;
    ELSE
      -- Non-scoped user references are ambiguous; never silently purge them.
      EXECUTE format('SELECT count(*) FROM %s WHERE %I=ANY($1)',
           v_fk.child_table,v_fk.child_column)
      INTO v_count USING v_users;
    END IF;
    IF v_count>0 THEN
      v_blockers:=v_blockers||jsonb_build_array(
        jsonb_build_object('code','CROSS_OR_UNSCOPED_USER_REFERENCE',
          'table',v_fk.child_table::text,'count',v_count));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success',true,
    'eligible',jsonb_array_length(v_blockers)=0,
    'organization_id',v_org.id,'organization_name',v_org.name,'is_active',v_org.is_active,
    'branches',v_nbranches,'users',v_nusers,
    'super_admins_preserved',v_nadmins,'operational_documents',v_docs,
    'blockers',v_blockers,
    'note','Full irrevocable tenant purge: branches, users, financial and operational history. Global Super Admin accounts are never targeted.');
END;
$fn$;

REVOKE ALL ON FUNCTION private.organization_full_deletion_preflight(uuid)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.super_admin_preview_organization_deletion(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success',false,'error','SUPER_ADMIN_REQUIRED');
  END IF;
  RETURN private.organization_full_deletion_preflight(p_organization_id);
END;
$fn$;

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
  DELETE FROM public.approval_requests WHERE branch_id=ANY(v_branches);
  DELETE FROM public.order_kitchen_voids WHERE branch_id=ANY(v_branches);
  DELETE FROM public.support_conversations WHERE organization_id=p_organization_id;
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
  RAISE WARNING 'Full organization delete aborted (sqlstate: %)',SQLSTATE;
  RETURN jsonb_build_object('success',false,'error','DELETE_BLOCKED_ATOMICALLY');
END;
$fn$;

REVOKE ALL ON FUNCTION public.super_admin_delete_organization(uuid,text,text)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.super_admin_delete_organization(uuid,text,text)
TO authenticated,service_role;

COMMENT ON FUNCTION public.super_admin_delete_organization(uuid,text,text)
IS 'Irreversible full-organization purge authorized only for independent global Super Admin. Keeps all super_admin identities. Tenant ID is required, and exact name + DELETE confirmation. Refuses cross-org references. Atomic rollback on any error.';
