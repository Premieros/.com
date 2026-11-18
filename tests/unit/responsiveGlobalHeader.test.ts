import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('src/components/Layout.tsx', 'utf8');
const branches = readFileSync('src/components/BranchScopeSelector.tsx', 'utf8');
const search = readFileSync('src/components/CommandPalette.tsx', 'utf8');

describe('compact RTL/LTR global header', () => {
  it('keeps header controls in bounded flex areas instead of overlapping them', () => {
    expect(layout).toContain('data-testid="app-header-navigation"');
    expect(layout).toContain('data-testid="app-header-utilities"');
    expect(layout).toContain('flex min-w-0 flex-1 items-center justify-end');
    expect(layout).toContain('data-testid="header-branch-wrapper"');
    expect(layout).toContain('max-w-[135px] shrink xl:max-w-[180px]');
    expect(layout).toContain('data-testid="header-pos-shortcut"');
  });

  it('hides only optional text on narrower screens while preserving accessible buttons', () => {
    expect(layout).toContain('hidden 2xl:inline');
    expect(layout).toContain('hidden min-w-0 max-w-32 text-start 2xl:block');
    expect(layout).toContain('data-testid="language-toggle"');
    expect(layout).toContain('data-testid="sign-out-button"');
    expect(layout).toContain('data-testid="theme-toggle"');
    expect(layout).toContain('data-testid="mobile-sidebar-controls"');
    expect(search).toContain('hidden xl:inline');
    expect(search).toContain('2xl:inline');
    expect(search).toContain('OPEN_COMMAND_PALETTE_EVENT');
  });

  it('truncates the branch trigger without clipping the selection popover', () => {
    expect(branches).toContain('<div ref={ref} className="relative min-w-0">');
    expect(branches).toContain('flex w-full min-w-0 items-center');
    expect(branches).toContain('min-w-0 flex-1 truncate text-start');
    expect(branches).toContain('data-testid="branch-scope-menu"');
    expect(branches).toContain('data-testid="action-branch-select"');
  });
});
