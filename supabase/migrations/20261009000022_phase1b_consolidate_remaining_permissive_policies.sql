-- Phase 1B: consolidate remaining same-role permissive policy duplicates.
-- Each replacement preserves the previous effective OR semantics.

-- subscription_plans: true OR is_active = true => true
DROP POLICY IF EXISTS plans_read_all ON public.subscription_plans;
DROP POLICY IF EXISTS subscription_plans_public_read ON public.subscription_plans;
DROP POLICY IF EXISTS subscription_plans_public_read_combined ON public.subscription_plans;

CREATE POLICY subscription_plans_public_read_combined
ON public.subscription_plans
FOR SELECT
TO anon, authenticated
USING (true);

-- treasury_accounts: preserve branch-access OR organization-access semantics.
DROP POLICY IF EXISTS auth_select_organization_treasury_accounts ON public.treasury_accounts;
DROP POLICY IF EXISTS auth_select_treasury_accounts ON public.treasury_accounts;
DROP POLICY IF EXISTS auth_select_treasury_accounts_combined ON public.treasury_accounts;

CREATE POLICY auth_select_treasury_accounts_combined
ON public.treasury_accounts
FOR SELECT
TO authenticated
USING (
  public.user_may_access_branch(branch_id)
  OR (
    scope = 'organization'
    AND (
      public.can_permission('accounting.treasury.transfer')
      OR public.can_permission('accounting.treasury.main_cash.pay')
    )
    AND organization_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.branches b
      WHERE b.organization_id = treasury_accounts.organization_id
        AND public.user_may_access_branch(b.id)
    )
  )
);

-- user_branch_access: preserve both management permission paths.
DROP POLICY IF EXISTS auth_manage_user_branch_access ON public.user_branch_access;
DROP POLICY IF EXISTS auth_permission_manage_user_branch_access ON public.user_branch_access;
DROP POLICY IF EXISTS auth_manage_user_branch_access_combined ON public.user_branch_access;

CREATE POLICY auth_manage_user_branch_access_combined
ON public.user_branch_access
FOR ALL
TO authenticated
USING (
  public.is_platform_admin()
  OR (
    public.can_permission('users.manage')
    AND public.user_may_access_branch(branch_id)
  )
  OR public.is_pos_admin()
  OR (
    public.can_permission('users.branches.manage')
    AND public.user_may_access_branch(branch_id)
  )
)
WITH CHECK (
  public.is_platform_admin()
  OR (
    public.can_permission('users.manage')
    AND public.user_may_access_branch(branch_id)
  )
  OR public.is_pos_admin()
  OR (
    public.can_permission('users.branches.manage')
    AND public.user_may_access_branch(branch_id)
  )
);
