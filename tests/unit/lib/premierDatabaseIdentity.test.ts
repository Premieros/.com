import { describe, expect, it } from 'vitest';
import { PREMIER_DATABASE_URL, resolvePremierDatabaseUrl } from '@/lib/premierDatabaseIdentity';

describe('Premier canonical database identity', () => {
  it('uses the existing Premier production project when no URL override is provided', () => {
    expect(resolvePremierDatabaseUrl(undefined)).toBe(PREMIER_DATABASE_URL);
    expect(resolvePremierDatabaseUrl('')).toBe(PREMIER_DATABASE_URL);
    expect(resolvePremierDatabaseUrl(null)).toBe(PREMIER_DATABASE_URL);
  });

  it('accepts only the canonical project URL, tolerating whitespace and trailing slashes', () => {
    expect(resolvePremierDatabaseUrl(PREMIER_DATABASE_URL)).toBe(PREMIER_DATABASE_URL);
    expect(resolvePremierDatabaseUrl(`  ${PREMIER_DATABASE_URL}///  `)).toBe(PREMIER_DATABASE_URL);
  });

  it('fails closed instead of sending users and orders to another Supabase project', () => {
    for (const url of [
      'https://example.supabase.co',
      'http://hvqlkapynjfjikqithvd.supabase.co',
      'https://hvqlkapynjfjikqithvd.supabase.co/rest/v1',
      'https://hvqlkapynjfjikqithvd.supabase.co.evil.example',
    ]) {
      expect(() => resolvePremierDatabaseUrl(url)).toThrow('PREMIER_DATABASE_IDENTITY_MISMATCH');
    }
  });
});
