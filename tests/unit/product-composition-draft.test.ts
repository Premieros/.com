import { describe, expect, it } from 'vitest';
import { includePendingComponent, assertSavedComponentRows } from '@/features/catalog/productCompositionDraft';
type Row = { id: string; quantity: number };
const id = (row: Row) => row.id;
const create = (id: string, quantity: number): Row => ({ id, quantity });
describe('product composition save', () => {
  it('includes a selected component without an Add click', () => {
    expect(includePendingComponent([], 'raw', .125, id, create)).toEqual([{ id: 'raw', quantity: .125 }]);
  });
  it('retains existing components when a manufactured group is selected', () => {
    const rows = [{ id: 'existing', quantity: 2 }];
    expect(includePendingComponent(rows, 'manufactured', .5, id, create)).toEqual([...rows, { id: 'manufactured', quantity: .5 }]);
    expect(rows).toHaveLength(1);
  });
  it('rejects duplicates and invalid quantities', () => {
    expect(() => includePendingComponent([{ id: 'raw', quantity: 1 }], 'raw', 2, id, create)).toThrow();
    expect(() => includePendingComponent([], 'raw', 0, id, create)).toThrow();
  });
  it('rejects missing or incorrect persisted rows', () => {
    const expected = [{ id: 'manufactured', quantity: .5 }];
    expect(() => assertSavedComponentRows(expected, [], id)).toThrow('COMPONENTS_NOT_SAVED');
    expect(() => assertSavedComponentRows(expected, [{ id: 'manufactured', quantity: 1 }], id)).toThrow();
    expect(() => assertSavedComponentRows(expected, [{ id: 'manufactured', quantity: .5 }], id)).not.toThrow();
  });
});
