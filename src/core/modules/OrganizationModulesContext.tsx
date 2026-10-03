import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '@/api';
import { useAuth } from '@/context/AuthContext';
import { useBranches } from '@/hooks/useBranches';
import { useBranchFilter } from '@/lib/useBranchFilter';
import type { BusinessProfileKey } from '@/core/organizations/businessProfiles';
import {
  businessPathAllowed,
  resolveBusinessRuntime,
  type BusinessRuntime,
  type StoredBusinessProfile,
} from '@/core/organizations/businessRuntime';
import {
  ORGANIZATION_MODULE_KEYS,
  type OrganizationModuleKey,
} from './module.config';

type ModuleAccessMap = Record<OrganizationModuleKey, boolean>;

export type OrganizationBusinessProfile = StoredBusinessProfile;

interface OrganizationModulesContextValue {
  organizationId: string | null;
  businessType: BusinessProfileKey | null;
  businessProfile: OrganizationBusinessProfile | null;
  runtime: BusinessRuntime;
  loading: boolean;
  compatibilityFallback: boolean;
  access: ModuleAccessMap;
  canAccessModule: (moduleKey: OrganizationModuleKey | null | undefined) => boolean;
  hasCapability: (capability: string) => boolean;
  canAccessPath: (pathname: string) => boolean;
  refresh: () => Promise<void>;
}

interface ModuleCatalogRow {
  feature_key: string;
  enabled: boolean;
}

interface OrganizationRuntimeRow {
  business_type: BusinessProfileKey | null;
  business_profile: OrganizationBusinessProfile | null;
}

interface RuntimeCache {
  access: ModuleAccessMap;
  businessType: BusinessProfileKey | null;
  businessProfile: OrganizationBusinessProfile | null;
}

const ALL_ENABLED = Object.fromEntries(
  ORGANIZATION_MODULE_KEYS.map((key) => [key, true]),
) as ModuleAccessMap;

const ALL_DISABLED = Object.fromEntries(
  ORGANIZATION_MODULE_KEYS.map((key) => [key, false]),
) as ModuleAccessMap;

const RUNTIME_CHANGED_EVENT = 'premier:organization-runtime-changed';
const CACHE_PREFIX = 'premier:organization-runtime:';

const OrganizationModulesContext = createContext<OrganizationModulesContextValue | undefined>(undefined);

function isMissingModuleRpcError(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  const text = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
  return text.includes('pgrst202')
    || text.includes('get_organization_module_catalog')
    || text.includes('could not find the function');
}

function readRuntimeCache(organizationId: string): RuntimeCache | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(`${CACHE_PREFIX}${organizationId}`);
    if (!raw) return null;
    return JSON.parse(raw) as RuntimeCache;
  } catch {
    return null;
  }
}

function writeRuntimeCache(organizationId: string, value: RuntimeCache): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(`${CACHE_PREFIX}${organizationId}`, JSON.stringify(value));
  } catch {
    // Offline cache is best-effort only.
  }
}

export function notifyOrganizationRuntimeChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(RUNTIME_CHANGED_EVENT));
  }
}

export function OrganizationModulesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { branches, loading: branchesLoading } = useBranches();
  const branchId = useBranchFilter();
  const requestSequence = useRef(0);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [businessType, setBusinessType] = useState<BusinessProfileKey | null>(null);
  const [businessProfile, setBusinessProfile] = useState<OrganizationBusinessProfile | null>(null);
  const [access, setAccess] = useState<ModuleAccessMap>(ALL_ENABLED);
  const [loading, setLoading] = useState(false);
  const [compatibilityFallback, setCompatibilityFallback] = useState(false);

  const userId = user?.id ?? null;

  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current;

    if (!userId) {
      setOrganizationId(null);
      setBusinessType(null);
      setBusinessProfile(null);
      setAccess(ALL_DISABLED);
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
      setBusinessType(null);
      setBusinessProfile(null);
      // Transitional compatibility for old bootstrap data that has no tenant
      // relationship yet. RLS/permissions remain authoritative.
      setAccess(ALL_ENABLED);
      setCompatibilityFallback(true);
      setLoading(false);
      return;
    }

    const cached = readRuntimeCache(nextOrganizationId);
    if (cached) {
      setAccess(cached.access);
      setBusinessType(cached.businessType);
      setBusinessProfile(cached.businessProfile);
    } else {
      // Never leak the previous organization's runtime while a new one loads.
      setAccess(ALL_DISABLED);
      setBusinessType(null);
      setBusinessProfile(null);
    }

    setLoading(true);

    const [modulesResult, organizationResult] = await Promise.all([
      supabase.rpc('get_organization_module_catalog', {
        p_organization_id: nextOrganizationId,
      }),
      supabase
        .from('organizations')
        .select('business_type,business_profile')
        .eq('id', nextOrganizationId)
        .maybeSingle(),
    ]);

    if (requestId !== requestSequence.current) return;

    const moduleError = modulesResult.error;
    if (moduleError) {
      if (isMissingModuleRpcError(moduleError)) {
        setAccess(ALL_ENABLED);
        setCompatibilityFallback(true);
      } else if (!cached) {
        setAccess(ALL_DISABLED);
        setCompatibilityFallback(false);
      }
      setLoading(false);
      return;
    }

    const nextAccess = { ...ALL_ENABLED };
    for (const row of (modulesResult.data ?? []) as ModuleCatalogRow[]) {
      if (ORGANIZATION_MODULE_KEYS.includes(row.feature_key as OrganizationModuleKey)) {
        nextAccess[row.feature_key as OrganizationModuleKey] = row.enabled !== false;
      }
    }

    const runtimeRow = organizationResult.data as OrganizationRuntimeRow | null;
    const nextBusinessType = organizationResult.error
      ? cached?.businessType ?? null
      : runtimeRow?.business_type ?? null;
    const nextBusinessProfile = organizationResult.error
      ? cached?.businessProfile ?? null
      : runtimeRow?.business_profile ?? null;

    setAccess(nextAccess);
    setBusinessType(nextBusinessType);
    setBusinessProfile(nextBusinessProfile);
    setCompatibilityFallback(false);
    setLoading(false);

    writeRuntimeCache(nextOrganizationId, {
      access: nextAccess,
      businessType: nextBusinessType,
      businessProfile: nextBusinessProfile,
    });
  }, [
    branchId,
    branches,
    branchesLoading,
    user?.branch_id,
    userId,
  ]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onRuntimeChanged = () => {
      if (organizationId) {
        try {
          localStorage.removeItem(`${CACHE_PREFIX}${organizationId}`);
        } catch {
          // Ignore cache cleanup failures.
        }
      }
      void refresh();
    };
    window.addEventListener(RUNTIME_CHANGED_EVENT, onRuntimeChanged);
    return () => window.removeEventListener(RUNTIME_CHANGED_EVENT, onRuntimeChanged);
  }, [organizationId, refresh]);

  const runtime = useMemo(
    () => resolveBusinessRuntime(businessType, businessProfile),
    [businessProfile, businessType],
  );

  const canAccessModule = useCallback(
    (moduleKey: OrganizationModuleKey | null | undefined) => {
      if (!moduleKey) return true;
      return access[moduleKey] !== false;
    },
    [access],
  );

  const hasCapability = useCallback(
    (capability: string) => runtime.capabilities.has(capability),
    [runtime],
  );

  const canAccessPath = useCallback(
    (pathname: string) => businessPathAllowed(runtime, pathname),
    [runtime],
  );

  const value = useMemo<OrganizationModulesContextValue>(() => ({
    organizationId,
    businessType,
    businessProfile,
    runtime,
    loading,
    compatibilityFallback,
    access,
    canAccessModule,
    hasCapability,
    canAccessPath,
    refresh,
  }), [
    organizationId,
    businessType,
    businessProfile,
    runtime,
    loading,
    compatibilityFallback,
    access,
    canAccessModule,
    hasCapability,
    canAccessPath,
    refresh,
  ]);

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
