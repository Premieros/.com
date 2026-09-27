import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, runAsPersist, seedRlsFixture } from './rls';
import type { RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('organization module controls', () => {
  let client: pg.Client;
  let canImp = false;
  let ids: RlsIds;
  let orgA = '';
  let orgB = '';

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    canImp = await canImpersonate(client);
    if (!canImp) return;

    ids = await seedRlsFixture(client);
    const result = await client.query<{ id: string; organization_id: string }>(
      'SELECT id, organization_id FROM public.branches WHERE id = ANY($1::uuid[])',
      [[ids.branchA, ids.branchB]],
    );
    orgA = result.rows.find((row) => row.id === ids.branchA)!.organization_id;
    orgB = result.rows.find((row) => row.id === ids.branchB)!.organization_id;
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('allows only Super Admin to change organization modules', async () => {
    if (!canImp) return;

    const denied = await runAs(
      client,
      ids.users.owner,
      "SELECT public.super_admin_set_organization_module($1, 'pos', false, 'test') AS result",
      [orgA],
    );
    expect(denied.error).toBeUndefined();
    expect(denied.rows[0].result).toMatchObject({ success: false, error: 'UNAUTHORIZED' });

    const allowed = await runAsPersist(
      client,
      ids.users.super_admin,
      "SELECT public.super_admin_set_organization_module($1, 'pos', false, 'test') AS result",
      [orgA],
    );
    expect(allowed.error).toBeUndefined();
    expect(allowed.rows[0].result).toMatchObject({ success: true, enabled: false });
  });

  it('denies a disabled organization module even when a legacy branch override enables it', async () => {
    if (!canImp) return;

    await client.query(
      `INSERT INTO public.branch_feature_overrides (tenant_id, branch_id, feature_id, enabled)
       SELECT $1, $2, f.id, true
       FROM public.features f
       WHERE f.key = 'pos'
       ON CONFLICT (branch_id, feature_id) DO UPDATE SET enabled = true`,
      [orgA, ids.branchA],
    );

    const result = await runAs(
      client,
      ids.users.cashier,
      "SELECT public.can_access_feature('pos', $1) AS allowed",
      [ids.branchA],
    );
    expect(result.error).toBeUndefined();
    expect(result.rows[0].allowed).toBe(false);
  });

  it('keeps tenant scope closed to a foreign organization', async () => {
    if (!canImp) return;

    const own = await runAs(
      client,
      ids.users.cashier,
      "SELECT public.user_can_access_organization($1) AS allowed",
      [orgA],
    );
    const foreign = await runAs(
      client,
      ids.users.cashier,
      "SELECT public.user_can_access_organization($1) AS allowed",
      [orgB],
    );

    expect(own.rows[0].allowed).toBe(true);
    expect(foreign.rows[0].allowed).toBe(false);
  });

  it('re-enables a module without granting any user permission by itself', async () => {
    if (!canImp) return;

    const enabled = await runAsPersist(
      client,
      ids.users.super_admin,
      "SELECT public.super_admin_set_organization_module($1, 'pos', true, 'test') AS result",
      [orgA],
    );
    expect(enabled.rows[0].result).toMatchObject({ success: true, enabled: true });

    const access = await runAs(
      client,
      ids.users.cashier,
      "SELECT public.can_access_feature('pos', $1) AS allowed",
      [ids.branchA],
    );
    expect(access.rows[0].allowed).toBe(true);

    // Module access and application permissions are intentionally separate.
    const permission = await runAs(
      client,
      ids.users.cashier,
      "SELECT public.can_permission('settings.manage') AS allowed",
    );
    expect(permission.rows[0].allowed).toBe(false);
  });
});
