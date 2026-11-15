import { describe, expect, it } from 'vitest';
import { moveReportColumn, orderReportColumns, projectReportColumns } from '../../src/features/reporting/reportColumnLayout';

describe('report column order integration', () => {
  it('retains saved order while appending newly available fields', () => {
    expect(orderReportColumns(['Branch', 'Sales', 'Tax'], ['Sales', 'Removed', 'Branch']))
      .toEqual(['Sales', 'Branch', 'Tax']);
  });

  it('ignores saved duplicate or removed fields', () => {
    expect(orderReportColumns(['Branch', 'Sales'], ['Sales', 'Sales', 'Missing']))
      .toEqual(['Sales', 'Branch']);
  });

  it('reorders columns without changing their membership', () => {
    expect(moveReportColumn(['Branch', 'Sales', 'Tax'], [], 'Tax', -1))
      .toEqual(['Branch', 'Tax', 'Sales']);
  });

  it('exports only selected columns in display order, including null or zero values', () => {
    const rows = [{ Branch: 'A', Sales: 0, Tax: null, Secret: 'excluded' }];
    const output = projectReportColumns(rows, ['Tax', 'Sales']);
    expect(output).toEqual([{ Tax: null, Sales: 0 }]);
    expect(Object.keys(output[0])).toEqual(['Tax', 'Sales']);
    expect(rows[0]).toHaveProperty('Secret', 'excluded');
  });

  it('produces empty objects when no columns are visible', () => {
    expect(projectReportColumns([{ Branch: 'A' }], [])).toEqual([{}]);
  });

  it('does not move a column outside the available range', () => {
    expect(moveReportColumn(['Branch', 'Sales'], [], 'Branch', -1))
      .toEqual(['Branch', 'Sales']);
    expect(moveReportColumn(['Branch', 'Sales'], [], 'Sales', 1))
      .toEqual(['Branch', 'Sales']);
  });
});
