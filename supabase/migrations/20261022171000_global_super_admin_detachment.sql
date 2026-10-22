-- Super Admin is a platform identity, not a tenant membership or tenant branch user.
-- Owner remains tenant-scoped and is never promoted to platform admin.

ALTER TABLE public.users ALTER COLUMN branch_id DROP NOT NULL;

DO $migration$
BEGIN
  PERFORM set_config('app.register_branch','on',true);
  UPDATE public.users SET branch_id=NULL
  WHERE role='super_admin' AND branch_id IS NOT NULL;

  DELETE FROM public.user_branch_access a USING public.users u
  WHERE a.user_id=u.id AND u.role='super_admin';
  DELETE FROM public.organization_members m USING public.users u
  WHERE m.user_id=u.id AND u.role='super_admin';
END;
$migration$;

-- Always normalize legacy bootstrap or admin-creation requests to a global user
-- before subsequent user-role guards run.
CREATE OR REPLACE FUNCTION private.keep_super_admin_global()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  IF NEW.role='super_admin' THEN NEW.branch_id=NULL; END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_00_keep_super_admin_global ON public.users;
CREATE TRIGGER trg_00_keep_super_admin_global
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION private.keep_super_admin_global();

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_super_admin_global_scope_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_super_admin_global_scope_check
  CHECK (role <> 'super_admin' OR branch_id IS NULL);

COMMENT ON CONSTRAINT users_super_admin_global_scope_check ON public.users
IS 'Platform Super Admin never has a tenant branch; tenant Owner remains bound to an organization.';
