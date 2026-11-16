import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('src/components/Layout.tsx', 'utf8');
const css = readFileSync('src/index.css', 'utf8');

describe('Premier shared top space on every app screen', () => {
  it('caps the fixed top toolbar at ten percent of the viewport', () => {
    expect(css).toContain('--premier-topbar-height: min(64px, 10vh)');
    expect(css).toContain('--premier-topbar-height: min(64px, 10dvh)');
    expect(layout).toContain('h-[var(--premier-topbar-height)]');
    expect(layout).toContain('data-testid="app-header"');
  });

  it('reserves exactly the same height for content on every route', () => {
    expect(layout).toContain('pt-[var(--premier-topbar-height)]');
    expect(layout.match(/min-h-\\[calc\\(100vh-var\\(--premier-topbar-height\\)\\)\\]/g))
      .toHaveLength(2);
    expect(layout).not.toContain('pt-[64px]');
    expect(layout).not.toContain('h-[64px]');
    expect(layout).not.toContain('calc(100vh-64px)');
  });

  it('keeps the compact layout responsive without changing header actions', () => {
    expect(layout).toContain('data-testid="header-pos-shortcut"');
    expect(layout).toContain('<BranchScopeSelector compact />');
    expect(layout).toContain('<CommandPaletteTrigger />');
    expect(layout).toContain('data-testid="user-menu-button"');
    expect(layout).toContain('lg:pt-4');
  });
});
