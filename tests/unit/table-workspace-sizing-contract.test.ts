import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('src/components/Layout.tsx', 'utf8');
const viewport = readFileSync('src/components/useTableViewport.ts', 'utf8');
const styles = readFileSync('src/index.css', 'utf8');

describe('back-office table workspace sizing', () => {
  it('does not cap ordinary pages at 1600px', () => {
    expect(layout).toContain('const fullWidthContent = true');
    expect(layout).toContain("fullWidthContent ? 'max-w-none'");
  });

  it('fills available desktop height while allowing independent table scrolling', () => {
    expect(styles).toContain('@media (min-width: 640px) {\n  [data-testid="app-main"] [data-table-viewport]');
    expect(styles).toContain('min-height: var(--table-rows-height');
    expect(styles).toContain('max-height: var(--table-rows-height');
  });

  it('uses viewport-relative bounds and reserves table footer space', () => {
    expect(viewport).toContain('bottom - bounds.top - footerHeight - 16');
    expect(viewport).not.toContain('bounds.top - window.scrollY');
    expect(viewport).toContain('[data-testid="data-table-footer"]');
  });
});
