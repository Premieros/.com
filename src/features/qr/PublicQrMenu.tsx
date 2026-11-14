import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Heart, Search, SlidersHorizontal, ShoppingBag, Home, Grid2X2, MapPin, Plus, Minus, UtensilsCrossed, ReceiptText, Check } from 'lucide-react';
import { ProductImage } from '@/features/catalog/components/ProductImage';
import { qrPublic } from '@/api/domains/qrPublic';
import type { GuestIdentity, QrAppearance, QrItem, QrProduct, QrTable } from './service';
import { qrError } from './errors';
import './customer-menu.css';
import { useGuestVisit } from './useGuestVisit';
import { GuestVisitPanel } from './GuestVisitPanel';

interface Draft { key: string; items: QrItem[]; table: string; session?: string }
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
  // Catalog sprite fragments need the same frame renderer as POS, not a cropped img.
  const frame = product.image_url?.match(/(?:^|\/)catalog-product-sprite\.svg#([a-z0-9-]+)$/i)?.[1];
  const src = frame ? `${import.meta.env.BASE_URL}catalog-product-sprite.svg#${frame}` : product.image_url;
  return <ProductImage src={src} name={product.name} category={product.category_name}
    className={`customer-image-content${large ? ' customer-image-large' : ''}`} imgClassName="customer-full-image" />;
}
export function PublicQrMenu({ token, identity, session, onClosed }: { token: string; identity?: GuestIdentity; session?: string; onClosed?: () => void }) {
  const secure = !!identity;
  const delivery = identity?.order_type === 'delivery';
  const visit = useGuestVisit(token, secure, session);
  const [recoveryCode, setRecoveryCode] = useState(() => { try { return sessionStorage.getItem(`premier_qr_pin_${session}`) || ''; } catch { return ''; } });
  useEffect(() => { if (visit.tracking.visit?.closed) onClosed?.(); }, [visit.tracking.visit?.closed, onClosed]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cart, setCart] = useState<Record<string, QrItem>>({});
  const [table, setTable] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [detail, setDetail] = useState<QrProduct | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [page, setPage] = useState<'home' | 'cart' | 'visit'>('home');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState('');
  const [retry, setRetry] = useState<Draft | null>(null);
  const lock = useRef(false);
  const categoriesRef = useRef<HTMLDivElement>(null);
  const categoryDrag = useRef<{ x: number; scroll: number; moved: boolean } | null>(null);
  const suppressCategoryClick = useRef(false);
  const [categoryScroll, setCategoryScroll] = useState({ back: false, next: false });
  const storageKey = `premier_qr_pending_v1_${token}`;
  // Each screen starts at its header, even after scrolling a long product list.
  const detailId = detail?.id;
  useEffect(() => { document.documentElement.scrollTop = 0; }, [detailId, page]);
  const activeBill = [...visit.tracking.bills].reverse().find(b => ['open', 'held'].includes(b.status));
  useEffect(() => { if (activeBill?.table_id) setTable(activeBill.table_id); }, [activeBill?.table_id]);
  useEffect(() => {
    const node = categoriesRef.current;
    if (!node) return;
    const update = () => setCategoryScroll({ back: Math.abs(node.scrollLeft) > 2, next: Math.abs(node.scrollLeft) + node.clientWidth < node.scrollWidth - 2 });
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY || event.deltaX || event.ctrlKey) return;
      const previous = node.scrollLeft;
      node.scrollLeft -= event.deltaY;
      if (node.scrollLeft !== previous) event.preventDefault();
    };
    update();
    node.addEventListener('scroll', update, { passive: true });
    node.addEventListener('wheel', wheel, { passive: false });
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    resize?.observe(node);
    return () => { node.removeEventListener('scroll', update); node.removeEventListener('wheel', wheel); resize?.disconnect(); };
  }, [menu, detailId, page]);
  useEffect(() => {
    let alive = true;
    setMenu(null); setCart({}); setRetry(null); setError(''); setReceipt(''); setTable(identity?.table_id || ''); setDetail(null); setPage(identity?.has_request ? 'visit' : 'home');
    try {
      const stored: Draft = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (stored?.key && Array.isArray(stored.items) && (!secure || stored.session === session)) {
        setRetry(stored); setTable(stored.table || ''); setPage('cart');
        setCart(Object.fromEntries(stored.items.map(item => [item.product_id, item])));
      }
    } catch { /* Storage may be disabled. */ }
    void (secure ? qrPublic.guestMenu({ p_token: token, p_session: session! }) : qrPublic.menu({ p_token: token })).then(({ data, error: failure }) => {
      if (!alive) return;
      if (failure) setError(qrError(failure)); else setMenu(data);
    }).catch(failure => { if (alive) setError(qrError(failure)); });
    return () => { alive = false; };
  }, [token, storageKey, identity, secure, session]);
  async function submit() {
    if (lock.current || (!retry && !table && !delivery)) return;
    lock.current = true; setBusy(true); setError('');
    const draft = retry || { key: crypto.randomUUID(), items: Object.values(cart).filter(i => i.quantity > 0), table, session: visit.session };
    // Old uncertain drafts remain on their original link's default table.
    const selectedTable = delivery ? '' : draft.table || menu?.table_id || '';
    setRetry({ ...draft, table: selectedTable });
    try {
      try { sessionStorage.setItem(storageKey, JSON.stringify({ ...draft, table: selectedTable })); } catch { /* In-memory fallback. */ }
      const payload = { p_token: token, p_key: draft.key, p_items: draft.items, p_table: selectedTable };
      const { data, error: failure } = secure ? await qrPublic.guestSubmit({ ...payload, p_table: delivery ? null : selectedTable, p_session: visit.session }) : draft.session
        ? await qrPublic.submit({ ...payload, p_session: draft.session })
        : await qrPublic.submitLegacy(payload);
      if (failure) throw failure;
      if (!data?.id) throw new Error('QR_EMPTY_RESPONSE');
      setReceipt(data.id);
      if (data.recovery_code) { setRecoveryCode(data.recovery_code); try { sessionStorage.setItem(`premier_qr_pin_${session}`, data.recovery_code); } catch { /* Display remains in memory. */ } }
      setCart({}); setRetry(null);
      setPage('visit'); void visit.refresh();
      try { sessionStorage.removeItem(storageKey); } catch { /* No storage. */ }
    } catch (failure) {
      setError(qrError(failure));
      const message = typeof failure === 'object' && failure && 'message' in failure ? String(failure.message) : '';
      if (/QR_(PRICE_CHANGED|PRODUCT_UNAVAILABLE|INVALID_ITEMS|RATE_LIMITED|LINK_INVALID|TABLE_INVALID|DISABLED|SESSION_EXPIRED)/.test(message)) {
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
      <div className="customer-table"><label htmlFor="customer-table">{delivery ? 'نوع الطلب' : secure ? 'طاولتك المعتمدة' : 'اختر طاولتك'}</label>{delivery ? <strong>توصيل</strong> : <select id="customer-table" value={table} disabled={secure || disabled || !!activeBill} onChange={e => setTable(e.target.value)}><option value="">اختر الطاولة</option>{menu?.tables?.map(t => <option key={t.id} value={t.id}>{t.name}{t.busy ? ' · مشغولة' : ''}</option>)}</select>}</div>
      <p className="customer-table-hint">{secure ? delivery ? 'تابع طلب التوصيل وحسابه من زر طلبي.' : 'الطاولة مرتبطة بزيارتك؛ تغييرها يتم لدى الموظف فقط.' : menu?.tables?.find(t => t.id === table)?.busy ? 'هذه الطاولة مشغولة؛ سيؤكد الموظف طاولة بديلة معك.' : 'الموظف يؤكد الطاولة والطلب قبل التحضير.'}</p>
      {error && <p role="alert" className="customer-alert">{error}</p>}
      {recoveryCode && <div className="customer-recovery" role="status"><strong>رمز استرجاع طلبك: <b dir="ltr">{recoveryCode}</b></strong><p>احتفظ به لفتح طلبك من جهاز جديد. لا تشاركه مع الآخرين. إذا نسيته اطلب رمزًا جديدًا من الموظف.</p></div>}
      {receipt && <div role="status" className="customer-receipt"><Check size={26} /><strong>وصل طلبك للموظف</strong><p>{receipt}</p><small>تابع حالة طلبك وحسابك من زر «طلبي».</small></div>}
      {page === 'home' ? <>
        <div className="customer-search"><Search size={21} /><input aria-label="ابحث في المنيو" placeholder="ابحث الآن" value={query} onChange={e => setQuery(e.target.value)} /><button aria-label="عرض كل التصنيفات" onClick={() => { setCategory(''); document.getElementById('customer-categories')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}><SlidersHorizontal size={20} /></button></div>
        {!query && !onlyFavorites && <div className="customer-promos"><div className="customer-promo-main"><div><span>طازج ولذيذ</span><h2>{appearance.banner_text || 'كل اللي بتحبه،\nفي طلب واحد'}</h2><small>اختر وجبتك واستمتع بوقتك</small></div>{appearance.banner_image_url ? <img src={appearance.banner_image_url} alt="اختيارات الفرع" /> : <span aria-hidden="true" className="customer-promo-food">{foodSymbol(categories[0]?.name || 'burger')}</span>}</div><div className="customer-promo-side" aria-hidden="true">☕<span>لحظتك الحلوة</span></div></div>}
        <div className="customer-category-navigation"><div className="customer-category-heading"><h2>الأقسام</h2><div><button aria-label="الأقسام السابقة" disabled={!categoryScroll.back} onClick={() => categoriesRef.current?.scrollBy({ left: 250, behavior: 'smooth' })}><ChevronRight size={21} /></button><button aria-label="الأقسام التالية" disabled={!categoryScroll.next} onClick={() => categoriesRef.current?.scrollBy({ left: -250, behavior: 'smooth' })}><ChevronLeft size={21} /></button></div></div><div id="customer-categories" ref={categoriesRef} className="customer-categories" aria-label="أقسام المنيو"
          onPointerDown={e => { if (e.pointerType === 'mouse' && e.button === 0) { categoryDrag.current = { x: e.clientX, scroll: e.currentTarget.scrollLeft, moved: false }; suppressCategoryClick.current = false; } }}
          onPointerMove={e => { const drag = categoryDrag.current; if (!drag) return; if (Math.abs(e.clientX - drag.x) > 6) { drag.moved = true; suppressCategoryClick.current = true; e.currentTarget.setPointerCapture(e.pointerId); } if (drag.moved) { e.currentTarget.scrollLeft = drag.scroll - (e.clientX - drag.x); e.preventDefault(); } }}
          onPointerUp={() => { categoryDrag.current = null; }} onPointerCancel={() => { categoryDrag.current = null; }}
          onClickCapture={e => { if (suppressCategoryClick.current) { e.preventDefault(); e.stopPropagation(); suppressCategoryClick.current = false; } }}><button className={!category ? 'is-selected' : ''} onClick={() => setCategory('')}><span>🍽️</span>الكل</button>{categories.map(c => <button key={c.id} className={category === c.id ? 'is-selected' : ''} onClick={() => setCategory(c.id)}><span>{foodSymbol(c.name)}</span>{c.name}</button>)}</div></div>
        <div className="customer-section-title"><h2>{onlyFavorites ? 'المفضلة' : category ? categories.find(c => c.id === category)?.name : 'اقتراحات لك'}</h2><button onClick={() => { setCategory(''); setQuery(''); setOnlyFavorites(false); }}>الكل ‹</button></div>
        {!menu && !error && <p className="customer-empty" role="status">جارٍ تحميل المنيو…</p>}
        {menu && filtered.length === 0 && <p className="customer-empty">لا توجد أصناف للعرض حاليًا.</p>}
        <div className="customer-products">{filtered.map(p => <article key={p.id} className="customer-product"><button className="customer-product-open" aria-label={`تفاصيل ${p.name}`} onClick={() => openProduct(p)}><div className="customer-product-image"><FoodImage key={p.id} product={p} /></div><strong>{Number(p.price).toFixed(2)} <small>{currency}</small></strong><h3>{p.name}</h3><p>{p.category_name || 'منيو الفرع'}</p></button><button className="customer-add" aria-label={`إضافة ${p.name}`} disabled={disabled} onClick={() => openProduct(p)}>{cart[p.id]?.quantity ? <span>{cart[p.id].quantity} في السلة</span> : <Plus size={20} />}</button></article>)}</div>
        {!retry && <button className="customer-refresh" disabled={busy} onClick={() => window.location.reload()}>تحديث المنيو والأسعار</button>}
      </> : page === 'visit' ? <GuestVisitPanel secure={secure} key={visit.session} token={token} session={visit.session} table={table} currency={currency} tracking={visit.tracking} error={visit.error} refresh={visit.refresh} newVisit={() => { if (!retry) { visit.newVisit(); setReceipt(''); setTable(''); } }} /> : <section className="customer-cart"><div className="customer-section-title"><h2>سلتك</h2><span>{count} أصناف</span></div>{items.length === 0 && !receipt && <div className="customer-empty"><ShoppingBag size={42} /><p>سلتك في انتظار اختياراتك</p><button onClick={() => setPage('home')}>استكشف المنيو</button></div>}{items.map(i => <article className="customer-cart-item" key={i.product_id}><strong>{menu?.products.find(p => p.id === i.product_id)?.name || i.name || 'صنف'}</strong><span>{(i.price * i.quantity).toFixed(2)} {currency}</span><label>الكمية<input aria-label={`كمية ${i.name || menu?.products.find(p => p.id === i.product_id)?.name}`} type="number" min="0" max="99" value={i.quantity} disabled={disabled} onChange={e => changeQuantity(i.product_id, Number(e.target.value))} /></label><label>ملاحظات<input maxLength={300} value={i.notes} disabled={disabled} onChange={e => setCart(c => ({ ...c, [i.product_id]: { ...c[i.product_id], notes: e.target.value } }))} /></label></article>)}
        <div className="customer-total"><span>إجمالي الأصناف</span><strong>{total.toFixed(2)} {currency}</strong></div><p className="customer-table-hint">الضرائب حسب فاتورة الفرع · الدفع لدى الموظف</p>
        <button className="customer-primary" disabled={busy || (!retry && (!items.length || (!table && !delivery)))} onClick={() => void submit()}>{busy ? 'جارٍ الإرسال…' : retry ? 'إعادة إرسال نفس الطلب بأمان' : 'إرسال الطلب للموظف'}</button>
        {retry && <p className="customer-alert">نتيجة الطلب السابق غير مؤكدة. أعد إرساله بنفس الرقم لتجنب التكرار.</p>}
      </section>}
      <nav className="customer-bottom" aria-label="تصفح المنيو"><button aria-label="طلبي وحسابي" className={page === 'visit' ? 'is-active' : ''} onClick={() => setPage('visit')}><ReceiptText size={19} />طلبي</button><button className={page === 'home' ? 'is-active' : ''} onClick={() => setPage('home')}><Home size={19} />الرئيسية</button><button onClick={() => { setPage('home'); setTimeout(() => document.getElementById('customer-categories')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); }}><Grid2X2 size={19} />التصنيفات</button><button className={page === 'cart' ? 'is-active' : ''} onClick={() => setPage('cart')}><ShoppingBag size={19} />السلة</button><button className="customer-cart-bubble" aria-label={`فتح السلة، ${count} أصناف`} onClick={() => setPage('cart')}><ShoppingBag size={22} />{count > 0 && <b>{count}</b>}</button></nav>
    </>}
  </main>;
}
