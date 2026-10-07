import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useBranches } from '@/hooks/useBranches';
import { useActiveBranchId } from './activeBranch';

const STORAGE_KEY = 'premier_branch_scope_v1';

export type BranchScopeMode = 'all' | 'selected';

type StoredBranchScope = {
  mode: BranchScopeMode;
  selectedIds: string[];
};

type Listener = () => void;
const listeners = new Set<Listener>();

function normalizeStored(value: unknown): StoredBranchScope {
  if (!value || typeof value !== 'object') return { mode: 'selected', selectedIds: [] };
  const record = value as Record<string, unknown>;
  const mode: BranchScopeMode = record.mode === 'all' ? 'all' : 'selected';
  const selectedIds = Array.isArray(record.selectedIds)
    ? [...new Set(record.selectedIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : [];
  return { mode, selectedIds };
}

function readStorage(): StoredBranchScope {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeStored(JSON.parse(raw)) : { mode: 'selected', selectedIds: [] };
  } catch {
    return { mode: 'selected', selectedIds: [] };
  }
}

let current = readStorage();

function write(next: StoredBranchScope): void {
  current = normalizeStored(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Keep the in-memory value if storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): StoredBranchScope {
  return current;
}

export function useBranchScope() {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const { branches, loading } = useBranches();
  const [activeBranchId, setActiveBranchId] = useActiveBranchId();

  const activeBranch = useMemo(
    () => branches.find((branch) => branch.id === activeBranchId) ?? null,
    [activeBranchId, branches],
  );

  const organizationBranches = useMemo(() => {
    if (!activeBranch?.organization_id) return branches;
    return branches.filter((branch) => branch.organization_id === activeBranch.organization_id);
  }, [activeBranch?.organization_id, branches]);

  const organizationBranchIds = useMemo(
    () => organizationBranches.map((branch) => branch.id),
    [organizationBranches],
  );

  const selectedBranchIds = useMemo(() => {
    if (stored.mode === 'all') return organizationBranchIds;

    const allowed = new Set(organizationBranchIds);
    const selected = stored.selectedIds.filter((id) => allowed.has(id));
    if (selected.length > 0) return selected;

    if (activeBranchId && allowed.has(activeBranchId)) return [activeBranchId];
    return organizationBranchIds[0] ? [organizationBranchIds[0]] : [];
  }, [activeBranchId, organizationBranchIds, stored.mode, stored.selectedIds]);

  const selectedBranchSet = useMemo(() => new Set(selectedBranchIds), [selectedBranchIds]);
  const allBranchesSelected = organizationBranchIds.length > 0
    && selectedBranchIds.length === organizationBranchIds.length
    && organizationBranchIds.every((id) => selectedBranchSet.has(id));

  const actionBranchId = activeBranchId && selectedBranchSet.has(activeBranchId)
    ? activeBranchId
    : (selectedBranchIds[0] ?? null);

  useEffect(() => {
    if (loading || !actionBranchId || actionBranchId === activeBranchId) return;
    setActiveBranchId(actionBranchId);
  }, [actionBranchId, activeBranchId, loading, setActiveBranchId]);

  const setAllBranches = (enabled: boolean) => {
    if (enabled) {
      write({ mode: 'all', selectedIds: organizationBranchIds });
      return;
    }
    const fallback = actionBranchId ?? organizationBranchIds[0] ?? null;
    write({ mode: 'selected', selectedIds: fallback ? [fallback] : [] });
  };

  const setSelectedBranchIds = (ids: string[]) => {
    const allowed = new Set(organizationBranchIds);
    const next = [...new Set(ids.filter((id) => allowed.has(id)))];
    const fallback = actionBranchId ?? organizationBranchIds[0] ?? null;
    write({
      mode: 'selected',
      selectedIds: next.length > 0 ? next : (fallback ? [fallback] : []),
    });
  };

  const toggleBranch = (branchId: string) => {
    if (!organizationBranchIds.includes(branchId)) return;
    const base = stored.mode === 'all' ? organizationBranchIds : selectedBranchIds;
    const next = base.includes(branchId)
      ? base.filter((id) => id !== branchId)
      : [...base, branchId];

    if (next.length === 0) return;
    write({ mode: 'selected', selectedIds: next });

    if (branchId === activeBranchId && !next.includes(branchId)) {
      setActiveBranchId(next[0] ?? null);
    }
  };

  const setActionBranchId = (branchId: string) => {
    if (!selectedBranchSet.has(branchId)) return;
    setActiveBranchId(branchId);
  };

  return {
    branches,
    organizationBranches,
    selectedBranchIds,
    selectedBranchSet,
    actionBranchId,
    allBranchesSelected,
    isAggregate: selectedBranchIds.length > 1,
    loading,
    setAllBranches,
    setSelectedBranchIds,
    toggleBranch,
    setActionBranchId,
    includesBranch: (branchId: string | null | undefined) => !!branchId && selectedBranchSet.has(branchId),
    scopeKey: selectedBranchIds.slice().sort().join(','),
  };
}
