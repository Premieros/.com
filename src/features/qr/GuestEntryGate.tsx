import { CustomerSupportLink } from '@/features/support/CustomerSupportLink';
import { useBunkerPublicTheme } from './useBunkerPublicTheme';
import { useEffect, useRef, useState } from 'react';
import { qrPublic } from '@/api/domains/qrPublic';
import { GuestPreviousOrders, GuestVisitPanel } from './GuestVisitPanel';
import { TableCamera } from './TableCamera';
import { PublicQrMenu } from './PublicQrMenu';
import { createVisitSecret, readVisit, rememberVisit, resetVisit, useGuestVisit } from './useGuestVisit';
import { useGuestOrderHistory } from './guestOrderHistory';
import { qrError, qrErrorEnglish } from './errors';
import { normalizeRecoveryPin } from './normalizeRecoveryPin';
import { Bike, Store, Utensils } from 'lucide-react';
import type { GuestIdentity, GuestOrderType, QrItem, QrTable } from './service';
import './customer-menu.css';

function ClosedOrder({ token, session, currency, restart }: { token: string; session: string; currency: string; restart: () => void }) {
  const visit = useGuestVisit(token, true, session);
  return <GuestVisitPanel secure token={token} session={session} table="" currency={currency}
    tracking={visit.tracking} error={visit.error} refresh={visit.refresh} newVisit={restart} />;
}

interface DeviceVisit { session: string; type: GuestOrderType; created: number }
const visitListKey = (token: string) => `premier:qr-visits:${token}`;
function readDeviceVisits(token: string): DeviceVisit[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(visitListKey(token)) ?? '[]');
    return Array.isArray(raw) ? raw.filter(visit => /^[a-f0-9]{64}$/.test(visit?.session)
      && ['delivery', 'pickup', 'dine_in'].includes(visit?.type) && Date.now() - visit.created < 86400000) : [];
  } catch { return []; }
}
interface Entry { enabled: boolean; branch_name?: string; branch_address?: string; currency?: string; tables?: QrTable[]; visit?: GuestIdentity; closed?: boolean }
export function GuestEntryGate({ token }: { token: string }) {
  const isBunker = token === '3236a6be44494d89ba2b2a4e7c55fb140564f5a6ae5f4db7bcd7ace6eadeaf62';
  const bunkerMode = useBunkerPublicTheme(isBunker);
  const customerError = isBunker ? qrErrorEnglish : qrError;
  const [session, setSession] = useState(() => readVisit(token));
  const [deviceVisits, setDeviceVisits] = useState(() => readDeviceVisits(token));
  const carriedCart = useRef<{ session: string; items: QrItem[] } | null>(null);
  const nextAttempt = useRef<{ source: string; type: GuestOrderType; table: string | null; secret: string } | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [identity, setIdentity] = useState<GuestIdentity | null>(null);
  const history = useGuestOrderHistory(token);
  const [showHistory, setShowHistory] = useState(false);
  const [step, setStep] = useState<'phone' | 'name' | 'type' | 'table' | 'pickup' | 'pin'>('type');
  const [orderType, setOrderType] = useState<GuestOrderType>('dine_in');
  const [phone, setPhone] = useState(''); const [name, setName] = useState(''); const [pin, setPin] = useState('');
  const [photo, setPhoto] = useState(''); const [table, setTable] = useState('');
  const [camera, setCamera] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false); const lock = useRef(false);
  useEffect(() => {
    let alive = true; setEntry(null); setIdentity(null); setError('');
    void qrPublic.entry({ p_token: token, p_session: session }).then(({ data, error: failure }) => {
      if (!alive) return; if (failure) throw failure;
      setEntry(data); setIdentity(data?.visit || null); setClosed(!!data?.closed);
    }).catch(failure => { if (alive) setError(customerError(failure)); });
    return () => { alive = false; };
  }, [token, session]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { await action(); } catch (failure) { setError(customerError(failure)); } finally { lock.current = false; setBusy(false); }
  }
  async function lookup() {
    const { data, error: failure } = await qrPublic.lookup({ p_token: token, p_session: session, p_phone: phone });
    if (failure) throw failure;
    if (data?.visit) setIdentity(data.visit);
    else if (data?.recovery_unavailable) {
      setError(isBunker ? 'This order is open on another device. Ask our staff for help or continue on the original device.' : 'الطلب مفتوح على جهاز آخر. استخدم الجهاز الأصلي أو اطلب مساعدة الموظف.');
    }
    else if (data?.needs_pin) { setStep('pin'); if (!data.pin_set) setError(isBunker ? 'This visit is open on another device. Ask our team for a recovery code.' : 'هذه الزيارة مفتوحة على جهاز آخر. اطلب رمز استرجاع من الموظف.'); }
    else if (data?.registered) await continueOrder();
    else setStep('name');
  }
  async function continueOrder() {
    if (orderType === 'delivery') await begin('delivery');
    else setStep(orderType === 'dine_in' ? 'table' : 'pickup');
  }
  async function begin(type: GuestOrderType) {
    const { data, error: failure } = await qrPublic.begin({ p_token: token, p_session: session, p_phone: phone, p_name: name, p_type: type, p_table: type === 'dine_in' ? table : null, p_photo: type === 'dine_in' ? photo : null, p_address: null });
    if (failure) throw failure; setIdentity(data);
  }
  async function resume() {
    if (!/^[0-9]{2}$/.test(pin)) throw new Error('QR_PIN_INVALID');
    const { data, error: failure } = await qrPublic.resume({ p_token: token, p_session: session, p_phone: phone, p_pin: pin });
    if (failure) throw failure; if (!data?.success) throw new Error(data?.error || 'QR_PIN_INVALID'); setIdentity(data.visit);
  }
  function restart() { setIdentity(null); setClosed(false); setStep('type'); setPhone(''); setName(''); setPhoto(''); setTable(''); setPin(''); setSession(resetVisit(token)); }
  function openVisit(secret: string) {
    if (secret === session) return;
    rememberVisit(token, secret);
    setIdentity(null);
    setEntry(null);
    setSession(secret);
  }
  async function openNewOrder(type: GuestOrderType, targetTable: string | null, image: string | null, items: QrItem[], sourceType: GuestOrderType) {
    if (!identity) return;
    let attempt = nextAttempt.current;
    if (!attempt || attempt.source !== session || attempt.type !== type || attempt.table !== targetTable) {
      attempt = { source: session, type, table: targetTable, secret: createVisitSecret() };
      nextAttempt.current = attempt;
    }
    const result = await qrPublic.startNextOrder({
      p_token: token, p_session: session, p_next_session: attempt.secret,
      p_type: type, p_table: targetTable, p_photo: image,
    });
    if (result.error || !result.data) throw result.error || new Error('QR_EMPTY_RESPONSE');
    const now = Date.now();
    const records = [
      { session: attempt.secret, type, created: now },
      { session, type: sourceType, created: deviceVisits.find(visit => visit.session === session)?.created ?? now },
      ...deviceVisits.filter(visit => visit.session !== session && visit.session !== attempt.secret),
    ].slice(0, 12);
    setDeviceVisits(records);
    try { localStorage.setItem(visitListKey(token), JSON.stringify(records)); } catch { /* Keep the list in memory. */ }
    carriedCart.current = { session: attempt.secret, items };
    nextAttempt.current = null;
    openVisit(attempt.secret);
  }
  const orderTypeNames = { delivery: isBunker ? 'Delivery' : 'توصيل', pickup: isBunker ? 'Pickup' : 'استلام من المطعم', dine_in: isBunker ? 'Dine in' : 'داخل المطعم' };
  const otherOrders = deviceVisits.filter(visit => visit.session !== session);
  const orderSwitcher = otherOrders.length ? <label className="customer-order-switcher">
    {isBunker ? 'Open another order on this device' : 'فتح طلب آخر على هذا الجهاز'}
    <select value="" onChange={event => openVisit(event.target.value)}>
      <option value="" disabled>{isBunker ? 'Choose an order' : 'اختر طلبًا'}</option>
      {otherOrders.map(visit => <option key={visit.session} value={visit.session}>
        {orderTypeNames[visit.type]} · {new Date(visit.created).toLocaleTimeString(isBunker ? 'en-GB' : 'ar-EG', { hour: '2-digit', minute: '2-digit' })}
      </option>)}
    </select>
  </label> : null;
  if (entry?.enabled === false) return <PublicQrMenu token={token} />;
  if (identity && !closed) return <PublicQrMenu key={session} token={token} identity={identity} session={session}
    carriedItems={carriedCart.current?.session === session ? carriedCart.current.items : undefined}
    orderSwitcher={orderSwitcher} onStartNextOrder={openNewOrder}
    onOrderSubmitted={() => { if (carriedCart.current?.session === session) carriedCart.current = null; }}
    onClosed={() => { setIdentity(null); setClosed(true); }} />;
  return <main dir={isBunker ? "ltr" : "rtl"} data-bunker-theme={isBunker ? bunkerMode : undefined} className={`customer-app customer-entry${isBunker ? " bunker-customer" : ""}`}><header><span className="customer-eyebrow">{entry?.branch_name || (isBunker ? 'BUNKER' : 'Premier')}</span><h1>{closed ? (isBunker ? 'Visit complete' : 'انتهت زيارتك') : (isBunker ? 'Welcome to BUNKER' : 'أهلًا بك')}</h1><p>{closed ? (isBunker ? 'Your visit is complete. Start a new order any time.' : 'أُغلق الدخول لهذه الزيارة. يمكنك بدء طلب جديد.') : (isBunker ? 'Your orders, all in one place.' : 'طلبك وحسابك في مكان واحد')}</p></header>
    <CustomerSupportLink token={token} />
    {error && <p role="alert" className="customer-alert">{error}</p>}
    {!entry ? <><p role="status">{isBunker ? 'Checking branch link…' : 'جارٍ التحقق من رابط الفرع…'}</p>{error && <button className="customer-primary" onClick={() => window.location.reload()}>{isBunker ? 'Try again' : 'إعادة المحاولة'}</button>}</> : closed ? <>{orderSwitcher}<ClosedOrder token={token} session={session} currency={entry.currency || ''} restart={restart} /><button className="customer-primary" onClick={restart}>{isBunker ? 'Start a new order' : 'بدء طلب جديد'}</button></> : <form onSubmit={e => { e.preventDefault(); void run(step === 'phone' ? lookup : step === 'pin' ? resume : step === 'table' ? () => begin('dine_in') : step === 'pickup' ? () => begin(step) : continueOrder); }}>
      {step === 'phone' && <><label>{isBunker ? 'Phone number' : 'رقم الهاتف'}<input type="tel" autoComplete="tel" inputMode="tel" required maxLength={24} value={phone} disabled={busy} onChange={e => setPhone(e.target.value)} /></label><p>{isBunker ? 'If you have an active order, you can reopen it with your recovery code.' : 'إذا كان لديك طلب نشط سنفتح طلبك بعد التحقق من رمز الاسترجاع.'}</p></>}
      {step === 'name' && <label>{isBunker ? 'Your name' : 'اسمك'}<input required autoComplete="name" minLength={2} maxLength={100} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>}
      {step === 'pin' && <><label>{isBunker ? 'Recovery code' : 'رمز استرجاع الطلب'}<input required type="text" inputMode="numeric" autoComplete="off" minLength={2} maxLength={2} value={pin} onChange={e => setPin(normalizeRecoveryPin(e.target.value))} /></label><p>{isBunker ? 'Enter the two-digit code shown after your first order. Ask our team if you need a new one. Recovery locks after three wrong attempts.' : 'الرقمان اللذان ظهرا بعد إرسال أول طلب. إذا نسيتهما، اطلب رمزًا جديدًا من الموظف. بعد ٣ محاولات خاطئة يتوقف الاسترجاع.'}</p></>}
      {step === 'type' && <div className="customer-entry-types">
        <h2>{isBunker ? 'How would you like your order?' : 'كيف تحب تستلم طلبك؟'}</h2>
        {([
          { type: 'delivery', Icon: Bike, title: isBunker ? 'Delivery' : 'توصيل', detail: isBunker ? 'We deliver to your address' : 'نوصّل الطلب لعنوانك' },
          { type: 'dine_in', Icon: Utensils, title: isBunker ? 'Dine in' : 'داخل المطعم', detail: isBunker ? 'Order from your table' : 'اطلب من طاولتك' },
          { type: 'pickup', Icon: Store, title: isBunker ? 'Pickup' : 'استلام من المطعم', detail: isBunker ? 'Collect your order at the branch' : 'استلم طلبك من الفرع' },
        ] as const).map(({ type, Icon, title, detail }) => (
          <button key={type} type="button" className="customer-order-type" onClick={() => { setOrderType(type); setStep('phone'); }}>
            <Icon aria-hidden="true" size={24} /><span><strong>{title}</strong><small>{detail}</small></span>
          </button>
        ))}
      </div>}
      {step === 'type' && history.length > 0 && <button type="button" className="customer-refresh" aria-expanded={showHistory} onClick={() => setShowHistory(value => !value)}>{isBunker ? 'Previous orders on this device' : 'الطلبات السابقة على هذا الجهاز'}</button>}
      {step === 'type' && showHistory && <GuestPreviousOrders token={token} english={isBunker} />}
      {step === 'pickup' && <div className="customer-pickup-summary"><Store aria-hidden="true" size={22} /><div><strong>{entry.branch_name}</strong>{entry.branch_address && <p>{entry.branch_address}</p>}<p>{isBunker ? 'Collect your order at this branch once it is ready.' : 'استلم طلبك من هذا الفرع عند جاهزيته.'}</p></div></div>}
      {step === 'table' && <><h2>{isBunker ? 'Photograph your table number' : 'صوّر رقم طاولتك'}</h2><p>{isBunker ? 'Point your camera at the table number. Our team will confirm it or assign another table.' : 'وجّه الكاميرا لرقم الطاولة فقط. الموظف سيراجع الصورة ويؤكد الطاولة أو يختار لك بديلًا.'}</p>{photo ? <><img className="customer-table-photo" src={photo} alt={isBunker ? 'Table number photo' : 'صورة رقم الطاولة'} /><button type="button" className="customer-refresh" onClick={() => { setPhoto(''); setCamera(true); }}>{isBunker ? 'Retake photo' : 'إعادة التصوير'}</button></> : camera ? <TableCamera onCapture={image => { setPhoto(image); setCamera(false); }} /> : <button type="button" className="customer-primary" onClick={() => setCamera(true)}>{isBunker ? 'Open camera' : 'فتح الكاميرا'}</button>}<label>{isBunker ? 'Table number in photo' : 'رقم الطاولة الظاهر في الصورة'}<select required value={table} onChange={e => setTable(e.target.value)}><option value="">{isBunker ? 'Choose a table' : 'اختر الطاولة'}</option>{entry.tables?.map(t => <option key={t.id} value={t.id}>{t.name}{t.busy ? (isBunker ? ' · Occupied' : ' · مشغولة') : ''}</option>)}</select></label><p>{isBunker ? 'Your visit will be linked to this table. Our team can change it if needed.' : 'بعد الدخول ترتبط بهذه الطاولة، وتعديلها يكون لدى الموظف فقط.'}</p></>}
      {step !== 'type' && <button className="customer-primary" disabled={busy || (step === 'table' && (!photo || !table))}>{busy ? (isBunker ? 'Checking…' : 'جارٍ التحقق…') : step === 'pin' ? (isBunker ? 'Open my order' : 'فتح طلبي') : step === 'table' || step === 'pickup' ? (isBunker ? 'Open menu' : 'دخول المنيو') : (isBunker ? 'Continue' : 'متابعة')}</button>}
      {step === 'phone' && <button type="button" className="customer-refresh" onClick={() => setStep('type')}>{isBunker ? 'Change order type' : 'تغيير نوع الطلب'}</button>}
      {step !== 'phone' && step !== 'type' && <button type="button" disabled={busy} className="customer-refresh" onClick={() => { setStep('phone'); setCamera(false); setError(''); }}>{isBunker ? 'Change phone number' : 'تغيير رقم الهاتف'}</button>}
    </form>}
  </main>;
}
