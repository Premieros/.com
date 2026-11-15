import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { CustomReportBar } from '../../src/features/reporting/CustomReportBar';
import { useColumnPreferences } from '../../src/features/reporting/useColumnPreferences';

describe('saved report views', () => {
  beforeEach(() => {
    localStorage.removeItem('premire_report_columns');
    localStorage.removeItem('premire_report_column_order');
  });
  afterEach(() => vi.restoreAllMocks());

  it('offers Save Current View on a fresh installation with no presets', () => {
    const save = vi.fn();
    render(<CustomReportBar
      savedReports={[]}
      currentReportType="sales"
      currentVisibleColumns={null}
      currentFilters={{}}
      onSelect={vi.fn()}
      onSave={save}
      onDelete={vi.fn()}
      lang="en"
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Save Current View' }));
    expect(save).toHaveBeenCalledOnce();
  });

  it('restores a saved column set for another report type and persists it', () => {
    const { result, rerender } = renderHook(({ type }) => useColumnPreferences(type), {
      initialProps: { type: 'sales' },
    });
    act(() => result.current.restoreVisibleColumns('purchases', ['Supplier', 'Net Total']));
    rerender({ type: 'purchases' });
    expect(result.current.visibleColumns).toEqual(['Supplier', 'Net Total']);
    expect(JSON.parse(localStorage.getItem('premire_report_columns') || '{}'))
      .toMatchObject({ purchases: ['Supplier', 'Net Total'] });

    act(() => result.current.restoreVisibleColumns('purchases', null));
    expect(result.current.visibleColumns).toBeNull();
  });
});
