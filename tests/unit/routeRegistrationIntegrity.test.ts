import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_ROUTES } from '@/core/navigation/routes';

// Prevent a visible navigation entry from silently losing its actual screen
// when routes are reorganized. Each canonical route must have a Route path.
const appRouteSource = readFileSync(
  new URL('../../src/app/routes.tsx', import.meta.url),
  'utf8',
);

describe('Premier screen-route registration', () => {
  it('registers every canonical screen route (including redirects and restricted pages)', () => {
    for (const [name, path] of Object.entries(APP_ROUTES)) {
      const routePath = `path={APP_ROUTES.${name}}`;
      expect(
        appRouteSource.includes(routePath),
        `Missing <Route ${routePath} /> for ${path}`,
      ).toBe(true);
    }
  });
});
