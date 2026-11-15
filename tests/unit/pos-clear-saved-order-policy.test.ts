import { describe, expect, it } from 'vitest';
import { resolveCartClearAction } from '../../src/features/pos/utils/clearCartPolicy';

describe('POS cart clear versus persisted table order', () => {
  it('clears only the transient cart when there is no saved order', () => {
    expect(resolveCartClearAction(null, false)).toBe('clear-local');
    expect(resolveCartClearAction(null, true)).toBe('clear-local');
  });

  it('always sends a persisted table order through audited server cancellation', () => {
    expect(resolveCartClearAction('saved-order-id', true)).toBe('cancel-saved-order');
  });

  it('never hides a saved order from UI for an operator without cancellation permission', () => {
    expect(resolveCartClearAction('saved-order-id', false)).toBe('permission-denied');
  });
});
