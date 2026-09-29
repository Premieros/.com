import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/api';
import { applyBrandColor, applySurfaceColor } from '@/lib/brandColor';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';
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
  const [loading, setLoading] = useState(false);
  const [businessType, setBusinessType] = useState<BusinessProfileKey>('custom');
  const [experience, setExperience] = useState<OrganizationExperiencePreset>(
    ORGANIZATION_EXPERIENCE_PRESETS.custom,
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!organizationId) {
        setBusinessType('custom');
        setExperience(ORGANIZATION_EXPERIENCE_PRESETS.custom);
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data, error } = await supabase
        .from('organizations')
        .select('business_type,business_profile')
        .eq('id', organizationId)
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
  }, [organizationId]);

  useEffect(() => {
    applyBrandColor(experience.theme.brandHue, experience.theme.brandSat);
    applySurfaceColor(experience.theme.surfaceHue, experience.theme.surfaceSat);
    document.documentElement.classList.toggle('dark', experience.theme.mode === 'dark');
    document.documentElement.dataset.organizationTheme = experience.theme.key;
    document.documentElement.dataset.organizationRadius = experience.theme.radius;
    document.documentElement.dataset.posLayout = experience.posLayout.key;
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
