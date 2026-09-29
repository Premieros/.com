import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/api';
import { applyBrandColor, applySurfaceColor } from '@/lib/brandColor';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';
import { useBranches } from '@/hooks/useBranches';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useAuth } from '@/context/AuthContext';
import type { BusinessProfileKey } from './businessProfiles';
import {
  ORGANIZATION_EXPERIENCE_PRESETS,
  resolveOrganizationExperience,
  type OrganizationExperiencePreset,
} from './organizationExperience';

interface OrganizationExperienceContextValue {
  loading: boolean;
  businessType: BusinessProfileKey;
  experience: OrganizationExperiencePreset;
}

const OrganizationExperienceContext = createContext<OrganizationExperienceContextValue | undefined>(undefined);

export function OrganizationExperienceProvider({ children }: { children: ReactNode }) {
  const { organizationId } = useOrganizationModules();
  const { branches } = useBranches();
  const branchId = useBranchFilter();
  const { user } = useAuth();
  const branchOrganizationId = useMemo(() => {
    const branch = branches.find((candidate) => candidate.id === branchId)
      ?? branches.find((candidate) => candidate.id === user?.branch_id)
      ?? branches[0]
      ?? null;
    return branch?.organization_id ?? null;
  }, [branchId, branches, user?.branch_id]);
  const effectiveOrganizationId = organizationId ?? branchOrganizationId;
  const [loading, setLoading] = useState(false);
  const [businessType, setBusinessType] = useState<BusinessProfileKey>('custom');
  const [experience, setExperience] = useState<OrganizationExperiencePreset>(
    ORGANIZATION_EXPERIENCE_PRESETS.custom,
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!effectiveOrganizationId) {
        setBusinessType('custom');
        setExperience(ORGANIZATION_EXPERIENCE_PRESETS.custom);
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data, error } = await supabase
        .from('organizations')
        .select('business_type,business_profile')
        .eq('id', effectiveOrganizationId)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        setBusinessType('custom');
        setExperience(ORGANIZATION_EXPERIENCE_PRESETS.custom);
        setLoading(false);
        return;
      }

      const nextType = (data.business_type || 'custom') as BusinessProfileKey;
      const nextExperience = resolveOrganizationExperience(
        nextType,
        (data.business_profile || {}) as Record<string, unknown>,
      );

      setBusinessType(nextType);
      setExperience(nextExperience);
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [effectiveOrganizationId]);

  useEffect(() => {
    applyBrandColor(experience.theme.brandHue, experience.theme.brandSat);
    applySurfaceColor(experience.theme.surfaceHue, experience.theme.surfaceSat);

    const root = document.documentElement;
    root.classList.toggle('dark', experience.theme.mode === 'dark');
    root.dataset.organizationTheme = experience.theme.key;
    root.dataset.organizationRadius = experience.theme.radius;
    root.dataset.posLayout = experience.posLayout.key;

    const radiusScale = experience.theme.radius === 'compact'
      ? { sm: '4px', base: '8px', lg: '10px', xl: '12px', xxl: '14px' }
      : experience.theme.radius === 'soft'
        ? { sm: '10px', base: '14px', lg: '18px', xl: '22px', xxl: '28px' }
        : { sm: '8px', base: '12px', lg: '16px', xl: '20px', xxl: '24px' };

    root.style.setProperty('--ui-radius-sm', radiusScale.sm);
    root.style.setProperty('--ui-radius', radiusScale.base);
    root.style.setProperty('--ui-radius-lg', radiusScale.lg);
    root.style.setProperty('--ui-radius-xl', radiusScale.xl);
    root.style.setProperty('--ui-radius-2xl', radiusScale.xxl);
  }, [experience]);

  const value = useMemo(
    () => ({ loading, businessType, experience }),
    [loading, businessType, experience],
  );

  return (
    <OrganizationExperienceContext.Provider value={value}>
      {children}
    </OrganizationExperienceContext.Provider>
  );
}

export function useOrganizationExperience(): OrganizationExperienceContextValue {
  const ctx = useContext(OrganizationExperienceContext);
  if (!ctx) throw new Error('useOrganizationExperience must be used within OrganizationExperienceProvider');
  return ctx;
}
