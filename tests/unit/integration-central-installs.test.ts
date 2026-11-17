import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  calls: [] as Array<{ action: string; arg?: unknown }>,
  rows: [] as Array<{ app_id: string }>,
  readError: null as null | { code: string; message: string },
  writeError: null as null | { code: string; message: string },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      mock.calls.push({ action: 'from', arg: table });
      type Query = { select: (projection: string) => Query; eq: (field: string, value: string) => Query; then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise<unknown>; insert: (row: unknown) => Promise<{ error: typeof mock.writeError }>; delete: () => Query };
      const query: Query = {
        select: (projection: string) => {
          mock.calls.push({ action: 'select', arg: projection });
          return query;
        },
        eq: (field: string, value: string) => {
          mock.calls.push({ action: field, arg: value });
          return query;
        },
        then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) =>
          Promise.resolve({ data: mock.rows, error: mock.readError }).then(resolve, reject),
        insert: async (row: unknown) => {
          mock.calls.push({ action: 'insert', arg: row });
          return { error: mock.writeError };
        },
        delete: () => {
          mock.calls.push({ action: 'delete' });
          return { ...query, then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) =>
            Promise.resolve({ error: mock.writeError }).then(resolve, reject) };
        },
      };
      return query;
    },
  },
}));

import {
  loadCentralInstalledApps, changeCentralAppInstallation,
  getPendingLegacyApps, importConfirmedLegacyApps,
} from '@/features/integrations/centralAppInstallations';

const org = '11111111-1111-4111-8111-111111111111';
const branch = '22222222-2222-4222-8222-222222222222';
const user = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  mock.calls.length = 0;
  mock.rows = [];
  mock.readError = null;
  mock.writeError = null;
});

describe('central integration installation service', () => {
  it('requires valid branch and tenant scopes before any request', async () => {
    await expect(loadCentralInstalledApps('', branch)).rejects.toThrow('CENTRAL_INSTALL_SCOPE_UNAVAILABLE');
    await expect(loadCentralInstalledApps(org, 'not-uuid')).rejects.toThrow('CENTRAL_INSTALL_SCOPE_UNAVAILABLE');
    expect(mock.calls).toEqual([]);
  });

  it('ignores untrusted provider state and returns only known installed IDs', async () => {
    mock.rows = [{ app_id: 'talabat' }, { app_id: 'fake-connected' }, { app_id: 'jahez' }];
    expect(await loadCentralInstalledApps(org, branch)).toEqual({ talabat: true, jahez: true });
    expect(mock.calls).toContainEqual({ action: 'organization_id', arg: org });
    expect(mock.calls).toContainEqual({ action: 'branch_id', arg: branch });
  });

  it('never reports a denied installation as successful', async () => {
    mock.writeError = { code: '42501', message: 'RLS denied' };
    await expect(changeCentralAppInstallation(org, branch, 'talabat', user, true))
      .rejects.toMatchObject({ code: '42501' });
    expect(mock.calls.filter((call) => call.action === 'select')).toHaveLength(0);
  });

  it('confirms installation by reading the database, not by optimistic local state', async () => {
    mock.rows = [{ app_id: 'talabat' }];
    expect(await changeCentralAppInstallation(org, branch, 'talabat', user, true))
      .toEqual({ talabat: true });
    expect(mock.calls.find((call) => call.action === 'insert')?.arg)
      .toEqual({ organization_id: org, branch_id: branch, app_id: 'talabat', installed_by: user });
  });

  it('blocks arbitrary catalog identifiers', async () => {
    await expect(changeCentralAppInstallation(org, branch, 'arbitrary' as 'talabat', user, true))
      .rejects.toThrow('UNKNOWN_INTEGRATION_APP');
    expect(mock.calls).toHaveLength(0);
  });
});

describe('explicit browser-local import', () => {
  it('filters out apps already registered centrally and ignores unknown IDs', () => {
    expect(getPendingLegacyApps(
      { talabat: true, jahez: true, mystery: true } as unknown as { talabat: true; jahez: true },
      { talabat: true },
    )).toEqual(['jahez']);
  });

  it('imports only after the explicit action and confirms the server readback', async () => {
    expect(getPendingLegacyApps({ talabat: true }, {})).toEqual(['talabat']);
    expect(mock.calls).toHaveLength(0);
    mock.rows = [{ app_id: 'talabat' }];
    const state = await importConfirmedLegacyApps(org, branch, user, { talabat: true }, {});
    expect(state).toEqual({ talabat: true });
    expect(mock.calls.filter((call) => call.action === 'insert')).toHaveLength(1);
  });

  it('does not reinsert already registered apps', async () => {
    const state = await importConfirmedLegacyApps(org, branch, user, { talabat: true }, { talabat: true });
    expect(state).toEqual({ talabat: true });
    expect(mock.calls).toHaveLength(0);
  });

  it('fails closed if the server fails to confirm an imported app', async () => {
    await expect(importConfirmedLegacyApps(org, branch, user, { talabat: true }, {}))
      .rejects.toThrow('CENTRAL_INSTALL_NOT_CONFIRMED');
    expect(mock.calls.filter((call) => call.action === 'insert')).toHaveLength(1);
  });

  it('does not report a successful import when RLS rejects the operation', async () => {
    mock.writeError = { code: '42501', message: 'RLS denied' };
    await expect(importConfirmedLegacyApps(org, branch, user, { jahez: true }, {}))
      .rejects.toMatchObject({ code: '42501' });
  });
});
