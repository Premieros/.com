import { CustomerSupportLink } from '@/features/support/CustomerSupportLink';
import { useBunkerPublicTheme } from './useBunkerPublicTheme';
import { useEffect, useRef, useState } from 'react';
import { qrPublic } from '@/api/domains/qrPublic';
import { GuestPreviousOrders, GuestVisitPanel } from './GuestVisitPanel';
import { PublicQrMenu } from './PublicQrMenu';
import { readVisit, resetVisit, useGuestVisit } from './useGuestVisit';
import { useGuestOrderHistory } from './guestOrderHistory';
import { qrError, qrErrorEnglish } from './errors';
import { normalizeRecoveryPin } from './normalizeRecoveryPin';
import { Bike, Store, Utensils } from 'lucide-react';
import type { GuestIdentity, GuestOrderType, QrTable } from './service';
import './customer-menu.css';

export function TableCamera({ onCapture }: { onCapture: (image: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true; let stream: MediaStream | undefined;
    void (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 } }, audio: false });
        if (!alive) { media.getTracks().forEach(t => t.stop()); return; }
        stream = media;
        if (video.current) { video.current.srcObject = media; await video.current.play(); }
      } catch { if (alive) setError('تعذر فتح الكاميرا. اسمح باستخدامها من إعدادات المتصفح ثم حاول مجددًا، أو اطلب مساعدة الموظف.'); }
    })();
    return () => { alive = false; stream?.getTracks().forEach(t => t.stop()); };
  }, []);
  function capture() {
    const source = video.current;
    if (!source?.videoWidth || !source.videoHeight) return;
    const scale = Math.min(1, 640 / Math.max(source.videoWidth, source.videoHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(source.videoWidth * scale); canvas.height = Math.round(source.videoHeight * scale);
    const context = canvas.getContext('2d'); if (!context) return;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/jpeg', 0.68);
    if (image.length > 180000) { setError('اقترب من رقم الطاولة وحاول التقاط الصورة مرة أخرى.'); return; }
    onCapture(image);
  }
  return <div className="customer-camera"><video ref={video} playsInline muted onLoadedData={() => setReady(true)} aria-label="كاميرا رقم الطاولة" />{error && <p role="alert" className="customer-alert">{error}</p>}<button type="button" className="customer-primary" disabled={!ready} onClick={capture}>تصوير رقم الطاولة</button></div>;
}

function ClosedOrder({ token, session, currency, restart }: { token: string; session: string; currency: string; restart: () => void }) {
  const visit = useGuestVisit(token, true, session);
  return <GuestVisitPanel secure token={token} session={session} table="" currency={currency}
    tracking={visit.tracking} error={visit.error} refresh={visit.refresh} newVisit={restart} />;
}

interface Entry { enabled: boolean; branch_name?: string; branch_address?: string; currency?: string; tables?: QrTable[]; visit?: GuestIdentity; closed?: boolean }
export function GuestEntryGate({ token }: { token: string }) {
  const isBunker = token === '3236a6be44494d89ba2b2a4e7c55fb140564f5a6ae5f4db7bcd7ace6eadeaf62';
  const bunkerMode = useBunkerPublicTheme(isBunker);
  const customerError = isBunker ? qrErrorEnglish : qrError;
  const [session, setSession] = useState(() => readVisit(token));
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
  if (entry?.enabled === false) return <PublicQrMenu token={token} />;
  if (identity && !closed) return <PublicQrMenu key={session} token={token} identity={identity} session={session} onClosed={() => { setIdentity(null); setClosed(true); }} />;
  return <main dir={isBunker ? "ltr" : "rtl"} data-bunker-theme={isBunker ? bunkerMode : undefined} className={`customer-app customer-entry${isBunker ? " bunker-customer" : ""}`}><header><span className="customer-eyebrow">{entry?.branch_name || (isBunker ? 'BUNKER' : 'Premier')}</span><h1>{closed ? (isBunker ? 'Visit complete' : 'انتهت زيارتك') : (isBunker ? 'Welcome to BUNKER' : 'أهلًا بك')}</h1><p>{closed ? (isBunker ? 'Your visit is complete. Start a new order any time.' : 'أُغلق الدخول لهذه الزيارة. يمكنك بدء طلب جديد.') : (isBunker ? 'Your orders, all in one place.' : 'طلبك وحسابك في مكان واحد')}</p></header>
    <CustomerSupportLink token={token} />
    {error && <p role="alert" className="customer-alert">{error}</p>}
    {!entry ? <><p role="status">{isBunker ? 'Checking branch link…' : 'جارٍ التحقق من رابط الفرع…'}</p>{error && <button className="customer-primary" onClick={() => window.location.reload()}>{isBunker ? 'Try again' : 'إعادة المحاولة'}</button>}</> : closed ? <><ClosedOrder token={token} session={session} currency={entry.currency || ''} restart={restart} /><button className="customer-primary" onClick={restart}>{isBunker ? 'Start a new order' : 'بدء طلب جديد'}</button></> : <form onSubmit={e => { e.preventDefault(); void run(step === 'phone' ? lookup : step === 'pin' ? resume : step === 'table' ? () => begin('dine_in') : step === 'pickup' ? () => begin(step) : continueOrder); }}>
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
