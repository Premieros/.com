-- Cover the organization module audit FK reported by the performance advisor.
-- Append-only follow-up to the already-applied organization module migration.

CREATE INDEX IF NOT EXISTS idx_org_feature_overrides_updated_by
  ON public.organization_feature_overrides (updated_by);
