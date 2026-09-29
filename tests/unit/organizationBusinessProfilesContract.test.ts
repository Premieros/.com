import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const presets = readFileSync('src/core/organizations/businessProfiles.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260929144000_organization_business_profiles.sql', 'utf8');
const wizard = readFileSync('src/features/admin/components/OrganizationCreateWizard.tsx', 'utf8');
const adminApi = readFileSync('src/api/domains/admin.ts', 'utf8');

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
});
