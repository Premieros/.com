import { createClient } from '@supabase/supabase-js';
import { createPostgrestDedupingFetch } from './postgrestDedupingFetch';
import { websitePhotoRequestUrl } from './websitePhotoRequest';

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
    fetch: createPostgrestDedupingFetch((input, init) => {
      const origin = typeof window === 'undefined' ? '' : window.location.origin;
      const photoUrl = websitePhotoRequestUrl(input, init, origin);
      return globalThis.fetch(photoUrl ?? input, init);
    }),
  },
});

