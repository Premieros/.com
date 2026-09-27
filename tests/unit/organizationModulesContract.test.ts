import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const identity = readFileSync('scripts/db/verify-database-identity.js', 'utf8');
const plan = readFileSync('docs/CURRENT_WORK_PLAN.md', 'utf8');
const modules = readFileSync('src/core/modules/module.config.ts', 'utf8');
const routes = readFileSync('src/app/routes.tsx', 'utf8');
const layout = readFileSync('src/components/Layout.tsx', 'utf8');

describe('new-project identity and organization module contract', () => {
  it('hard-locks repository and Supabase identities', () => {
    expect(identity).toContain("EXPECTED_REPOSITORY = 'Premieros/.com'");
    expect(identity).toContain("BLOCKED_REPOSITORIES = new Set(['Premieros/johna-s'])");
    expect(identity).toContain("EXPECTED_PROJECT_REF = 'hvqlkapynjfjikqithvd'");
    expect(identity).toContain("BLOCKED_PROJECT_REF = 'azzdesuowpdcoflmyezn'");
    expect(plan).toContain('Repository الوحيد المسموح بالكتابة عليه: `Premieros/.com`');
    expect(plan).toContain('`Premieros/johna-s`');
    expect(plan).toContain('`azzdesuowpdcoflmyezn`');
  });

  it('combines module availability with Permission-First navigation and routes', () => {
    expect(modules).toContain('ORGANIZATION_MODULES');
    expect(modules).toContain('moduleForRoute');
    expect(layout).toContain('canAccessModule(moduleForRoute(item.route))');
    expect(routes).toContain('const routeModule = moduleForPath(location.pathname)');
    expect(routes).toContain('if (!canAccessModule(routeModule))');
    expect(routes).toContain('if (permission && !can(permission))');
  });
});
