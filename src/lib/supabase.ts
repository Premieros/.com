import { createClient } from '@supabase/supabase-js';
import { postgrestDedupingFetch } from './postgrestDedupingFetch';
import { resolvePremierDatabaseUrl } from './premierDatabaseIdentity';

// All Premier API domains must use this one client. Never silently connect to
// a different Supabase project when a preview/production environment drifts.
const supabaseUrl = resolvePremierDatabaseUrl(
  import.meta.env.VITE_SUPABASE_URL as string | undefined,
);

// The build-only placeholder stays for existing CI/browser smoke fixtures.
// Production connectivity is verified by the authenticated System Health RPC.
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
