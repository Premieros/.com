import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/context/SettingsContext.tsx', 'utf8');

describe('settings cache avoids repeated parsing and cross-user bootstrap', () => {
  it('never hydrates another user or anonymous session from shared storage', () => {
    expect(source).toContain('if (!userId) return { settings: null, branchMap: {} }');
    expect(source).toContain('localStorage.getItem(`premier:cached_settings:${userId}`)');
    expect(source).toContain('localStorage.getItem(`premier:cached_branch_settings_map:${userId}`)');
    expect(source).not.toContain("localStorage.getItem('premier:cached_settings')");
    expect(source).not.toContain("localStorage.getItem('premier:cached_branch_settings_map')");
  });

  it('only parses initial settings once and reloads caches when session owner changes', () => {
    expect(source).toContain('useState(() => getInitialCachedSettings(sessionUserId))');
    expect(source).toContain('if (currentCacheUser.current === sessionUserId) return');
    expect(source).toContain('const next = getInitialCachedSettings(sessionUserId)');
    expect(source).toContain('setBranchSettingsMap(next.branchMap)');
  });

  it('rejects stale asynchronous refreshes and preserves cached data on read errors', () => {
    expect(source).toContain('const epoch = ++refreshEpoch.current');
    expect(source).toContain('if (epoch !== refreshEpoch.current) return');
    expect(source).toContain('if (sRes.error || bRes.error) throw sRes.error || bRes.error');
    expect(source).toContain('if (epoch === refreshEpoch.current) setLoading(false)');
  });
});
