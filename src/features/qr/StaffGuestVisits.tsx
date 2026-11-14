import { useEffect, useRef, useState } from 'react';
import { qr } from '@/api/domains/qr';
import { qrError } from './errors';
import type { StaffVisit } from './service';

export function StaffGuestVisits({ branchId, canReview }: { branchId: string; canReview: boolean }) {
  const [visits, setVisits] = useState<StaffVisit[]>([]); const [error, setError] = useState('');
  const [codes, setCodes] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''); const [ending, setEnding] = useState<string | null>(null);
  const alive = useRef(true); const lock = useRef(false);
  useEffect(() => {
    alive.current = true; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { const result = await qr.visits({ p_branch: branchId }); if (result.error) throw result.error; if (alive.current) { setVisits(result.data || []); setError(''); } }
      catch (failure) { if (alive.current) setError(qrError(failure)); }
      finally { if (alive.current) timer = setTimeout(() => void poll(), 10000); }
    }
    void poll(); return () => { alive.current = false; clearTimeout(timer); };
  }, [branchId]);
  async function act(id: string, end: boolean) {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try {
      if (end) { const result = await qr.endVisit({ p_visit: id }); if (result.error) throw result.error; if (alive.current) { setVisits(v => v.filter(x => x.id !== id)); setEnding(null); } }
      else { const result = await qr.resetPin({ p_visit: id }); if (result.error) throw result.error; if (alive.current && result.data) setCodes(c => ({ ...c, [id]: result.data! })); }
    } catch (failure) { if (alive.current) setError(qrError(failure)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <details className="mt-4 rounded border border-ui-border p-3"><summary className="cursor-pointer font-bold">دخول العملاء واسترجاع الطلبات ({visits.length})</summary>
    <p className="my-2 text-xs text-ui-subtle">تحقق من العميل قبل إعطائه رمزًا جديدًا. إنهاء الدخول يمنع استخدام الموقع لهذه الزيارة؛ الفاتورة تبقى مفتوحة لدى الكاشير.</p>
    <input className="my-2 w-full rounded border bg-ui-bg p-2" aria-label="بحث عن زيارة عميل" placeholder="الاسم أو الهاتف أو الطاولة" value={query} onChange={e => setQuery(e.target.value)} />
    {error && <p role="alert" className="text-ui-danger">{error}</p>}
    {visits.filter(v => `${v.name} ${v.phone} ${v.table_name}`.includes(query)).map(v => <article key={v.id} className="my-3 rounded border p-3 text-sm"><strong>{v.name} · {v.table_name}</strong><p dir="ltr">{v.phone}</p>{v.pin_locked && <p className="text-ui-danger">الاسترجاع مقفول بعد محاولات خاطئة</p>}
      {codes[v.id] && <p role="status" className="my-2 rounded bg-green-100 p-3 text-green-950">رمز جديد للعميل: <b dir="ltr" className="text-xl">{codes[v.id]}</b></p>}
      {canReview && <div className="mt-2 flex flex-wrap gap-3"><button disabled={busy} className="rounded border p-2" onClick={() => void act(v.id, false)}>إصدار رمز استرجاع جديد</button><button disabled={busy} className="rounded border p-2" onClick={() => setEnding(v.id)}>إنهاء دخول العميل</button></div>}
      {ending === v.id && <div className="my-2 rounded border border-orange-400 p-2"><p>هل غادر العميل؟ سيتوقف دخول هذه الزيارة فورًا، وتبقى الفاتورة كما هي.</p><button disabled={busy} className="m-2 rounded bg-orange-700 p-2 text-white" onClick={() => void act(v.id, true)}>تأكيد إنهاء الدخول</button><button disabled={busy} onClick={() => setEnding(null)}>تراجع</button></div>}
    </article>)}
  </details>;
}
