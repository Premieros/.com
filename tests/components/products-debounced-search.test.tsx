import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

describe('debounced server-side product search', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });
  it('preserves a responsive input without issuing each intermediate search', () => {
    const { result, rerender } = renderHook(({ term }) => useDebouncedValue(term, 250), {
      initialProps: { term: '' },
    });
    rerender({ term: 'C' });
    act(() => vi.advanceTimersByTime(100));
    rerender({ term: 'Ca' });
    act(() => vi.advanceTimersByTime(100));
    rerender({ term: 'Cap' });
    expect(result.current).toBe('');
    act(() => vi.advanceTimersByTime(249));
    expect(result.current).toBe('');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('Cap');
  });
  it('cancels earlier pending query changes when the user clears the search', () => {
    const { result, rerender } = renderHook(({ term }) => useDebouncedValue(term, 250), {
      initialProps: { term: '' },
    });
    rerender({ term: 'Coffee' });
    act(() => vi.advanceTimersByTime(100));
    rerender({ term: '' });
    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe('');
  });
});
