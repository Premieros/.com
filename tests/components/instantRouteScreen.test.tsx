import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';

vi.mock('@/lib/branchScope', () => ({
  useBranchScope: () => ({
    branches: [{ id: 'a', name: 'A', name_en: 'A' }],
    selectedBranchIds: ['a'],
    selectedBranchSet: new Set(['a']),
    scopeKey: 'a',
  }),
}));
import { DataTable, type Column } from '@/components/DataTable';

type Item = { id: string; branch_id: string; name: string };
const columns: Column<Item>[] = [
  { key: 'name', header: 'Customer', render: (row) => row.name },
];
const data: Item[] = [
  { id: '1', branch_id: 'a', name: 'Sensitive customer record' },
];

describe('immediate navigation screen layout', () => {
  it('retains the protected app Layout when a page bundle is loading', () => {
    const routes = readFileSync('src/app/routes.tsx', 'utf8');
    expect(routes).toContain('<Layout><Suspense fallback={<RouteContentFallback />}>{children}</Suspense></Layout>');
    expect(routes).toContain('data-testid="route-content-loading"');
    expect(routes).toContain('aria-busy="true"');
    // Startup authentication loading stays distinct; no bypass of ProtectedRoute.
    expect(routes).toContain('if (loading || rolesLoading || modulesLoading) return <PageLoader />;');
  });

  it('shows bold table headings and stable placeholder rows on first fetch, never stale records', () => {
    render(<DataTable columns={columns} data={data} loading showCheckbox tableId="initial-skeleton-test" />);
    expect(screen.getByTestId('table-loading')).toHaveAttribute('aria-busy', 'true');
    const skeleton = screen.getByTestId('data-table-loading-skeleton');
    expect(skeleton).toHaveTextContent('Customer');
    expect(skeleton.querySelectorAll('tbody tr')).toHaveLength(7);
    expect(screen.queryByText('Sensitive customer record')).not.toBeInTheDocument();
  });

  it('displays authorized records without loading placeholders once loaded', () => {
    render(<DataTable columns={columns} data={data} loading={false} tableId="loaded-test" />);
    expect(screen.queryByTestId('table-loading')).not.toBeInTheDocument();
    expect(screen.getAllByText('Sensitive customer record').length).toBeGreaterThan(0);
  });
});
