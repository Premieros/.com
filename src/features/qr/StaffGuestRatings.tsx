import { useEffect, useState } from 'react';
import { Star, RefreshCw } from 'lucide-react';
import { qr } from '@/api/domains/qr';
import type { BranchRatingSummary } from './service';
import { qrError } from './errors';

export function StaffGuestRatings({ branchId }: { branchId: string }) {
  const [state, setState] = useState<BranchRatingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setState(null); setLoading(true); setError('');
    void qr.ratings({ p_branch: branchId }).then(({ data, error: failure }) => {
      if (!active) return;
      if (failure) throw failure;
      setState(data || { count: 0, average: null, recent: [] });
    }).catch(failure => { if (active) setError(qrError(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [branchId, revision]);

  return <details className="mt-4 rounded border border-ui-border p-3" data-testid="qr-branch-ratings">
    <summary className="cursor-pointer font-bold">تقييمات العملاء</summary>
    <div className="mt-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ui-subtle">تقييمات زيارات العملاء من نظام الطلبات QR لهذا الفرع فقط.</p>
        <button type="button" aria-label="تحديث تقييمات العملاء" disabled={loading}
          className="rounded border border-ui-border p-2" onClick={() => setRevision(n => n + 1)}>
          <RefreshCw size={16} /></button>
      </div>
      {loading && <p role="status">جارٍ تحميل التقييمات…</p>}
      {error && <p role="alert" className="text-ui-danger">{error}</p>}
      {state && !loading && <>
        <p className="inline-flex items-center gap-2 font-semibold">
          <Star size={18} fill="currentColor" />
          {state.average == null ? 'لا توجد تقييمات بعد' : `${state.average} / 5`}
          <span className="text-xs font-normal text-ui-subtle">({state.count} تقييم)</span>
        </p>
        {state.recent.map((rating, index) => <article key={`${rating.created_at}-${index}`}
          className="rounded-lg border border-ui-border bg-ui-page-alt p-3 text-sm">
          <p className="font-semibold">عام: {rating.overall}/5 · الطعام: {rating.food}/5 · الخدمة: {rating.service}/5</p>
          {rating.note && <p className="mt-1 whitespace-pre-wrap break-words">{rating.note}</p>}
          <time className="text-xs text-ui-subtle">{new Date(rating.created_at).toLocaleString('ar-EG')}</time>
        </article>)}
      </>}
    </div>
  </details>;
}
