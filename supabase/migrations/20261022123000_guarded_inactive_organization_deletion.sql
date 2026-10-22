-- Super Admin only: irreversible deletion of INACTIVE organizations with NO operational history.
-- Scoped, transactional, and fail-closed. Does not permit purging accounting/sales history.
-- Do NOT use this for a currently operating organization; use Disable instead.

CREATE TABLE IF NOT EXISTS private.organization_deletion_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  organization_name text NOT NULL,
  branch_count integer NOT NULL,
  application_user_count integer NOT NULL,
  auth_accounts_deleted integer NOT NULL,
  requested_by uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.organization_deletion_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.organization_deletion_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.organization_deletion_preflight(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $fn$
DECLARE
  v_org public.organizations%ROWTYPE;
  v_branch_ids uuid[];
  v_user_ids uuid[];
  v_branches int;
  v_users int;
  v_history bigint;
  v_blockers jsonb := '[]'::jsonb;
  v_fk record;
  v_dependency bigint;
  v_parent text;
  v_eligible boolean;
BEGIN
  SELECT * INTO v_org FROM public.organizations WHERE id = p_organization_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','ORGANIZATION_NOT_FOUND');
  END IF;

  SELECT COALESCE(array_agg(b.id),'{}'::uuid[]),count(*)::int
  INTO v_branch_ids,v_branches
  FROM public.branches b WHERE b.organization_id=p_organization_id;

  SELECT COALESCE(array_agg(u.id),'{}'::uuid[]),count(*)::int
  INTO v_user_ids,v_users
  FROM public.users u WHERE u.branch_id=ANY(v_branch_ids);

  SELECT (
    (SELECT count(*) FROM public.sales s WHERE s.branch_id=ANY(v_branch_ids)) +
    (SELECT count(*) FROM public.orders o WHERE o.branch_id=ANY(v_branch_ids)) +
    (SELECT count(*) FROM public.purchases p WHERE p.branch_id=ANY(v_branch_ids)) +
    (SELECT count(*) FROM public.purchase_receipts r WHERE r.branch_id=ANY(v_branch_ids)) +
    (SELECT count(*) FROM public.journal_entries j WHERE j.branch_id=ANY(v_branch_ids)) +
    (SELECT count(*) FROM public.inventory_ledger i WHERE i.branch_id=ANY(v_branch_ids)) +
    (SELECT count(*) FROM public.expenses e WHERE e.branch_id=ANY(v_branch_ids)) +
    (SELECT count(*) FROM public.stock_counts c WHERE c.branch_id=ANY(v_branch_ids)) +
    (SELECT count(*) FROM public.production_orders p WHERE p.branch_id=ANY(v_branch_ids)) +
    (SELECT count(*) FROM public.supplier_payments p WHERE p.branch_id=ANY(v_branch_ids)) +
    (SELECT count(*) FROM public.customer_payments p WHERE p.branch_id=ANY(v_branch_ids)) +
    (SELECT count(*) FROM public.treasury_transactions t WHERE t.branch_id=ANY(v_branch_ids)
       OR t.organization_id=p_organization_id)
  ) INTO v_history;

  IF v_org.is_active THEN
    v_blockers := v_blockers || jsonb_build_array('ORGANIZATION_ACTIVE');
  END IF;

  IF (SELECT count(*) FROM public.organizations) <= 1 THEN
    v_blockers := v_blockers || jsonb_build_array('LAST_ORGANIZATION');
  END IF;

  IF auth.uid() = ANY(v_user_ids) THEN
    v_blockers := v_blockers || jsonb_build_array('CURRENT_USER_BELONGS_TO_ORGANIZATION');
  END IF;

  IF EXISTS (SELECT 1 FROM public.users u WHERE u.id=ANY(v_user_ids) AND u.role='super_admin') THEN
    v_blockers := v_blockers || jsonb_build_array('PROTECTED_SUPER_ADMIN_USER');
  END IF;

  IF EXISTS (SELECT 1 FROM public.organization_members m
             WHERE m.user_id=ANY(v_user_ids) AND m.organization_id<>p_organization_id)
     OR EXISTS (SELECT 1 FROM public.organization_members m
                WHERE m.organization_id=p_organization_id AND m.user_id<>ALL(v_user_ids)) THEN
    v_blockers := v_blockers || jsonb_build_array('SHARED_ORGANIZATION_MEMBER');
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_branch_access a
             WHERE a.user_id=ANY(v_user_ids) AND a.branch_id<>ALL(v_branch_ids)) THEN
    v_blockers := v_blockers || jsonb_build_array('USER_WITH_CROSS_ORGANIZATION_BRANCH_ACCESS');
  END IF;

  IF EXISTS (SELECT 1 FROM public.warehouse_transfers t
             WHERE ((t.branch_id=ANY(v_branch_ids)) <> (t.to_branch_id=ANY(v_branch_ids)))) THEN
    v_blockers := v_blockers || jsonb_build_array('CROSS_ORGANIZATION_STOCK_TRANSFER');
  END IF;

  IF v_history > 0 THEN
    v_blockers := v_blockers || jsonb_build_array('OPERATIONAL_HISTORY_PRESENT');
  END IF;

  -- Check every direct NO ACTION/RESTRICT reference to org, branch, and users.
  -- This automatically picks up new FK blockers; we refuse rather than
  -- disable constraints, bypass referential integrity or wipe unrelated rows.
  FOR v_fk IN
    SELECT c.conrelid::regclass AS child_table, a.attname AS child_column,
           c.confrelid::regclass::text AS parent_table
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    WHERE c.contype='f'
      AND c.confdeltype IN ('a','r')
      AND array_length(c.conkey,1)=1
      AND c.confrelid IN (
        'public.organizations'::regclass,
        'public.branches'::regclass,
        'public.users'::regclass
      )
  LOOP
    v_parent := v_fk.parent_table;
    IF v_parent='organizations' THEN
      EXECUTE format('SELECT count(*) FROM %s WHERE %I=$1', v_fk.child_table,v_fk.child_column)
        INTO v_dependency USING p_organization_id;
    ELSIF v_parent='branches' THEN
      EXECUTE format('SELECT count(*) FROM %s WHERE %I=ANY($1)',v_fk.child_table,v_fk.child_column)
        INTO v_dependency USING v_branch_ids;
    ELSE
      EXECUTE format('SELECT count(*) FROM %s WHERE %I=ANY($1)',v_fk.child_table,v_fk.child_column)
        INTO v_dependency USING v_user_ids;
    END IF;
    IF v_dependency > 0 THEN
      v_blockers := v_blockers || jsonb_build_array(
        jsonb_build_object('code','RESTRICTED_DEPENDENCY',
          'table',v_fk.child_table::text,'count',v_dependency));
    END IF;
  END LOOP;

  v_eligible := jsonb_array_length(v_blockers)=0;
  RETURN jsonb_build_object(
    'success',true,'eligible',v_eligible,'organization_id',v_org.id,
    'organization_name',v_org.name,'is_active',v_org.is_active,
    'branches',v_branches,'users',v_users,
    'operational_documents',v_history,'blockers',v_blockers,
    'note','Only inactive organizations without operational history are eligible.'
  );
END;
$fn$;

REVOKE ALL ON FUNCTION private.organization_deletion_preflight(uuid)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.super_admin_preview_organization_deletion(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success',false,'error','SUPER_ADMIN_REQUIRED');
  END IF;
  RETURN private.organization_deletion_preflight(p_organization_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.super_admin_delete_empty_organization(
  p_organization_id uuid, p_confirm_name text, p_confirm_phrase text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $fn$
DECLARE
  v_org public.organizations%ROWTYPE;
  v_preflight jsonb;
  v_user_ids uuid[];
  v_auth_deleted integer;
  v_branch_count integer;
  v_user_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success',false,'error','SUPER_ADMIN_REQUIRED');
  END IF;
  IF p_organization_id IS NULL OR p_confirm_phrase IS DISTINCT FROM 'DELETE' THEN
    RETURN jsonb_build_object('success',false,'error','CONFIRMATION_REQUIRED');
  END IF;

  -- Lock the chosen org: concurrent FK inserts (new branches/members) must wait.
  SELECT * INTO v_org FROM public.organizations
  WHERE id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','ORGANIZATION_NOT_FOUND');
  END IF;
  IF p_confirm_name IS DISTINCT FROM v_org.name THEN
    RETURN jsonb_build_object('success',false,'error','ORGANIZATION_NAME_MISMATCH');
  END IF;

  v_preflight := private.organization_deletion_preflight(p_organization_id);
  IF NOT COALESCE((v_preflight->>'eligible')::boolean,false) THEN
    RETURN jsonb_build_object('success',false,'error','DELETION_NOT_SAFE','preview',v_preflight);
  END IF;

  SELECT COALESCE(array_agg(u.id),'{}'::uuid[]) INTO v_user_ids
  FROM public.users u JOIN public.branches b ON b.id=u.branch_id
  WHERE b.organization_id=p_organization_id;
  v_branch_count := (v_preflight->>'branches')::integer;
  v_user_count := (v_preflight->>'users')::integer;

  -- One database transaction for deletion of organization, its ON DELETE
  -- CASCADE child records, and exclusive application/auth identities.
  -- Any FK error rolls back the entire operation: no partial data purge.
  DELETE FROM public.organizations WHERE id=p_organization_id;

  DELETE FROM auth.sessions WHERE user_id=ANY(v_user_ids);
  DELETE FROM auth.identities WHERE user_id=ANY(v_user_ids);
  DELETE FROM auth.users WHERE id=ANY(v_user_ids);
  GET DIAGNOSTICS v_auth_deleted=ROW_COUNT;

  INSERT INTO private.organization_deletion_receipts(
    organization_id,organization_name,branch_count,
    application_user_count,auth_accounts_deleted,requested_by
  ) VALUES(p_organization_id,v_org.name,v_branch_count,
           v_user_count,v_auth_deleted,auth.uid());

  RETURN jsonb_build_object('success',true,'deleted',true,
    'organization_id',p_organization_id,'branches',v_branch_count,
    'users',v_user_count,'auth_accounts_deleted',v_auth_deleted);
EXCEPTION WHEN OTHERS THEN
  -- All mutations in this block are rolled back, including cascade deletes.
  RAISE WARNING 'Organization deletion aborted. SQLSTATE: %',SQLSTATE;
  RETURN jsonb_build_object('success',false,'error','DELETE_BLOCKED_ATOMICALLY');
END;
$fn$;

REVOKE ALL ON FUNCTION public.super_admin_preview_organization_deletion(uuid),
  public.super_admin_delete_empty_organization(uuid,text,text)
  FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.super_admin_preview_organization_deletion(uuid),
  public.super_admin_delete_empty_organization(uuid,text,text)
  TO authenticated,service_role;

COMMENT ON FUNCTION public.super_admin_delete_empty_organization(uuid,text,text)
IS 'Super Admin gated hard-delete for disabled, dependency-free orgs. Refuses posted transactions; preserves all other organizations. Deletes dedicated auth identities in the same transaction.';
