import { useEffect, useRef, useState } from 'react';
import { qrPublic } from '@/api/domains/qrPublic';
import type { QrItem, QrProduct } from './service';
import { qrError } from './errors';

interface Draft { key: string; items: QrItem[] }
export function PublicQrMenu({ token }: { token: string }) {
  const [menu, setMenu] = useState<{ table_name: string; products: QrProduct[] } | null>(null);
  const [cart, setCart] = useState<Record<string, QrItem>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState('');
  const [retry, setRetry] = useState<Draft | null>(null);
  const lock = useRef(false);
  const storageKey = `premier_qr_pending_v1_${token}`;
  useEffect(() => {
    let alive = true;
    setMenu(null); setCart({}); setError(''); setReceipt('');
    try {
      const stored: Draft = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (stored?.key && Array.isArray(stored.items)) setRetry(stored);
    } catch { /* Storage may be disabled; retries still work in memory. */ }
    void qrPublic.menu({ p_token: token }).then(({ data, error: failure }) => {
      if (!alive) return;
      if (failure) setError(qrError(failure)); else setMenu(data);
    });
    return () => { alive = false; };
  }, [token, storageKey]);

  async function submit() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    const draft = retry || { key: crypto.randomUUID(), items: Object.values(cart).filter(i => i.quantity > 0) };
    setRetry(draft);
    try {
      try { sessionStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* In-memory fallback. */ }
      const { data, error: failure } = await qrPublic.submit({ p_token: token, p_key: draft.key, p_items: draft.items });
      if (failure) throw failure;
      setReceipt(`${data.id} — ${data.status === 'pending' ? 'بانتظار موافقة الموظف' : data.status}`);
      setCart({}); setRetry(null);
      try { sessionStorage.removeItem(storageKey); } catch { /* No storage. */ }
    } catch (failure) {
      setError(qrError(failure));
      const message = typeof failure === 'object' && failure && 'message' in failure ? String(failure.message) : '';
      // These server validation failures commit nothing. Network failures remain retry-only.
      if (/QR_(PRICE_CHANGED|PRODUCT_UNAVAILABLE|INVALID_ITEMS|RATE_LIMITED|LINK_INVALID)/.test(message)) {
        setRetry(null);
        try { sessionStorage.removeItem(storageKey); } catch { /* No storage. */ }
      }
    }
    finally { lock.current = false; setBusy(false); }
  }
  const total = Object.values(cart).reduce((sum, i) => sum + i.quantity * i.price, 0);
  return <main dir="rtl" className="mx-auto min-h-screen max-w-xl bg-white p-5 text-slate-900">
    <h1 className="text-2xl font-bold">Premier · منيو الطاولة</h1>
    <p className="my-3">{menu?.table_name || 'جارٍ تحميل المنيو…'}</p>
    <p className="text-sm">الطلب يحتاج موافقة الموظف. الدفع من خلال موظف الفرع.</p>
    {error && <p role="alert" className="my-4 rounded bg-red-50 p-3 text-red-800">{error}</p>}
    {!retry && <button className="my-2 underline" disabled={busy} onClick={() => window.location.reload()}>تحديث المنيو والأسعار</button>}
    {receipt && <p role="status" className="my-4 break-all rounded bg-green-50 p-3">تم استلام الطلب: {receipt}</p>}
    {menu?.products.length === 0 && <p className="py-8">المنيو غير متاح حاليًا. يرجى التواصل مع الموظف.</p>}
    {menu?.products.map(p => <article key={p.id} className="my-4 rounded-xl border p-4">
      <h2 className="text-lg font-semibold">{p.name}</h2><p>{p.description}</p><p>{Number(p.price).toFixed(2)}</p>
      <label className="block">الكمية <input aria-label={`كمية ${p.name}`} type="number" min="0" max="99" step="1" className="m-2 w-20 rounded border p-2"
        value={cart[p.id]?.quantity || 0} disabled={busy || !!retry}
        onChange={e => { const quantity = Math.max(0, Math.min(99, Math.trunc(Number(e.target.value) || 0))); setCart(c => ({ ...c, [p.id]: { product_id: p.id, price: p.price, quantity, notes: c[p.id]?.notes || '' } })); }} /></label>
      {!!cart[p.id]?.quantity && <label className="block">ملاحظات <input maxLength={300} className="w-full rounded border p-2" disabled={busy || !!retry}
        value={cart[p.id]?.notes || ''} onChange={e => setCart(c => ({ ...c, [p.id]: { ...c[p.id], notes: e.target.value } }))} /></label>}
    </article>)}
    <div className="sticky bottom-0 rounded-xl border bg-white p-4 shadow-lg">
      <p>إجمالي الأصناف: {total.toFixed(2)} · الضرائب حسب فاتورة الفرع</p>
      <button className="mt-2 w-full rounded bg-slate-900 p-3 text-white disabled:opacity-50" disabled={busy || (!retry && total === 0 && !Object.values(cart).some(i => i.quantity > 0))} onClick={() => void submit()}>
        {busy ? 'جارٍ الإرسال…' : retry ? 'إعادة إرسال نفس الطلب بأمان' : 'إرسال الطلب للموظف'}
      </button>
      {retry && <p className="mt-2 text-sm">نتيجة الطلب السابق غير مؤكدة. أعد إرساله بنفس الرقم لتجنب التكرار. عند تغيّر الأسعار أو عدم توفر صنف، تواصل مع الموظف.</p>}
    </div>
  </main>;
}
