import { supabase } from '@/lib/supabase';
import { INTEGRATION_APP_IDS, type InstalledAppMap, type IntegrationAppId } from './localAppInstallations';

/**
 * Shared catalog installation only. This never authenticates with a provider,
 * activates an integration or submits invoices/orders.
 */
function assertScope(organizationId: string, branchId: string): void {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(organizationId) || !uuid.test(branchId)) {
    throw new Error('CENTRAL_INSTALL_SCOPE_UNAVAILABLE');
  }
}

export async function loadCentralInstalledApps(organizationId: string, branchId: string): Promise<InstalledAppMap> {
  assertScope(organizationId, branchId);
  const { data, error } = await supabase.from('integration_app_installations')
    .select('app_id')
    .eq('organization_id', organizationId)
    .eq('branch_id', branchId);
  if (error) throw error;
  const installed: InstalledAppMap = {};
  for (const row of data ?? []) {
    const id = row.app_id as IntegrationAppId;
    if (INTEGRATION_APP_IDS.includes(id)) installed[id] = true;
  }
  return installed;
}

export async function changeCentralAppInstallation(
  organizationId: string, branchId: string, appId: IntegrationAppId,
  userId: string, install: boolean,
): Promise<InstalledAppMap> {
  assertScope(organizationId, branchId);
  if (!INTEGRATION_APP_IDS.includes(appId)) throw new Error('UNKNOWN_INTEGRATION_APP');
  // Never assume the browser's user ID authorizes a write: PostgreSQL RLS
  // validates it against auth.uid() and active tenant/branch membership.
  if (install) {
    const { error } = await supabase.from('integration_app_installations')
      .insert({ organization_id: organizationId, branch_id: branchId, app_id: appId, installed_by: userId });
    if (error && error.code !== '23505') throw error;
  } else {
    const { error } = await supabase.from('integration_app_installations')
      .delete()
      .eq('organization_id', organizationId)
      .eq('branch_id', branchId)
      .eq('app_id', appId);
    if (error) throw error;
  }
  // Read back from the server; never optimistically mark a denied write as success.
  return loadCentralInstalledApps(organizationId, branchId);
}

/**
 * Import candidates are calculated solely from the operator's existing
 * per-browser, per-branch catalog installs. Nothing is imported automatically.
 */
export function getPendingLegacyApps(local: InstalledAppMap, shared: InstalledAppMap): IntegrationAppId[] {
  return INTEGRATION_APP_IDS.filter((id) => local[id] === true && shared[id] !== true);
}

/**
 * Explicit operator-confirmed promotion of browser-local catalog selections to
 * the shared branch registry. The database RLS remains the authorization
 * boundary for every operation. Stop on the first failure and do not delete
 * any browser-local entries so that failed/partial imports can be retried.
 */
export async function importConfirmedLegacyApps(
  organizationId: string, branchId: string, userId: string,
  local: InstalledAppMap, shared: InstalledAppMap,
): Promise<InstalledAppMap> {
  assertScope(organizationId, branchId);
  let current = shared;
  for (const appId of getPendingLegacyApps(local, current)) {
    current = await changeCentralAppInstallation(organizationId, branchId, appId, userId, true);
    if (current[appId] !== true) throw new Error('CENTRAL_INSTALL_NOT_CONFIRMED');
  }
  return current;
}
