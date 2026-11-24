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

  it('scopes persisted repository caches to the authenticated user too', () => {
    const repository = readFileSync('src/core/repositories/SettingsRepository.ts', 'utf8');
    expect(repository).toContain('global_settings:${userId}');
    expect(repository).toContain('branch_settings:${userId}:${branchId}');
    expect(repository).toContain('premier:cached_branch_settings_map:${userId}');
    expect(source).toContain('SettingsRepository.replaceUserSnapshot(sessionUserId, data, bMap)');
    expect(repository).toContain('cursor.key === globalKey || cursor.key.startsWith(branchPrefix)');
    expect(repository).toContain('cursor.delete()');
    expect(repository).toContain("db.transaction('system_settings', 'readwrite')");
    expect(repository).toContain("cursor.key === 'global_settings'");
    expect(repository).toContain("localStorage.removeItem('premier:cached_settings')");
    expect(repository).not.toContain('userId?: string');
    expect(repository).not.toContain('userId ?');
    expect(repository).not.toContain("localStorage.setItem('premier:allow_negative_stock:");
    expect(source).toContain('SettingsRepository.saveGlobalSettings(next, sessionUserId)');
    expect(source).toContain('SettingsRepository.saveBranchSettings(branchId, updatedBranch, sessionUserId)');
  });

  it('reads offline sale policy only from the originating cashier scope and rejects owner switches', () => {
    const payment = readFileSync('src/features/pos/services/payment.ts', 'utf8');
    expect(payment).toContain('SettingsRepository.getBranchSettings(p.p_branch_id, expectedOwnerId)');
    expect(payment).toContain('SettingsRepository.getGlobalSettings(expectedOwnerId)');
    expect(payment).toContain('originatingUserId !== expectedOwnerId');
    expect(payment).not.toContain('SettingsRepository.getGlobalSettings()');
  });

  it('rejects stale asynchronous refreshes and preserves cached data on read errors', () => {
    expect(source).toContain('const epoch = ++refreshEpoch.current');
    expect(source).toContain('if (epoch !== refreshEpoch.current) return');
    expect(source).toContain('if (sRes.error || bRes.error) throw sRes.error || bRes.error');
    expect(source).toContain('if (epoch === refreshEpoch.current) setLoading(false)');
  });
});
