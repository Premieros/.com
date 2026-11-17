/**
 * Local-only integration app catalog installation state.
 *
 * No external provider connectivity, credentials, or production activation
 * is implied by local installation. State is scoped to user+branch+device;
 * it must not be used for billing, entitlement or server-side authorization.
 */
export const INTEGRATION_APP_IDS = [
  'eta-einvoice', 'eta-ereceipt', 'zatca-clearance', 'zatca-reporting',
  'zatca-egs', 'talabat', 'hungerstation', 'jahez', 'other',
] as const;

export type IntegrationAppId = typeof INTEGRATION_APP_IDS[number];
export type InstalledAppMap = Partial<Record<IntegrationAppId, true>>;

const prefix = 'premier:local-integration-apps:v1:';

export function installationStorageKey(userId: string, branchId: string): string {
  if (!userId || !branchId || !/^[\w-]{1,128}$/.test(userId) ||
      !/^[\w-]{1,128}$/.test(branchId)) {
    throw new Error('INVALID_INTEGRATION_INSTALL_SCOPE');
  }
  return `${prefix}${userId}:${branchId}`;
}

export function parseInstalledAppMap(value: string | null): InstalledAppMap {
  if (!value || value.length > 4096) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: InstalledAppMap = {};
    for (const id of INTEGRATION_APP_IDS) {
      if ((parsed as Record<string, unknown>)[id] === true) result[id] = true;
    }
    return result;
  } catch {
    return {};
  }
}

export function readInstalledApps(userId: string, branchId: string): InstalledAppMap {
  try {
    if (typeof localStorage === 'undefined') return {};
    return parseInstalledAppMap(localStorage.getItem(installationStorageKey(userId, branchId)));
  } catch {
    return {};
  }
}

export function updateLocalAppInstallation(
  userId: string,
  branchId: string,
  appId: IntegrationAppId,
  install: boolean,
): InstalledAppMap {
  if (!INTEGRATION_APP_IDS.includes(appId)) throw new Error('UNKNOWN_INTEGRATION_APP');
  const key = installationStorageKey(userId, branchId);
  if (typeof localStorage === 'undefined') throw new Error('LOCAL_INSTALL_STORAGE_UNAVAILABLE');
  const existing = readInstalledApps(userId, branchId);
  const next = { ...existing };
  if (install) next[appId] = true;
  else delete next[appId];
  // Write first; only return a successful state after durable browser write.
  localStorage.setItem(key, JSON.stringify(next));
  return next;
}
