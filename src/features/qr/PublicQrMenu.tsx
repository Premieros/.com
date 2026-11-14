import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Heart, Search, SlidersHorizontal, ShoppingBag, Home, Grid2X2, MapPin, Plus, Minus, UtensilsCrossed, Check } from 'lucide-react';
import { qrPublic } from '@/api/domains/qrPublic';
import type { QrAppearance, QrItem, QrProduct, QrTable } from './service';
import { qrError } from './errors';
import './customer-menu.css';

interface Draft { key: string; items: QrItem[]; table: string }
interface Menu { table_name: string; table_id: string; branch_name: string; currency: string; appearance?: QrAppearance; tables: QrTable[]; products: QrProduct[] }
function foodSymbol(name: string) {
  if (/coffee|قهو|كافي|espresso|latte/i.test(name)) return '☕';
  if (/tea|شاي|شاي/i.test(name)) return '🍵';
  if (/juice|عصير|drink|مشروب|smooth/i.test(name)) return '🥤';
  if (/pizza|بيتزا/i.test(name)) return '🍕';
  if (/burger|برجر|sandwich|ساندوتش|ساندويتش/i.test(name)) return '🍔';
  if (/cake|حلو|dessert|كيك|waffle|وافل/i.test(name)) return '🍰';
  return '🍽️';
}
function FoodImage({ product, large = false }: { product: QrProduct; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  return product.image_url && !failed ? <img src={product.image_url} alt={product.name} loading={large ? 'eager' : 'lazy'} onError={() => setFailed(true)} />
    : <span className="customer-food-symbol" role="img" aria-label={product.name}>{foodSymbol(`${product.category_name || ''} ${product.name}`)}</span>;
}
export function PublicQrMenu({ token }: { token: string }) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cart, setCart] = useState<Record<string, QrItem>>({});
  const [table, setTable] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [detail, setDetail] = useState<QrProduct | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [page, setPage] = useState<'home' | 'cart'>('home');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState('');
  const [retry, setRetry] = useState<Draft | null>(null);
  const lock = useRef(false);
  const storageKey = `premier_qr_pending_v1_${token}`;
  useEffect(() => {
    let alive = true;
    setMenu(null); setCart({}); setRetry(null); setError(''); setReceipt(''); setTable(''); setDetail(null); setPage('home');
    try {
      const stored: Draft = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (stored?.key && Array.isArray(stored.items)) {
        setRetry(stored); setTable(stored.table || ''); setPage('cart');
        setCart(Object.fromEntries(stored.items.map(item => [item.product_id, item])));
      }
    } catch { /* Storage may be disabled. */ }
    void qrPublic.menu({ p_token: token }).then(({ data, error: failure }) => {
      if (!alive) return;
      if (failure) setError(qrError(failure)); else setMenu(data);
    }).catch(failure => { if (alive) setError(qrError(failure)); });
    return () => { alive = false; };
  }, [token, storageKey]);
  async function submit() {
    if (lock.current || (!retry && !table)) return;
    lock.current = true; setBusy(true); setError('');
    const draft = retry || { key: crypto.randomUUID(), items: Object.values(cart).filter(i => i.quantity > 0), table };
    // Old uncertain drafts remain on their original link's default table.
    const selectedTable = draft.table || menu?.table_id || '';
    setRetry({ ...draft, table: selectedTable });
    try {
      try { sessionStorage.setItem(storageKey, JSON.stringify({ ...draft, table: selectedTable })); } catch { /* In-memory fallback. */ }
      const { data, error: failure } = await qrPublic.submit({ p_token: token, p_key: draft.key, p_items: draft.items, p_table: selectedTable });
      if (failure) throw failure;
      if (!data?.id) throw new Error('QR_EMPTY_RESPONSE');
      setReceipt(`${data.id} — ${data.status === 'pending' ? 'بانتظار موافقة الموظف' : data.status === 'accepted' ? 'تم اعتماد الطلب' : 'تم رفض الطلب'}`);
      setCart({}); setRetry(null);
      try { sessionStorage.removeItem(storageKey); } catch { /* No storage. */ }
    } catch (failure) {
      setError(qrError(failure));
      const message = typeof failure === 'object' && failure && 'message' in failure ? String(failure.message) : '';
      if (/QR_(PRICE_CHANGED|PRODUCT_UNAVAILABLE|INVALID_ITEMS|RATE_LIMITED|LINK_INVALID|TABLE_INVALID|DISABLED)/.test(message)) {
        setRetry(null);
        try { sessionStorage.removeItem(storageKey); } catch { /* No storage. */ }
      }
    } finally { lock.current = false; setBusy(false); }
  }
  const items = Object.values(cart).filter(i => i.quantity > 0);
  const total = items.reduce((sum, i) => sum + i.quantity * i.price, 0);
  const count = items.reduce((sum, i) => sum + i.quantity, 0);
  const appearance = menu?.appearance || {};
  const currency = menu?.currency || 'ج.م';
  const categories = [...new Map((menu?.products || []).filter(p => p.category_id).map(p => [p.category_id!, { id: p.category_id!, name: p.category_name || 'أصناف', product: p }])).values()];
  const filtered = (menu?.products || []).filter(p => (!category || p.category_id === category) && (!onlyFavorites || favorites.includes(p.id)) && `${p.name} ${p.description || ''}`.toLowerCase().includes(query.toLowerCase()));
  const disabled = busy || !!retry;
  function openProduct(p: QrProduct) { setDetail(p); setQuantity(cart[p.id]?.quantity || 1); setNote(cart[p.id]?.notes || ''); }
  function addProduct() {
    if (!detail || disabled) return;
    setCart(c => ({ ...c, [detail.id]: { product_id: detail.id, name: detail.name, price: detail.price, quantity, notes: note } }));
    setDetail(null); setReceipt('');
  }
  function changeQuantity(id: string, value: number) { setCart(c => ({ ...c, [id]: { ...c[id], quantity: Math.max(0, Math.min(99, Math.trunc(value) || 0)) } })); }
  return <main dir="rtl" className="customer-app">
    {detail ? <>
      <header className="customer-detail-header"><button aria-label="العودة للمنيو" onClick={() => setDetail(null)}><ArrowRight size={22} /></button><h1>تفاصيل الصنف</h1><button aria-label="إضافة للمفضلة" aria-pressed={favorites.includes(detail.id)} onClick={() => setFavorites(f => f.includes(detail.id) ? f.filter(id => id !== detail.id) : [...f, detail.id])}><Heart size={22} fill={favorites.includes(detail.id) ? '#ff8a35' : 'none'} /></button></header>
      <div className="customer-detail-image"><FoodImage key={detail.id} product={detail} large /></div>
      <div className="customer-detail-copy"><span className="customer-eyebrow">{detail.category_name || 'منيو الفرع'}</span><h2>{detail.name}</h2><strong className="customer-price">{Number(detail.price).toFixed(2)} <small>{currency}</small></strong>
        <p>{detail.description || 'يُحضّر لك بكل عناية. أضف ملاحظاتك قبل تأكيد الاختيار.'}</p>
        <div className="customer-choice"><span>الكمية</span><div className="customer-stepper"><button disabled={disabled || quantity <= 1} aria-label="تقليل الكمية" onClick={() => setQuantity(q => q - 1)}><Minus size={18} /></button><output>{quantity}</output><button disabled={disabled || quantity >= 99} aria-label="زيادة الكمية" onClick={() => setQuantity(q => q + 1)}><Plus size={18} /></button></div></div>
        <label className="customer-note">ملاحظات للموظف<textarea maxLength={300} placeholder="هل لديك طلب خاص؟" value={note} disabled={disabled} onChange={e => setNote(e.target.value)} /></label>
      </div><div className="customer-detail-action"><button className="customer-primary" disabled={disabled} onClick={addProduct}>أضف إلى السلة <span>{(detail.price * quantity).toFixed(2)} {currency}</span></button></div>
    </> : <>
      <header className="customer-header"><div className="customer-brand-icon">{appearance.logo_url ? <img src={appearance.logo_url} alt="شعار الفرع" /> : <UtensilsCrossed size={25} />}</div><div><h1>{appearance.brand_name || menu?.branch_name || 'أهلًا بك'}</h1><p><MapPin size={12} />{appearance.subtitle || 'اختياراتك المفضلة، على طاولتك'}</p></div><button className="customer-favorite" aria-label="عرض المفضلة" aria-pressed={onlyFavorites} onClick={() => { setOnlyFavorites(v => !v); setPage('home'); }}><Heart fill={onlyFavorites ? '#ff8a35' : 'none'} size={25} /></button></header>
      <div className="customer-table"><label htmlFor="customer-table">اختر طاولتك</label><select id="customer-table" value={table} disabled={disabled} onChange={e => setTable(e.target.value)}><option value="">اختر الطاولة</option>{menu?.tables?.map(t => <option key={t.id} value={t.id}>{t.name}{t.busy ? ' · مشغولة' : ''}</option>)}</select></div>
      <p className="customer-table-hint">{menu?.tables?.find(t => t.id === table)?.busy ? 'هذه الطاولة مشغولة؛ سيؤكد الموظف طاولة بديلة معك.' : 'الموظف يؤكد الطاولة والطلب قبل التحضير.'}</p>
      {error && <p role="alert" className="customer-alert">{error}</p>}
      {receipt && <div role="status" className="customer-receipt"><Check size={26} /><strong>وصل طلبك للموظف</strong><p>{receipt}</p><small>سيؤكد الموظف الطاولة معك قبل اعتماد الطلب.</small></div>}
      {page === 'home' ? <>
        <div className="customer-search"><Search size={21} /><input aria-label="ابحث في المنيو" placeholder="ابحث الآن" value={query} onChange={e => setQuery(e.target.value)} /><button aria-label="عرض كل التصنيفات" onClick={() => { setCategory(''); document.getElementById('customer-categories')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}><SlidersHorizontal size={20} /></button></div>
        {!query && !onlyFavorites && <div className="customer-promos"><div className="customer-promo-main"><div><span>طازج ولذيذ</span><h2>{appearance.banner_text || 'كل اللي بتحبه،\nفي طلب واحد'}</h2><small>اختر وجبتك واستمتع بوقتك</small></div>{appearance.banner_image_url ? <img src={appearance.banner_image_url} alt="اختيارات الفرع" /> : <span aria-hidden="true" className="customer-promo-food">{foodSymbol(categories[0]?.name || 'burger')}</span>}</div><div className="customer-promo-side" aria-hidden="true">☕<span>لحظتك الحلوة</span></div></div>}
        <div id="customer-categories" className="customer-categories"><button className={!category ? 'is-selected' : ''} onClick={() => setCategory('')}><span>🍽️</span>الكل</button>{categories.map(c => <button key={c.id} className={category === c.id ? 'is-selected' : ''} onClick={() => setCategory(c.id)}><span>{foodSymbol(c.name)}</span>{c.name}</button>)}</div>
        <div className="customer-section-title"><h2>{onlyFavorites ? 'المفضلة' : category ? categories.find(c => c.id === category)?.name : 'اقتراحات لك'}</h2><button onClick={() => { setCategory(''); setQuery(''); setOnlyFavorites(false); }}>الكل ‹</button></div>
        {!menu && !error && <p className="customer-empty" role="status">جارٍ تحميل المنيو…</p>}
        {menu && filtered.length === 0 && <p className="customer-empty">لا توجد أصناف للعرض حاليًا.</p>}
        <div className="customer-products">{filtered.map(p => <article key={p.id} className="customer-product"><button className="customer-product-open" aria-label={`تفاصيل ${p.name}`} onClick={() => openProduct(p)}><div className="customer-product-image"><FoodImage key={p.id} product={p} /></div><strong>{Number(p.price).toFixed(2)} <small>{currency}</small></strong><h3>{p.name}</h3><p>{p.category_name || 'منيو الفرع'}</p></button><button className="customer-add" aria-label={`إضافة ${p.name}`} disabled={disabled} onClick={() => openProduct(p)}>{cart[p.id]?.quantity ? <span>{cart[p.id].quantity} في السلة</span> : <Plus size={20} />}</button></article>)}</div>
        {!retry && <button className="customer-refresh" disabled={busy} onClick={() => window.location.reload()}>تحديث المنيو والأسعار</button>}
      </> : <section className="customer-cart"><div className="customer-section-title"><h2>سلتك</h2><span>{count} أصناف</span></div>{items.length === 0 && !receipt && <div className="customer-empty"><ShoppingBag size={42} /><p>سلتك في انتظار اختياراتك</p><button onClick={() => setPage('home')}>استكشف المنيو</button></div>}{items.map(i => <article className="customer-cart-item" key={i.product_id}><strong>{menu?.products.find(p => p.id === i.product_id)?.name || i.name || 'صنف'}</strong><span>{(i.price * i.quantity).toFixed(2)} {currency}</span><label>الكمية<input aria-label={`كمية ${i.name || menu?.products.find(p => p.id === i.product_id)?.name}`} type="number" min="0" max="99" value={i.quantity} disabled={disabled} onChange={e => changeQuantity(i.product_id, Number(e.target.value))} /></label><label>ملاحظات<input maxLength={300} value={i.notes} disabled={disabled} onChange={e => setCart(c => ({ ...c, [i.product_id]: { ...c[i.product_id], notes: e.target.value } }))} /></label></article>)}
        <div className="customer-total"><span>إجمالي الأصناف</span><strong>{total.toFixed(2)} {currency}</strong></div><p className="customer-table-hint">الضرائب حسب فاتورة الفرع · الدفع لدى الموظف</p>
        <button className="customer-primary" disabled={busy || (!retry && (!items.length || !table))} onClick={() => void submit()}>{busy ? 'جارٍ الإرسال…' : retry ? 'إعادة إرسال نفس الطلب بأمان' : 'إرسال الطلب للموظف'}</button>
        {retry && <p className="customer-alert">نتيجة الطلب السابق غير مؤكدة. أعد إرساله بنفس الرقم لتجنب التكرار.</p>}
      </section>}
      <nav className="customer-bottom" aria-label="تصفح المنيو"><button className={page === 'home' ? 'is-active' : ''} onClick={() => setPage('home')}><Home size={19} />الرئيسية</button><button onClick={() => { setPage('home'); setTimeout(() => document.getElementById('customer-categories')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); }}><Grid2X2 size={19} />التصنيفات</button><button className={page === 'cart' ? 'is-active' : ''} onClick={() => setPage('cart')}><ShoppingBag size={19} />السلة</button><button className="customer-cart-bubble" aria-label={`فتح السلة، ${count} أصناف`} onClick={() => setPage('cart')}><ShoppingBag size={22} />{count > 0 && <b>{count}</b>}</button></nav>
    </>}
  </main>;
}
