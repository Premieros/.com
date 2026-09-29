-- Generic business-profile runtime storage.
-- Enables activity-specific data without creating a separate schema per industry.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS business_attributes jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS business_attributes jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS business_attributes jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.business_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  record_type text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  title text NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  starts_at timestamptz,
  ends_at timestamptz,
  amount numeric(14,2),
  currency text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_records_org
  ON public.business_records (organization_id, record_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_records_branch
  ON public.business_records (branch_id, record_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_records_customer
  ON public.business_records (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_records_supplier
  ON public.business_records (supplier_id)
  WHERE supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_records_product
  ON public.business_records (product_id)
  WHERE product_id IS NOT NULL;

ALTER TABLE public.business_records ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_records FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_records TO authenticated;
GRANT ALL ON TABLE public.business_records TO service_role;

DROP POLICY IF EXISTS business_records_select ON public.business_records;
CREATE POLICY business_records_select
ON public.business_records
FOR SELECT
TO authenticated
USING (
  public.is_super_admin()
  OR (
    public.user_can_access_organization(organization_id)
    AND (branch_id IS NULL OR public.user_may_access_branch(branch_id))
  )
);

DROP POLICY IF EXISTS business_records_insert ON public.business_records;
CREATE POLICY business_records_insert
ON public.business_records
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_super_admin()
  OR (
    public.user_can_access_organization(organization_id)
    AND (branch_id IS NULL OR public.user_may_access_branch(branch_id))
    AND COALESCE(created_by, auth.uid()) = auth.uid()
  )
);

DROP POLICY IF EXISTS business_records_update ON public.business_records;
CREATE POLICY business_records_update
ON public.business_records
FOR UPDATE
TO authenticated
USING (
  public.is_super_admin()
  OR (
    public.user_can_access_organization(organization_id)
    AND (branch_id IS NULL OR public.user_may_access_branch(branch_id))
  )
)
WITH CHECK (
  public.is_super_admin()
  OR (
    public.user_can_access_organization(organization_id)
    AND (branch_id IS NULL OR public.user_may_access_branch(branch_id))
  )
);

DROP POLICY IF EXISTS business_records_delete ON public.business_records;
CREATE POLICY business_records_delete
ON public.business_records
FOR DELETE
TO authenticated
USING (
  public.is_super_admin()
  OR (
    public.user_can_access_organization(organization_id)
    AND (branch_id IS NULL OR public.user_may_access_branch(branch_id))
  )
);
