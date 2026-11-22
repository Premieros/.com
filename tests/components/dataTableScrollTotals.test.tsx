import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/lib/branchScope', () => ({
  useBranchScope: () => ({
    branches: [{ id: 'a', name: 'Branch A', name_en: 'Branch A' }],
    selectedBranchIds: ['a'],
    selectedBranchSet: new Set(['a']),
    scopeKey: 'a',
  }),
}));

import { DataTable, type Column } from '@/components/DataTable';

type Row = { id: string; branch_id: string; amount: number };
const rows: Row[] = [
  { id: 'a1', branch_id: 'a', amount: 12 },
  { id: 'a2', branch_id: 'a', amount: 23 },
  { id: 'b1', branch_id: 'b', amount: 999 },
];
const columns: Column<Row>[] = [
  { key: 'id', header: 'Reference', render: (r) => r.id },
  { key: 'amount', header: 'Amount', render: (r) => r.amount },
];

describe('shared DataTable scrolling and scoped footer', () => {
  it('keeps sticky headings and aligned totals inside the table, with the row count outside', () => {
    const { container } = render(
      <DataTable columns={columns} data={rows} tableId="table-scoped-test"
        columnTotals={[{ key: 'amount', label: 'Visible amount', value: (r) => r.amount, format: (v) => v.toFixed(2) }]} />,
    );
    const scroll = screen.getByTestId('data-table-scroll');
    const footer = screen.getByTestId('data-table-footer');
    expect(scroll.className).toContain('overflow-auto');
    expect(scroll).toHaveAttribute('data-table-viewport');
    expect(scroll.querySelector('tfoot')?.className).toContain('sticky');
    expect(scroll.querySelector('thead')?.className).toContain('sticky');
    expect(scroll.contains(footer)).toBe(false);
    expect(footer).toHaveTextContent('Visible rows: 2');
    expect(scroll.querySelector('tfoot tr')?.children[1]).toContainElement(screen.getByTestId('data-table-total-amount'));
    expect(screen.getByTestId('data-table-total-amount')).toHaveTextContent('35.00');
    expect(container.textContent).not.toContain('999');
  });

  it('recomputes totals after column filtering without clipping its menu into the scroll area', () => {
    render(
      <DataTable columns={columns} data={rows} tableId="table-filter-test"
        columnTotals={[{ key: 'amount', label: 'Visible amount', value: (r) => r.amount, format: String }]} />,
    );
    const buttons = screen.getAllByRole('button', { name: 'Column filter options' });
    fireEvent.click(buttons[1]);
    const menu = screen.getByTestId('data-table-filter-menu');
    expect(screen.getByTestId('data-table-scroll').contains(menu)).toBe(false);
    fireEvent.change(screen.getByLabelText('Text filter in column'), { target: { value: '23' } });
    expect(screen.getByTestId('data-table-footer')).toHaveTextContent('Visible rows: 1');
    expect(screen.getByTestId('data-table-total-amount')).toHaveTextContent('23');
  });
});
