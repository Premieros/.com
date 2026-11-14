import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCan } from '@/lib/permissions';
import { qr } from '@/api/domains/qr';
import type { QrTable, ServiceCall } from './service';
import { qrDecide, qrError, qrInbox, type QrRequest } from './service';

export function QrInbox({ branchId, readOnly = false }: { branchId: string; readOnly?: boolean }) {
  const can = useCan();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<QrRequest[]>([]);
  const [calls, setCalls] = useState<ServiceCall[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [tables, setTables] = useState<QrTable[]>([]);
  const [canReview, setCanReview] = useState(false);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const scope = useRef(branchId); scope.current = branchId;
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    setRequests([]); setCalls([]); setError(''); setOpen(false); setTables([]); setAssignments({}); setCanReview(false);
    if (!branchId || !can('pos.view')) return;
    async function poll() {
      try {
        const [rows, routing, service] = await Promise.all([qrInbox(branchId), qr.routing({ p_branch: branchId }), qr.calls({ p_branch: branchId })]);
        if (routing.error || service.error) throw routing.error || service.error;
        if (alive) { setRequests(rows); setCalls(service.data || []); setTables(routing.data?.tables || []); setCanReview(!!routing.data?.can_review); setError(''); }
      }
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
      const result = await qrDecide(request.id, accept, assignments[request.id] || request.own_active_table_id || request.table_id);
      if (!mounted.current || scope.current !== branch) return;
      setRequests(rows => rows.filter(r => r.id !== request.id)); setError('');
      if (result.order_id) navigate(`/pos/${result.order_id}`, { state: { branchId: branch } });
    } catch (failure) { if (mounted.current && scope.current === branch) setError(qrError(failure)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function handleService(id: string, status: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); const branch = branchId;
    try {
      const { error: failure } = await qr.handleCall({ p_id: id, p_status: status });
      if (failure) throw failure;
      if (!mounted.current || scope.current !== branch) return;
      setCalls(rows => status === 'done' ? rows.filter(r => r.id !== id) : rows.map(r => r.id === id ? { ...r, status: 'acknowledged' } : r)); setError('');
    } catch (failure) { if (mounted.current && scope.current === branch) setError(qrError(failure)); }
    finally { lock.current = false; setBusy(false); }
  }
  if (!branchId || !can('pos.view')) return null;
  return <section dir="rtl" className="shrink-0 rounded border border-ui-border bg-ui-surface p-3">
    <button onClick={() => setOpen(v => !v)} aria-expanded={open} className="font-bold">
      طلبات QR · <span role="status" aria-live="polite">{requests.length} طلبات · {calls.length} شيك وخدمة</span>
    </button>
    {error && <p role="alert" className="text-ui-danger">{error}</p>}
    {open && <div className="max-h-72 overflow-auto">
      {calls.map(c => <article key={c.id} className="my-3 rounded border border-orange-300 bg-orange-50 p-3 text-slate-900">
        <h3 className="font-bold">{c.kind === 'check' ? 'طلب شيك' : 'طلب خدمة'} · {c.table_name}</h3><p>{c.note}</p>
        <p className="text-sm">{c.status === 'acknowledged' ? 'تم إبلاغ العميل باستلام الطلب' : 'طلب جديد من العميل'}</p>
        {!readOnly && c.kind === 'check' && c.order_id && <button className="my-2 rounded border px-3 py-2" onClick={() => navigate(`/pos/${c.order_id}`, { state: { branchId } })}>فتح الحساب لطباعة الشيك</button>}
        {canReview && <div className="mt-2 flex gap-4">{c.status === 'open' && <button disabled={busy} className="rounded border px-3 py-2" onClick={() => void handleService(c.id, 'acknowledged')}>استلام طلب الخدمة</button>}
          <button disabled={busy} className="rounded bg-orange-700 px-3 py-2 text-white" onClick={() => void handleService(c.id, 'done')}>تم تنفيذ الطلب</button></div>}
      </article>)}
      {readOnly && <p>افتح شاشة الطاولات لقبول الطلبات بعد حفظ طلبك الحالي.</p>}
      {requests.map(r => <article key={r.id} className="my-3 rounded border p-3">
        <h3 className="font-bold">اختيار العميل: {r.table_name} · {new Date(r.created_at).toLocaleTimeString()}</h3>
        <ul>{r.items.map(i => <li key={i.product_id}>{i.quantity} × {i.name} · {Number(i.price).toFixed(2)} {i.notes && `— ${i.notes}`}</li>)}</ul>
        {!readOnly && can('pos.order.edit') && canReview && <><label className="my-3 block">الطاولة المعتمدة <select aria-label={`الطاولة المعتمدة ${r.table_name}`} className="rounded border bg-ui-surface p-2" disabled={busy} value={assignments[r.id] || r.own_active_table_id || r.table_id} onChange={e => setAssignments(a => ({ ...a, [r.id]: e.target.value }))}>
          {tables.map(t => <option key={t.id} value={t.id} disabled={t.busy && t.id !== r.own_active_table_id}>{t.name}{t.id === r.own_active_table_id ? ' · حساب العميل الحالي' : t.busy ? ' · مشغولة — اختر بديلًا' : ''}</option>)}
        </select></label><div className="mt-2 flex gap-4">
          <button disabled={busy || !tables.some(t => t.id === (assignments[r.id] || r.own_active_table_id || r.table_id) && (!t.busy || t.id === r.own_active_table_id))} className="rounded bg-ui-primary px-4 py-2 text-white" onClick={() => void decide(r, true)}>قبول وفتح الفاتورة</button>
          <button disabled={busy} onClick={() => void decide(r, false)}>رفض</button>
        </div></>}
        {!readOnly && !canReview && <p className="mt-2 text-sm text-ui-subtle">بانتظار اعتماد الموظف المخوّل لهذا الفرع.</p>}
      </article>)}
    </div>}
  </section>;
}
