import { useEffect, useState } from 'react';
import { supabase } from '@/api';
import { qr } from '@/api/domains/qr';
import type { DiningTable } from '@/lib/types';
import { qrError } from './service';
import { printCustomerOrderQr } from './printCustomerOrderQr';

interface MenuChoice { id: string; name: string; sale_price: number }
export function QrManagement({ branchId, tables, brandName }: { branchId: string; tables: DiningTable[]; brandName?: string }) {
  const [products, setProducts] = useState<MenuChoice[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [tableId, setTableId] = useState('');
  const [image, setImage] = useState('');
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setSelected([]); setImage(''); setLink(''); setTableId(''); setProducts([]); setMessage('');
    void Promise.all([
      supabase.from('products').select('id,name,sale_price').eq('branch_id', branchId).eq('is_active', true).order('name'),
      qr.configuration({ p_branch: branchId }),
    ]).then(([catalog, config]) => {
      if (!alive) return;
      if (catalog.error || config.error) setMessage(qrError(catalog.error || config.error));
      else { setProducts(catalog.data || []); setSelected(config.data || []); setLoading(false); }
    });
    return () => { alive = false; };
  }, [branchId]);
  async function saveMenu() {
    setBusy(true);
    try {
      const { error } = await qr.configure({ p_branch: branchId, p_products: selected });
      if (error) throw error;
      setMessage('تم نشر الأصناف المحددة. الأصناف التي تتطلب إضافات إلزامية لا تظهر في هذه المرحلة.');
    } catch (failure) { setMessage(qrError(failure)); } finally { setBusy(false); }
  }
  async function rotate(enabled: boolean) {
    setBusy(true); setImage(''); setLink('');
    try {
      const { data, error } = await qr.rotate({ p_table: tableId, p_enabled: enabled });
      if (error) throw error;
      if (enabled) {
        const url = new URL(window.location.href); url.hash = `/qr/${data}`; url.search = '';
        const qrCode = await import('qrcode');
        setImage(await qrCode.toDataURL(url.href, { width: 400, margin: 3 })); setLink(url.href);
      }
      setMessage(enabled ? 'رمز جديد جاهز. استبدل الرمز المطبوع السابق؛ لم يعد صالحًا.' : 'تم تعطيل رابط الطاولة.');
    } catch (failure) { setMessage(qrError(failure)); } finally { setBusy(false); }
  }
  const selectedTableName = tables.find(table => table.id === tableId && table.branch_id === branchId)?.name || 'طاولة';
  function printQr() {
    if (!image || !link || !tableId) return;
    if (!printCustomerOrderQr({ image, link, tableName: selectedTableName, brandName })) {
      setMessage('تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.');
    }
  }
  return <details dir="rtl" className="rounded border bg-ui-surface p-4">
    <summary className="cursor-pointer font-bold">إعداد المنيو وإنشاء رموز QR للطباعة</summary>
    <p className="my-2">نشر الأصناف يستبدل قائمة منيو الفرع بالكامل. اختر القائمة كاملة قبل الحفظ.</p>
    <div className="my-3 grid max-h-60 gap-2 overflow-auto sm:grid-cols-2">{products.map(p => <label key={p.id}>
      <input type="checkbox" checked={selected.includes(p.id)} disabled={busy} onChange={e => setSelected(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} /> {p.name} · {Number(p.sale_price).toFixed(2)}
    </label>)}</div>
    <button disabled={busy || loading} className="rounded border p-2" onClick={() => void saveMenu()}>نشر الأصناف المحددة</button>
    <label className="my-3 block">الطاولة <select value={tableId} disabled={busy} className="rounded border p-2" onChange={e => { setTableId(e.target.value); setImage(''); setLink(''); }}>
      <option value="">اختر طاولة</option>{tables.filter(t => t.branch_id === branchId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select></label>
    <div className="flex flex-wrap gap-4"><button disabled={!tableId || busy} onClick={() => void rotate(true)}>إنشاء / استبدال رمز QR</button>
      <button disabled={!tableId || busy} onClick={() => void rotate(false)}>تعطيل الرمز</button></div>
    {message && <p role="status" className="my-3">{message}</p>}
    {image && <div className="mt-4 space-y-3 rounded-xl border border-ui-border p-4">
      <p className="font-bold">رمز طلب العملاء — {selectedTableName}</p>
      <img src={image} width={300} height={300} alt={`رمز QR لطلب العملاء في ${selectedTableName}`} />
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className="rounded-xl bg-ui-primary px-5 py-3 text-white" onClick={printQr}>طباعة رمز QR</button>
        <a download={`premier-table-${tableId}.png`} href={image} className="underline">تحميل الرمز PNG</a>
        <a href={link} target="_blank" rel="noreferrer" className="underline">فتح المنيو</a>
      </div>
      <p className="text-sm text-ui-subtle">تُطبع بطاقة باسم الطاولة ورمز مسح للعميل. يمكنك طباعة البطاقة أكثر من مرة دون استبدال الرمز. إنشاء رمز جديد لهذه الطاولة يلغي صلاحية الرمز المطبوع القديم.</p>
    </div>}
  </details>;
}
