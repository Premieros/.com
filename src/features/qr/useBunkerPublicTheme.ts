import { useEffect, useState } from 'react';
import { supabase } from '@/api';

/** BUNKER storefront theme is published per branch, not taken from a guest's admin preferences. */
export function useBunkerPublicTheme(isBunker: boolean): 'light' | 'dark' {
  const [mode, setMode] = useState<'light' | 'dark'>('dark');
  useEffect(() => {
    if (!isBunker) return;
    let active = true;
    void supabase.rpc('branch_website_theme_public', { p_slug: 'bunker' })
      .then(({ data, error }) => {
        if (active && !error && (data === 'light' || data === 'dark')) setMode(data);
      });
    return () => { active = false; };
  }, [isBunker]);
  return mode;
}
