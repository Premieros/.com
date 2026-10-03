import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/api';
import { useAuth } from '@/context/AuthContext';
import type { Branch } from '@/lib/types';
import { userFacingErrorMessage } from '@/lib/userFacingError';

const BRANCHES_CHANGED_EVENT = 'premier:branches-changed';
const branchCacheByUser = new Map<string, Branch[]>();
const branchRequestByUser = new Map<string, Promise<Branch[]>>();

async function fetchBranchesForUser(userId: string, force = false): Promise<Branch[]> {
  const cached = branchCacheByUser.get(userId);
  if (!force && cached !== undefined) return cached;

  const existing = branchRequestByUser.get(userId);
  if (existing) return existing;

  const pending = (async () => {
    const { data, error } = await supabase.from('branches').select('*').order('name');
    if (error) throw error;
    const next = (data as Branch[]) || [];
    branchCacheByUser.set(userId, next);
    try {
      if (typeof localStorage !== 'undefined' && next.length > 0) {
        localStorage.setItem('premier:cached_branches', JSON.stringify(next));
      }
    } catch {
      // ignore
    }
    return next;
  })().finally(() => {
    branchRequestByUser.delete(userId);
  });

  branchRequestByUser.set(userId, pending);
  return pending;
}

export function notifyBranchesChanged(): void {
  branchCacheByUser.clear();
  branchRequestByUser.clear();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(BRANCHES_CHANGED_EVENT));
  }
}

function getInitialBranches(userId: string | null): Branch[] {
  if (!userId) return [];
  const inMem = branchCacheByUser.get(userId);
  if (inMem && inMem.length > 0) return inMem;
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('premier:cached_branches');
      if (saved) return JSON.parse(saved) as Branch[];
    }
  } catch {
    // ignore
  }
  return [];
}

export function useBranches() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const initial = getInitialBranches(userId);
  const [branches, setBranches] = useState<Branch[]>(initial);
  const [loading, setLoading] = useState(Boolean(userId) && initial.length === 0);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) {
      setBranches([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(branches.length === 0);
    try {
      const next = await fetchBranchesForUser(userId, true);
      setBranches(next);
      setError(null);
    } catch (err) {
      // Offline fallback: keep current branches or read from storage
      const fallback = getInitialBranches(userId);
      if (fallback.length > 0) {
        setBranches(fallback);
        setError(null);
      } else {
        setBranches([]);
        setError(userFacingErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }, [userId, branches.length]);

  useEffect(() => {
    if (!userId) {
      setBranches([]);
      setLoading(false);
      setError(null);
      return;
    }

    const sessionCached = branchCacheByUser.get(userId);
    if (sessionCached !== undefined) {
      setBranches(sessionCached);
      setLoading(false);
      setError(null);
    } else {
      void refresh();
    }

    if (typeof window === 'undefined') return;
    const onBranchesChanged = () => {
      branchCacheByUser.delete(userId);
      void refresh();
    };
    window.addEventListener(BRANCHES_CHANGED_EVENT, onBranchesChanged);
    return () => window.removeEventListener(BRANCHES_CHANGED_EVENT, onBranchesChanged);
  }, [refresh, userId]);

  return { branches, loading, error, refresh };
}
