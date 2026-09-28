import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const menu = readFileSync('src/core/navigation/menu.config.ts', 'utf8');
const layout = readFileSync('src/components/Layout.tsx', 'utf8');
const palette = readFileSync('src/components/CommandPalette.tsx', 'utf8');
const routes = readFileSync('src/app/routes.tsx', 'utf8');

describe('unified reports navigation permissions', () => {
  it('keeps reports consolidated under the Finance Center', () => {
    expect(menu).not.toContain("id: 'reports'");
    expect(menu).not.toContain("id: 'financial-reports'");
    expect(menu).toContain("id: 'finance-center'");
    const finance = readFileSync('src/features/accounting/pages/FinanceCenterPage.tsx', 'utf8');
    expect(finance).toContain('APP_ROUTES.reports');
    expect(finance).toContain("can('reports.view') || can('reports.financial')");
  });

  it('supports any-of permissions consistently in sidebar and command palette', () => {
    expect(layout).toContain('item.permissionsAny.some((permission) => can(permission))');
    expect(palette).toContain('item.permissionsAny.some((permission) => can(permission))');
  });

  it('allows /reports for either reports.view or reports.financial while preserving the legacy financial alias', () => {
    expect(routes).toContain('permissionsAny={["reports.view", "reports.financial"]}');
    expect(routes).toContain('APP_ROUTES.financialReports');
    expect(routes).toContain('permission="reports.financial"><ReportsCenterPage');
  });
});
