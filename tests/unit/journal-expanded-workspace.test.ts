import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const journal = readFileSync('src/features/accounting/pages/JournalPage.tsx', 'utf8');
const styles = readFileSync('src/index.css', 'utf8');

describe('journal full-screen ledger workspace', () => {
  it('opens expanded by default on desktop and can return to normal mode', () => {
    expect(journal).toContain("window.matchMedia('(min-width: 768px)').matches");
    expect(journal).toContain('data-testid="journal-expanded-workspace"');
    expect(journal).toContain('className="fixed inset-0 z-[65]');
    expect(journal).toContain('setTableExpanded(false)');
    expect(journal).toContain('setTableExpanded(true)');
  });

  it('keeps search and date filters usable in expanded mode', () => {
    expect(journal).toContain('data-testid="journal-expanded-filters"');
    expect(journal).toContain('testId="journal-expanded-search"');
    expect(journal).toContain('data-testid="journal-expanded-table"');
    expect(journal).toContain('onChange={(e) => setRefType(e.target.value)}');
  });

  it('allocates remaining vertical space to rows without a short viewport cap', () => {
    expect(styles).toContain('[data-testid="journal-expanded-table"] > [data-testid="data-table"]');
    expect(styles).toContain('[data-testid="journal-expanded-table"] [data-table-viewport]');
    expect(styles).toContain('flex: 1 1 auto;');
    expect(styles).toContain('max-height: none;');
    expect(styles).toContain('overflow: auto;');
  });
});
