-- Tenant isolation: a tenant owner controls every branch of their own organization,
-- never a branch belonging to a different organization.
-- Do not change super_admin platform-wide authorization.

CREATE OR REPLACE FUNCTION public.owner_organization_id(p_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $fn$
  SELECT b.organization_id FROM public.users u
  JOIN public.branches b ON b.id=u.branch_id
  WHERE u.id=p_user_id AND u.role='owner' AND u.is_active
  LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.owner_organization_id(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Existing stray owner grants are invalid regardless of how they were created.
DELETE FROM public.user_branch_access a
USING public.users u, public.branches granted, public.branches home
WHERE a.user_id=u.id AND u.role='owner'
 AND home.id=u.branch_id AND granted.id=a.branch_id
 AND granted.organization_id IS DISTINCT FROM home.organization_id;

CREATE OR REPLACE FUNCTION private.guard_owner_branch_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_owner_org uuid; v_target_org uuid;
BEGIN
  SELECT b.organization_id INTO v_owner_org FROM public.users u
  JOIN public.branches b ON b.id=u.branch_id
  WHERE u.id=NEW.user_id AND u.role='owner';
  IF FOUND THEN
    SELECT b.organization_id INTO v_target_org FROM public.branches b WHERE b.id=NEW.branch_id;
    IF v_owner_org IS NULL OR v_target_org IS DISTINCT FROM v_owner_org THEN
      RAISE EXCEPTION 'OWNER_CROSS_ORGANIZATION_BRANCH_ACCESS_FORBIDDEN' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_guard_owner_branch_access ON public.user_branch_access;
CREATE TRIGGER trg_guard_owner_branch_access
BEFORE INSERT OR UPDATE ON public.user_branch_access
FOR EACH ROW EXECUTE FUNCTION private.guard_owner_branch_access();

-- Make the branch authorization function organization aware for tenant owners.
-- Other roles retain their existing explicit branch grants.
CREATE OR REPLACE FUNCTION public.user_may_access_branch(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $fn$
  SELECT public.is_pos_admin()
  OR EXISTS (
    SELECT 1 FROM public.users u JOIN public.branches home ON home.id=u.branch_id
    JOIN public.branches requested ON requested.id=p_branch_id
    WHERE u.id=auth.uid() AND u.is_active AND u.role='owner'
      AND requested.organization_id=home.organization_id
  )
  OR EXISTS (
    SELECT 1 FROM public.user_branch_access a
    JOIN public.users u ON u.id=a.user_id
    JOIN public.branches granted ON granted.id=a.branch_id
    JOIN public.branches home ON home.id=u.branch_id
    WHERE a.user_id=auth.uid() AND a.branch_id=p_branch_id AND u.is_active
      AND (u.role<>'owner' OR granted.organization_id=home.organization_id)
  )
  OR EXISTS (
    SELECT 1 FROM public.users u WHERE u.id=auth.uid() AND u.is_active AND u.branch_id=p_branch_id
  );
$fn$;

-- Owner sees all its own branches without requiring individual grants. Other
-- users must keep their existing branch-level permissions.
DROP POLICY IF EXISTS auth_select_branches ON public.branches;
CREATE POLICY auth_select_branches ON public.branches
FOR SELECT TO authenticated
USING (public.is_platform_admin() OR public.user_may_access_branch(id));

-- Tenant owner may update its own organization's metadata independently of
-- stale organization_members rows. Management still requires settings.manage.
DROP POLICY IF EXISTS organizations_update ON public.organizations;
CREATE POLICY organizations_update ON public.organizations
FOR UPDATE TO authenticated
USING (
  public.is_pos_admin() OR
  (public.can_permission('settings.manage') AND public.user_can_access_organization(id))
)
WITH CHECK (
  public.is_pos_admin() OR
  (public.can_permission('settings.manage') AND public.user_can_access_organization(id))
);
