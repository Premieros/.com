import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(name, 'utf8');

describe('consistent page opening layout in Premier', () => {
  it('places page title and actions in stable responsive header zones', () => {
    const header = read('src/components/PageHeader.tsx');
    expect(header).toContain('sm:grid-cols-[minmax(0,1fr)_minmax(0,auto)]');
    expect(header).toContain('sm:min-h-12');
    expect(header).toContain('data-testid="page-title"');
    expect(header).toContain('data-testid="page-actions"');
    expect(header).toContain('sm:justify-end');
  });

  it('keeps filter row and panel controls compact and aligned consistently', () => {
    const design = read('src/components/design/DesignSurface.tsx');
    const panel = read('src/components/design/DesignPanel.tsx');
    expect(design).toContain('data-testid="design-filter-bar"');
    expect(design).toContain('min-h-11 min-w-0 flex-wrap items-center justify-start');
    expect(panel).toContain('flex-wrap items-center justify-between gap-2');
    expect(panel).toContain('px-4 py-3');
  });

  it('preserves the fixed application header and existing table-scroll design', () => {
    const layout = read('src/components/Layout.tsx');
    const table = read('src/components/DataTable.tsx');
    expect(layout).toContain('h-[64px]');
    expect(layout).toContain('data-testid="header-pos-shortcut"');
    expect(table).toContain('data-testid="data-table-scroll"');
    expect(table).toContain('sticky top-0 z-20');
  });
});
