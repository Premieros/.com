import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const presets = readFileSync('src/core/organizations/businessProfiles.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260929144000_organization_business_profiles.sql', 'utf8');
const wizard = readFileSync('src/features/admin/components/OrganizationCreateWizard.tsx', 'utf8');
const adminApi = readFileSync('src/api/domains/admin.ts', 'utf8');
const runtime = readFileSync('src/core/organizations/businessProfileRuntime.ts', 'utf8');
const runtimeMigration = readFileSync('supabase/migrations/20260929154500_business_profile_runtime_storage.sql', 'utf8');
const businessRecordsPage = readFileSync('src/features/operations/pages/BusinessRecordsPage.tsx', 'utf8');

describe('organization business profile provisioning contract', () => {
  it('ships the approved business presets', () => {
    for (const key of [
      'restaurant',
      'food_manufacturing',
      'pharmacy',
      'car_showroom',
      'tourism',
      'retail',
      'services',
      'custom',
    ]) {
      expect(presets).toContain(key);
    }
  });

  it('provisions a complete tenant shell atomically behind Super Admin', () => {
    expect(migration).toContain('super_admin_create_organization_from_profile');
    expect(migration).toContain('IF NOT public.is_super_admin()');
    expect(migration).toContain('INSERT INTO public.organizations');
    expect(migration).toContain('INSERT INTO public.branches');
    expect(migration).toContain('INSERT INTO public.warehouses');
    expect(migration).toContain('INSERT INTO public.branch_settings');
    expect(migration).toContain('INSERT INTO public.branch_subscriptions');
    expect(migration).toContain('INSERT INTO public.organization_feature_overrides');
    expect(migration).toContain('INSERT INTO public.organization_members');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.super_admin_create_organization_from_profile');
    expect(migration).toContain('FROM PUBLIC, anon');
  });

  it('keeps profile modules editable before creation and stores profile capabilities', () => {
    expect(wizard).toContain('toggleModule');
    expect(wizard).toContain('p_enabled_modules: enabledModules');
    expect(wizard).toContain('capabilities: preset.capabilities');
    expect(wizard).toContain('terminology: preset.terminology');
    expect(adminApi).toContain('createOrganizationFromProfile');
  });
  it('provides real runtime storage and screens for activity-specific needs', () => {
    expect(runtime).toContain("key: 'vin'");
    expect(runtime).toContain("key: 'booking'");
    expect(runtime).toContain("key: 'appointment'");
    expect(runtimeMigration).toContain('ADD COLUMN IF NOT EXISTS business_attributes jsonb');
    expect(runtimeMigration).toContain('CREATE TABLE IF NOT EXISTS public.business_records');
    expect(runtimeMigration).toContain('ALTER TABLE public.business_records ENABLE ROW LEVEL SECURITY');
    expect(businessRecordsPage).toContain("from('business_records')");
    expect(businessRecordsPage).toContain('record_types');
  });

});
