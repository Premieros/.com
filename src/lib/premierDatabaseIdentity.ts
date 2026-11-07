/**
 * Canonical database identity for Premieros/.com.
 *
 * This guards against a wrong VITE_SUPABASE_URL in a deploy/preview environment.
 * It is a project-identity check, not a substitute for RLS, authentication, or
 * a live API health check.
 */
export const PREMIER_DATABASE_URL = 'https://hvqlkapynjfjikqithvd.supabase.co';

export function resolvePremierDatabaseUrl(configuredUrl: string | undefined | null): string {
  const normalized = (configuredUrl ?? '').trim().replace(/\/+$/, '');

  if (normalized && normalized !== PREMIER_DATABASE_URL) {
    throw new Error(
      'PREMIER_DATABASE_IDENTITY_MISMATCH: Refusing to connect this client to a non-Premier Supabase project.',
    );
  }

  return PREMIER_DATABASE_URL;
}
