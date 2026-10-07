import { useCallback, useEffect, useState } from 'react';
import { catalog, type KitchenCompletedHistoryResult } from '@/api/domains/catalog';
import { businessDateISO, reportDateRangeUtc } from '@/lib/businessTime';
import { userFacingErrorMessage } from '@/lib/userFacingError';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';

export function KitchenCompletedHistory({ branchId, station, ar }: { branchId: string; station: string; ar: boolean }) {
  const [from, setFrom] = useState(businessDateISO);
  const [to, setTo] = useState(businessDateISO);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<KitchenCompletedHistoryResult>({ rows: [], count: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!from || !to || from > to) return;
    setLoading(true);
    setError('');
    try {
      const bounds = reportDateRangeUtc(from, to);
      const { data: result, error: readError } = await catalog.getKitchenCompletedHistory({
        p_branch_id: branchId,
        p_from_ts: bounds.startIso,
        p_to_ts: bounds.endExclusiveIso,
        p_station: station || null,
        p_page: page,
      });
      if (readError) throw readError;
      setData(result || { rows: [], count: 0 });
    } catch (readError) {
      setError(userFacingErrorMessage(readError, ar ? 'ar' : 'en'));
    } finally {
      setLoading(false);
    }
  }, [ar, branchId, from, page, station, to]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div data-testid="kds-completed-history" className="space-y-3">
      <p className="text-sm text-ui-muted">
        {ar ? 'الطلبات المكتملة تلقائيًا بعد 40 دقيقة أو المكتملة يدويًا.' : 'Orders completed automatically after 40 minutes or completed manually.'}
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <Input type="date" label={ar ? 'من' : 'From'} value={from} onChange={e => { setFrom(e.target.value); setPage(0); }} />
        <Input type="date" label={ar ? 'إلى' : 'To'} value={to} onChange={e => { setTo(e.target.value); setPage(0); }} />
        <Button variant="outline" disabled={loading} onClick={() => void load()}>
          {ar ? 'تحديث المكتمل' : 'Refresh completed'}
        </Button>
      </div>

      {error && <div className="rounded-xl bg-ui-danger/10 p-3 text-sm font-bold text-ui-danger">{error}</div>}
      {loading && <p className="text-sm text-ui-muted">{ar ? 'جاري التحميل...' : 'Loading...'}</p>}

      {!loading && !error && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-bold text-ui-muted">{ar ? 'الإجمالي' : 'Total'}: {data.count}</span>
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(value => value - 1)}>
              {ar ? 'السابق' : 'Previous'}
            </Button>
            <span className="text-xs text-ui-subtle">{page + 1} / {Math.max(1, Math.ceil(data.count / 100))}</span>
            <Button variant="outline" size="sm" disabled={(page + 1) * 100 >= data.count} onClick={() => setPage(value => value + 1)}>
              {ar ? 'التالي' : 'Next'}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.rows.map(row => (
              <div key={row.order_id} className="rounded-xl border border-ui-border bg-ui-surface p-4">
                <p className="text-lg font-black text-ui-text">#{row.order_number}</p>
                {row.table_name && <p className="mt-1 text-sm text-ui-muted">{ar ? 'الطاولة' : 'Table'}: {row.table_name}</p>}
                <p className="mt-2 text-sm font-black text-ui-success">
                  {row.kitchen_status === 'cancelled' ? (ar ? 'ملغي' : 'Cancelled') : (ar ? 'مكتمل' : 'Completed')}
                </p>
                <time dateTime={row.updated_at} className="mt-1 block text-xs text-ui-subtle">
                  {new Date(row.updated_at).toLocaleString(ar ? 'ar-EG' : 'en-GB', { timeZone: 'Africa/Cairo' })}
                </time>
              </div>
            ))}
          </div>

          {!data.rows.length && (
            <p className="py-8 text-center text-ui-muted">
              {ar ? 'لا توجد طلبات مكتملة في هذه الفترة.' : 'No completed orders in this period.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
