import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCan } from '@/lib/permissions';
import { qr } from '@/api/domains/qr';
import type { QrTable, ServiceCall } from './service';
import { qrDecide, qrError, qrInbox, type QrRequest } from './service';
import { BellRing, Volume2, X } from 'lucide-react';
import { useQrNotificationTone } from './useQrNotificationTone';

export function QrInbox({ branchId, readOnly = false, header = false, navigationBlocked = false, workspaceTableId }: { branchId: string; readOnly?: boolean; header?: boolean; navigationBlocked?: boolean; workspaceTableId?: string | null }) {
  const can = useCan();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<QrRequest[]>([]);
  const [calls, setCalls] = useState<ServiceCall[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [tables, setTables] = useState<QrTable[]>([]);
  const [canReview, setCanReview] = useState(false);
  const [acceptedOrder, setAcceptedOrder] = useState<string | null>(null);
  const version = useRef(0);
  const tone = useQrNotificationTone(requests.length + calls.filter(c => c.status === 'open').length, header && canReview);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const scope = useRef(branchId); scope.current = branchId;
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    version.current++;
    setRequests([]); setCalls([]); setError(''); setOpen(false); setTables([]); setAssignments({}); setCanReview(false); setAcceptedOrder(null);
    if (!branchId || !can('pos.view')) return;
    async function poll() {
      const snapshot = version.current;
      try {
        const [rows, routing, service] = await Promise.all([qrInbox(branchId), qr.routing({ p_branch: branchId }), qr.calls({ p_branch: branchId })]);
        if (routing.error || service.error) throw routing.error || service.error;
        if (alive && snapshot === version.current) { setRequests(rows); setCalls(service.data || []); setTables(routing.data?.tables || []); setCanReview(!!routing.data?.can_review); setError(''); }
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
      version.current++;
      setRequests(rows => rows.filter(r => r.id !== request.id)); setError('');
      if (result.order_id) {
        if (header) setAcceptedOrder(result.order_id);
        else navigate(`/pos/${result.order_id}`, { state: { branchId: branch } });
      }
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
      version.current++;
      setCalls(rows => status === 'done' ? rows.filter(r => r.id !== id) : rows.map(r => r.id === id ? { ...r, status: 'acknowledged' } : r)); setError('');
    } catch (failure) { if (mounted.current && scope.current === branch) setError(qrError(failure)); }
    finally { lock.current = false; setBusy(false); }
  }
  if (!branchId || !can('pos.view')) return null;
  return <section dir="rtl" className={header ? 'relative shrink-0' : 'shrink-0 rounded border border-ui-border bg-ui-surface p-3'} data-testid={header ? 'pos-customer-orders' : undefined}>
    <button onClick={() => { setOpen(v => !v); if (header && !tone.ready) void tone.unlock(); }} aria-label={header ? `طلبات العملاء: ${requests.length + calls.length}` : undefined} aria-expanded={open} className={header ? 'flex min-h-9 items-center gap-1.5 rounded-xl border border-orange-400/50 bg-orange-500/10 px-2 text-xs font-bold text-ui-text' : 'font-bold'}>
      {header ? <><BellRing size={17} /><span className="hidden sm:inline">طلبات العملاء</span></> : 'طلبات QR · '}
      <span role="status" aria-live="polite">{header ? requests.length + calls.length : `${requests.length} طلبات · ${calls.length} شيك وخدمة`}</span>
    </button>
    {error && !open && <span className="text-xs text-ui-danger" role="alert">تعذر تحديث الطلبات</span>}
    {open && <div role={header ? 'dialog' : undefined} aria-label={header ? 'طلبات العملاء والخدمة' : undefined} className={header ? 'fixed inset-x-2 top-16 z-[70] max-h-[80dvh] overflow-auto rounded-2xl border border-ui-border bg-ui-surface p-4 text-ui-text shadow-ui-xl sm:absolute sm:inset-x-auto sm:start-0 sm:top-12 sm:w-[440px]' : 'max-h-72 overflow-auto'}>
      {header && <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">طلبات العملاء والشيك والخدمة</h2><button aria-label="إغلاق طلبات العملاء" onClick={() => setOpen(false)}><X size={20} /></button></div>}
      {header && !tone.ready && canReview && <button className="mb-3 flex items-center gap-2 rounded border p-2 text-sm" onClick={() => void tone.unlock()}><Volume2 size={17} />تفعيل صوت التنبيه المتكرر</button>}
      {header && tone.ready && <p className="mb-2 text-xs text-ui-subtle">صوت التنبيه مفعّل · يتكرر حتى معالجة الطلبات الجديدة</p>}
      {error && <p role="alert" className="text-ui-danger">{error}</p>}
      {acceptedOrder && <div className="my-3 rounded border border-green-500/40 p-3"><p>تم قبول طلب العميل.</p>{navigationBlocked && <p className="my-2 text-sm">احفظ أو علّق الفاتورة الحالية قبل فتح حساب العميل.</p>}<button disabled={navigationBlocked} className="rounded border p-2 disabled:opacity-50" onClick={() => navigate(`/pos/${acceptedOrder}`, { state: { branchId } })}>فتح حساب العميل المقبول</button></div>}
      {!requests.length && !calls.length && <p className="my-3 text-sm text-ui-subtle">لا توجد طلبات جديدة بانتظار المعالجة.</p>}
      {calls.map(c => <article key={c.id} className="my-3 rounded border border-orange-300 bg-orange-50 p-3 text-slate-900">
        <h3 className="font-bold">{c.kind === 'check' ? 'طلب شيك' : 'طلب خدمة'} · {c.table_name}</h3><p>{c.note}</p>
        <p className="text-sm">{c.status === 'acknowledged' ? 'تم إبلاغ العميل باستلام الطلب' : 'طلب جديد من العميل'}</p>
        {!readOnly && c.kind === 'check' && c.order_id && <button disabled={navigationBlocked} className="my-2 rounded border px-3 py-2 disabled:opacity-50" onClick={() => navigate(`/pos/${c.order_id}`, { state: { branchId } })}>فتح الحساب لطباعة الشيك</button>}
        {canReview && <div className="mt-2 flex gap-4">{c.status === 'open' && <button disabled={busy} className="rounded border px-3 py-2" onClick={() => void handleService(c.id, 'acknowledged')}>استلام طلب الخدمة</button>}
          <button disabled={busy} className="rounded bg-orange-700 px-3 py-2 text-white" onClick={() => void handleService(c.id, 'done')}>تم تنفيذ الطلب</button></div>}
      </article>)}
      {readOnly && <p>افتح شاشة الطاولات لقبول الطلبات بعد حفظ طلبك الحالي.</p>}
      {requests.map(r => <article key={r.id} className="my-3 rounded border p-3">
        <h3 className="font-bold">اختيار العميل: {r.table_name} · {new Date(r.created_at).toLocaleTimeString()}</h3>
        <ul>{r.items.map(i => <li key={i.product_id}>{i.quantity} × {i.name} · {Number(i.price).toFixed(2)} {i.notes && `— ${i.notes}`}</li>)}</ul>
        {header && navigationBlocked && workspaceTableId === (assignments[r.id] || r.own_active_table_id || r.table_id) && <p className="my-2 text-sm text-ui-warning">احفظ أو علّق فاتورة هذه الطاولة أولًا قبل إضافة طلب العميل إليها.</p>}
        {!readOnly && can('pos.order.edit') && canReview && <><label className="my-3 block">الطاولة المعتمدة <select aria-label={`الطاولة المعتمدة ${r.table_name}`} className="rounded border bg-ui-surface p-2" disabled={busy} value={assignments[r.id] || r.own_active_table_id || r.table_id} onChange={e => setAssignments(a => ({ ...a, [r.id]: e.target.value }))}>
          {tables.map(t => <option key={t.id} value={t.id} disabled={t.busy && t.id !== r.own_active_table_id}>{t.name}{t.id === r.own_active_table_id ? ' · حساب العميل الحالي' : t.busy ? ' · مشغولة — اختر بديلًا' : ''}</option>)}
        </select></label><div className="mt-2 flex gap-4">
          <button disabled={busy || (header && navigationBlocked && workspaceTableId === (assignments[r.id] || r.own_active_table_id || r.table_id)) || !tables.some(t => t.id === (assignments[r.id] || r.own_active_table_id || r.table_id) && (!t.busy || t.id === r.own_active_table_id))} className="rounded bg-ui-primary px-4 py-2 text-white" onClick={() => void decide(r, true)}>{header ? 'قبول طلب العميل' : 'قبول وفتح الفاتورة'}</button>
          <button disabled={busy} onClick={() => void decide(r, false)}>رفض</button>
        </div></>}
        {!readOnly && !canReview && <p className="mt-2 text-sm text-ui-subtle">بانتظار اعتماد الموظف المخوّل لهذا الفرع.</p>}
      </article>)}
    </div>}
  </section>;
}
