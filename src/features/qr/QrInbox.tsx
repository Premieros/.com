import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCan } from '@/lib/permissions';
import { qrDecide, qrError, qrInbox, type QrRequest } from './service';

export function QrInbox({ branchId, readOnly = false }: { branchId: string; readOnly?: boolean }) {
  const can = useCan();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<QrRequest[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const scope = useRef(branchId); scope.current = branchId;
  const lock = useRef(false);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    setRequests([]); setError(''); setOpen(false);
    if (!branchId || !can('pos.view')) return;
    async function poll() {
      try { const rows = await qrInbox(branchId); if (alive) { setRequests(rows); setError(''); } }
      catch (failure) { if (alive) setError(qrError(failure)); }
      finally { if (alive) timer = setTimeout(() => void poll(), 5000); }
    }
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [branchId, can]);
  async function decide(request: QrRequest, accept: boolean) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    const branch = branchId;
    try {
      const result = await qrDecide(request.id, accept);
      if (scope.current !== branch) return;
      setRequests(rows => rows.filter(r => r.id !== request.id)); setError('');
      if (result.order_id) navigate(`/pos/${result.order_id}`, { state: { branchId: branch } });
    } catch (failure) { if (scope.current === branch) setError(qrError(failure)); }
    finally { lock.current = false; setBusy(false); }
  }
  if (!branchId || !can('pos.view')) return null;
  return <section dir="rtl" className="shrink-0 rounded border border-ui-border bg-ui-surface p-3">
    <button onClick={() => setOpen(v => !v)} aria-expanded={open} className="font-bold">
      طلبات QR · <span role="status" aria-live="polite">{requests.length} بانتظار القبول</span>
    </button>
    {error && <p role="alert" className="text-ui-danger">{error}</p>}
    {open && <div className="max-h-72 overflow-auto">
      {readOnly && <p>افتح شاشة الطاولات لقبول الطلبات بعد حفظ طلبك الحالي.</p>}
      {requests.map(r => <article key={r.id} className="my-3 rounded border p-3">
        <h3 className="font-bold">{r.table_name} · {new Date(r.created_at).toLocaleTimeString()}</h3>
        <ul>{r.items.map(i => <li key={i.product_id}>{i.quantity} × {i.name} · {Number(i.price).toFixed(2)} {i.notes && `— ${i.notes}`}</li>)}</ul>
        {!readOnly && can('pos.order.edit') && <div className="mt-2 flex gap-4">
          <button disabled={busy} className="rounded bg-ui-primary px-4 py-2 text-white" onClick={() => void decide(r, true)}>قبول وفتح الفاتورة</button>
          <button disabled={busy} onClick={() => void decide(r, false)}>رفض</button>
        </div>}
      </article>)}
    </div>}
  </section>;
}
