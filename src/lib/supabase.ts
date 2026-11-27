import { createClient } from '@supabase/supabase-js';
import { postgrestDedupingFetch } from './postgrestDedupingFetch';

const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ||
  'https://placeholder-project.supabase.co';
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
  'placeholder-anon-key-for-build';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    fetch: postgrestDedupingFetch,
  },
});

