import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPaginatedRowsSessionCache, usePaginatedRows } from '@/hooks/usePaginatedRows';

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test-user' } }) }));
vi.mock('@/api', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_column: string, branch: string) => ({ range: (from: number) => read(branch, from) }),
      }),
    }),
  },
}));

describe('paginated table scope', () => {
  beforeEach(() => { read.mockReset(); clearPaginatedRowsSessionCache(); });

  it('clears cached rows when the server revokes access', async () => {
    read.mockResolvedValueOnce({ data: ['restricted invoice'], error: null });
    const { result } = renderHook(() => usePaginatedRows<string>({ table: 'scope-proof', branch_id: 'first' }));
    await waitFor(() => expect(result.current.rows).toEqual(['restricted invoice']));
    read.mockResolvedValueOnce({ data: null, status: 403, error: { code: '42501', message: 'permission denied' } });
    await act(() => result.current.refresh());
    expect(result.current.rows).toEqual([]);
    expect(result.current.error).toBeTruthy();
  });

  it('ignores callbacks retained before switching branches and cancels an old export', async () => {
    let completeExport!: (result: { data: string[]; error: null }) => void;
    read.mockResolvedValueOnce({ data: ['first'], error: null });
    read.mockImplementationOnce(() => new Promise(resolve => { completeExport = resolve; }));
    read.mockResolvedValue({ data: ['second'], error: null });

    const { result, rerender } = renderHook(
      ({ branch }) => usePaginatedRows<string>({ table: 'scope-proof', branch_id: branch }),
      { initialProps: { branch: 'first' } },
    );
    await waitFor(() => expect(result.current.rows).toEqual(['first']));
    const oldRefresh = result.current.refresh;
    const oldUpdate = result.current.setRows;
    const cancelled = expect(result.current.fetchAll()).rejects.toThrow('PAGINATED_SCOPE_CHANGED');

    rerender({ branch: 'second' });
    await waitFor(() => expect(result.current.rows).toEqual(['second']));
    await act(async () => {
      await oldRefresh();
      oldUpdate(['old branch data']);
      completeExport({ data: ['first'], error: null });
    });
    await cancelled;
    expect(result.current.rows).toEqual(['second']);
    expect(read.mock.calls.filter(([branch]) => branch === 'first')).toHaveLength(2);
  });
});
