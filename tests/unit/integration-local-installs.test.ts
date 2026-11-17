import { beforeEach, describe, expect, it } from 'vitest';
import {
  installationStorageKey, parseInstalledAppMap, readInstalledApps,
  updateLocalAppInstallation,
} from '../../src/features/integrations/localAppInstallations';

beforeEach(() => localStorage.clear());

describe('local integration app installation', () => {
  it('keeps installs scoped to operator and branch and persists removal', () => {
    expect(readInstalledApps('operator-1', 'branch-a')).toEqual({});
    expect(updateLocalAppInstallation('operator-1', 'branch-a', 'talabat', true))
      .toEqual({ talabat: true });
    expect(readInstalledApps('operator-1', 'branch-a')).toEqual({ talabat: true });
    expect(readInstalledApps('operator-1', 'branch-b')).toEqual({});
    expect(readInstalledApps('operator-2', 'branch-a')).toEqual({});
    expect(updateLocalAppInstallation('operator-1', 'branch-a', 'talabat', false))
      .toEqual({});
  });

  it('ignores untrusted/corrupt local storage and cannot elevate provider state', () => {
    expect(parseInstalledAppMap('{bad')).toEqual({});
    expect(parseInstalledAppMap(JSON.stringify({ talabat: 'connected', jahez: true,
      access_token: 'secret', unknown: true }))).toEqual({ jahez: true });
    localStorage.setItem(installationStorageKey('operator-1', 'branch-a'),
      JSON.stringify({ jahez: true, foo: 'bar' }));
    expect(readInstalledApps('operator-1', 'branch-a')).toEqual({ jahez: true });
  });

  it('requires nonempty scoped IDs and a known app ID', () => {
    expect(() => installationStorageKey('', 'branch-a')).toThrow();
    expect(() => installationStorageKey('operator-1', '')).toThrow();
    expect(() => updateLocalAppInstallation('operator-1', 'branch-a',
      'unknown-app' as 'talabat', true)).toThrow('UNKNOWN_INTEGRATION_APP');
  });
});
