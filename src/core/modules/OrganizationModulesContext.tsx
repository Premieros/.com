import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '@/api';
import { useAuth } from '@/context/AuthContext';
import { useBranches } from '@/hooks/useBranches';
import { useBranchFilter } from '@/lib/useBranchFilter';
import {
  ORGANIZATION_MODULE_KEYS,
  type OrganizationModuleKey,
} from './module.config';

type ModuleAccessMap = Record<OrganizationModuleKey, boolean>;

interface OrganizationModulesContextValue {
  organizationId: string | null;
  loading: boolean;
  compatibilityFallback: boolean;
  access: ModuleAccessMap;
  canAccessModule: (moduleKey: OrganizationModuleKey | null | undefined) => boolean;
  refresh: () => Promise<void>;
}

interface ModuleCatalogRow {
  feature_key: string;
  enabled: boolean;
}

const ALL_ENABLED = Object.fromEntries(
  ORGANIZATION_MODULE_KEYS.map((key) => [key, true]),
) as ModuleAccessMap;

const ALL_DISABLED = Object.fromEntries(
  ORGANIZATION_MODULE_KEYS.map((key) => [key, false]),
) as ModuleAccessMap;

const OrganizationModulesContext = createContext<OrganizationModulesContextValue | undefined>(undefined);

function isMissingModuleRpcError(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  const text = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
  return text.includes('pgrst202')
    || text.includes('get_organization_module_catalog')
    || text.includes('could not find the function');
}

export function OrganizationModulesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { branches, loading: branchesLoading } = useBranches();
  const branchId = useBranchFilter();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [access, setAccess] = useState<ModuleAccessMap>(ALL_ENABLED);
  const [loading, setLoading] = useState(false);
  const [compatibilityFallback, setCompatibilityFallback] = useState(false);

  const userId = user?.id ?? null;
  const isPlatformAdmin = user?.role === 'super_admin';

  const refresh = useCallback(async () => {
    if (!userId) {
      setOrganizationId(null);
      setAccess(ALL_DISABLED);
      setCompatibilityFallback(false);
      setLoading(false);
      return;
    }

    if (isPlatformAdmin) {
      setOrganizationId(null);
      setAccess(ALL_ENABLED);
      setCompatibilityFallback(false);
      setLoading(false);
      return;
    }

    if (branchesLoading) {
      setLoading(true);
      return;
    }

    const branch = branches.find((candidate) => candidate.id === branchId)
      ?? branches.find((candidate) => candidate.id === user?.branch_id)
      ?? branches[0]
      ?? null;

    const nextOrganizationId = branch?.organization_id ?? null;
    setOrganizationId(nextOrganizationId);

    if (!nextOrganizationId) {
      // Transitional compatibility for old bootstrap data that has no tenant
      // relationship yet. RLS/permissions remain authoritative.
      setAccess(ALL_ENABLED);
      setCompatibilityFallback(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.rpc('get_organization_module_catalog', {
      p_organization_id: nextOrganizationId,
    });

    if (error) {
      // During the code-before-migration deployment window, keep the existing
      // application behavior. Any other runtime error retains the same
      // compatibility posture; database RLS and permissions are still enforced.
      setAccess(ALL_ENABLED);
      setCompatibilityFallback(isMissingModuleRpcError(error) || true);
      setLoading(false);
      return;
    }

    const next = { ...ALL_ENABLED };
    for (const row of (data ?? []) as ModuleCatalogRow[]) {
      if (ORGANIZATION_MODULE_KEYS.includes(row.feature_key as OrganizationModuleKey)) {
        next[row.feature_key as OrganizationModuleKey] = row.enabled !== false;
      }
    }

    setAccess(next);
    setCompatibilityFallback(false);
    setLoading(false);
  }, [
    branchId,
    branches,
    branchesLoading,
    isPlatformAdmin,
    user?.branch_id,
    userId,
  ]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const canAccessModule = useCallback(
    (moduleKey: OrganizationModuleKey | null | undefined) => {
      if (!moduleKey) return true;
      if (isPlatformAdmin) return true;
      return access[moduleKey] !== false;
    },
    [access, isPlatformAdmin],
  );

  const value = useMemo<OrganizationModulesContextValue>(() => ({
    organizationId,
    loading,
    compatibilityFallback,
    access,
    canAccessModule,
    refresh,
  }), [organizationId, loading, compatibilityFallback, access, canAccessModule, refresh]);

  return (
    <OrganizationModulesContext.Provider value={value}>
      {children}
    </OrganizationModulesContext.Provider>
  );
}

export function useOrganizationModules(): OrganizationModulesContextValue {
  const ctx = useContext(OrganizationModulesContext);
  if (!ctx) throw new Error('useOrganizationModules must be used within OrganizationModulesProvider');
  return ctx;
}
