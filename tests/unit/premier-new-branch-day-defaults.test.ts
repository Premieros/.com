import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contract test for the exact production-facing branch creation RPC change.
// This is in addition to the disposable-Postgres migration replay CI.
const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261111100000_new_branch_fixed_day_defaults.sql'),
  'utf8',
);

describe('new branch live-operation defaults', () => {
  it('keeps branch setup inside the authenticated organization-scoped RPC', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.create_organization_branch(');
    expect(migration).toContain('auth.uid() IS NULL');
    expect(migration).toContain("public.can_permission('branches.manage')");
    expect(migration).toContain('public.user_can_access_organization(p_organization_id)');
  });
  it('initializes only a newly inserted branch to 10:00–02:00 with automatic shift closure', () => {
    expect(migration).toMatch(/INSERT INTO public\.branch_settings\s*\([\s\S]*business_day_mode, business_day_start, business_day_end,[\s\S]*auto_close_shift_at_day_end/);
    expect(migration).toMatch(/'fixed_time', '10:00'::time, '02:00'::time, true/);
    expect(migration).toContain('v_branch_id');
    expect(migration).not.toMatch(/UPDATE\s+public\.branch_settings\b/i);
  });
  it('preserves existing treasury, warehouse and branch authorization bootstrap', () => {
    expect(migration).toContain('work_authorization_branch_bootstrap');
    expect(migration).toContain('user_branch_access');
    expect(migration).toContain('public.warehouses');
    expect(migration).toContain('public.branch_subscriptions');
  });
});
