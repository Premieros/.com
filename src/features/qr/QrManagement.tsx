import { useEffect, useState } from 'react';
import { supabase } from '@/api';
import { qr } from '@/api/domains/qr';
import { qrError } from './service';
import { printCustomerOrderQr } from './printCustomerOrderQr';
import { getPermanentBranchQrUrl } from './permanentBranchQrUrl';

interface MenuChoice { id: string; name: string; sale_price: number; is_demo?: boolean }
export function QrManagement({ branchId, brandName, onMenuUpdated }: { branchId: string; brandName?: string; onMenuUpdated?: () => void }) {
  const [products, setProducts] = useState<MenuChoice[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [image, setImage] = useState('');
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setSelected([]); setImage(''); setLink(''); setProducts([]); setMessage('');
    void Promise.all([
      supabase.from('products').select('id,name,sale_price,is_demo').eq('branch_id', branchId).eq('is_active', true).order('name'),
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
      onMenuUpdated?.();
    } catch (failure) { setMessage(qrError(failure)); } finally { setBusy(false); }
  }
  async function showBranchCode() {
    setBusy(true); setMessage('');
    try {
      // Server returns the same branch token on every request after creation.
      const { data, error } = await qr.branchCode({ p_branch: branchId });
      if (error) throw error;
      if (!data) throw new Error('QR_LINK_INVALID');
      // A QR printed from a custom-domain admin session, localhost or a
      // preview deployment must still contain the same durable public URL.
      const permanentUrl = getPermanentBranchQrUrl(data);
      const qrCode = await import('qrcode');
      setImage(await qrCode.toDataURL(permanentUrl, { width: 400, margin: 3 }));
      setLink(permanentUrl);
      setMessage('هذا رمز الفرع الثابت. لن يتغير عند إعادة عرضه أو طباعته. يختار العميل الطاولة من هاتفه.');
    } catch (failure) { setMessage(qrError(failure)); } finally { setBusy(false); }
  }
  function printQr() {
    if (!image || !link) return;
    if (!printCustomerOrderQr({ image, link, tableName: 'اختر طاولتك بعد المسح', brandName })) {
      setMessage('تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.');
    }
  }
  return <details dir="rtl" className="rounded border bg-ui-surface p-4">
    <summary className="cursor-pointer font-bold">إدارة المنيو ورمز QR الدائم للفرع</summary>
    <p className="my-2">نشر الأصناف يستبدل قائمة منيو الفرع بالكامل. اختر القائمة كاملة قبل الحفظ.</p>
    <p className="my-2 text-sm text-amber-600 dark:text-amber-400">بالنسبة لـBUNKER: لا يمكن تشغيل استقبال الطلبات الحقيقية إذا كان منيو الفرع يحتوي على أصناف موسومة Demo. اعتمد المنتجات والأسعار في كتالوج الفرع، ثم انشر المنيو الجديد.</p>
    <div className="my-3 grid max-h-60 gap-2 overflow-auto sm:grid-cols-2">{products.map(p => <label key={p.id}>
      <input type="checkbox" checked={selected.includes(p.id)} disabled={busy} onChange={e => setSelected(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} /> {p.name} · {Number(p.sale_price).toFixed(2)} {p.is_demo && <strong className="ms-1 rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">Demo — غير معتمد للبيع الفعلي</strong>}
    </label>)}</div>
    <button disabled={busy || loading} className="rounded border p-2" onClick={() => void saveMenu()}>نشر الأصناف المحددة</button>
    <div className="my-4 space-y-3 rounded-xl border border-ui-border p-4">
      <h3 className="font-bold">رمز QR الثابت للفرع</h3>
      <p className="text-sm text-ui-subtle">رمز واحد لكل الفرع، ولا يرتبط بطاولة محددة. بعد المسح يختار العميل طاولته بنفسه. ينشأ الرمز مرة واحدة فقط ويظل نفسه عند إعادة عرضه أو طباعته.</p>
      <button type="button" disabled={busy || loading} className="rounded-xl bg-ui-primary px-5 py-3 text-white" onClick={() => void showBranchCode()}>
        {busy ? 'جارٍ تجهيز الرمز…' : 'عرض رمز QR الدائم للفرع'}
      </button>
      {message && <p role="status" className="my-3">{message}</p>}
      {image && <div className="space-y-3">
        <p className="font-bold">رمز طلب العملاء لهذا الفرع</p>
        <img src={image} width={300} height={300} alt="رمز QR ثابت لطلبات عملاء الفرع" />
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" className="rounded-xl bg-ui-primary px-5 py-3 text-white" onClick={printQr}>طباعة رمز QR</button>
          <a download={`premier-branch-${branchId}.png`} href={image} className="underline">تحميل الرمز PNG</a>
          <a href={link} target="_blank" rel="noreferrer" className="underline">تجربة رابط طلب العملاء</a>
        </div>
        <p className="text-sm text-ui-subtle">يمكنك طباعة نسخ إضافية من الرمز نفسه. لا حاجة إلى إنشاء رمز جديد بعد أي تعديل على المنيو أو الطاولات.</p>
      </div>}
    </div>
  </details>;
}
