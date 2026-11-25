import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('src/components/Layout.tsx', 'utf8');
const dashboard = readFileSync('src/features/dashboard/pages/DashboardEnhancedPage.tsx', 'utf8');
const styles = readFileSync('src/index.css', 'utf8');

describe('Premier motion phase one', () => {
  it('keeps the existing sidebar and NavLink routes and slides accordion content instead of unmounting', () => {
    expect(layout).toContain('data-testid="app-sidebar"');
    expect(layout).toContain('premier-motion-navigation');
    expect(layout).toContain('data-testid={`nav-group-panel-${group}`}');
    expect(layout).toContain('aria-hidden={collapsed[group]}');
    expect(layout).toContain('tabIndex={collapsed[group] ? -1 : undefined}');
    expect(layout).not.toContain('{!collapsed[group] && (');
    expect(layout).toContain('onClick={() => setCollapsed((v) => ({ ...v, [group]: !v[group] }))}');
    expect(layout).toContain('onPointerEnter={() => prefetchAppRoute(item.route)}');
  });

  it('uses the existing dashboard markup with entrance-only motion', () => {
    expect(dashboard).toContain('dashboard-compact-cleanup premier-motion-dashboard');
    expect(styles).toContain('[data-testid="dashboard-permission-kpis"] > *');
    expect(styles).toContain('premier-content-enter');
  });

  it('does not add a dependency and respects reduced motion', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.dependencies?.gsap).toBeUndefined();
    expect(pkg.dependencies?.['framer-motion']).toBeUndefined();
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('animation: none !important;');
  });
});
