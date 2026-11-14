import { useEffect, useRef, useState } from 'react';
import { qrPublic } from '@/api/domains/qrPublic';
import { PublicQrMenu } from './PublicQrMenu';
import { readVisit, resetVisit } from './useGuestVisit';
import { qrError } from './errors';
import type { GuestIdentity, QrTable } from './service';
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

interface Entry { enabled: boolean; branch_name?: string; tables?: QrTable[]; visit?: GuestIdentity; closed?: boolean }
export function GuestEntryGate({ token }: { token: string }) {
  const [session, setSession] = useState(() => readVisit(token));
  const [entry, setEntry] = useState<Entry | null>(null);
  const [identity, setIdentity] = useState<GuestIdentity | null>(null);
  const [step, setStep] = useState<'phone' | 'name' | 'type' | 'table' | 'delivery' | 'pin'>('phone');
  const [phone, setPhone] = useState(''); const [name, setName] = useState(''); const [pin, setPin] = useState('');
  const [photo, setPhoto] = useState(''); const [table, setTable] = useState(''); const [address, setAddress] = useState('');
  const [camera, setCamera] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false); const lock = useRef(false);
  useEffect(() => {
    let alive = true; setEntry(null); setIdentity(null); setError('');
    void qrPublic.entry({ p_token: token, p_session: session }).then(({ data, error: failure }) => {
      if (!alive) return; if (failure) throw failure;
      setEntry(data); setIdentity(data?.visit || null); setClosed(!!data?.closed);
    }).catch(failure => { if (alive) setError(qrError(failure)); });
    return () => { alive = false; };
  }, [token, session]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { await action(); } catch (failure) { setError(qrError(failure)); } finally { lock.current = false; setBusy(false); }
  }
  async function lookup() {
    const { data, error: failure } = await qrPublic.lookup({ p_token: token, p_session: session, p_phone: phone });
    if (failure) throw failure;
    if (data?.visit) setIdentity(data.visit);
    else if (data?.needs_pin) { setStep('pin'); if (!data.pin_set) setError('هذه الزيارة مفتوحة على جهاز آخر. اطلب رمز استرجاع من الموظف.'); }
    else setStep(data?.registered ? 'type' : 'name');
  }
  async function begin(type: 'dine_in' | 'delivery') {
    const { data, error: failure } = await qrPublic.begin({ p_token: token, p_session: session, p_phone: phone, p_name: name, p_type: type, p_table: type === 'dine_in' ? table : null, p_photo: type === 'dine_in' ? photo : null, p_address: type === 'delivery' ? address : null });
    if (failure) throw failure; setIdentity(data);
  }
  async function resume() {
    const { data, error: failure } = await qrPublic.resume({ p_token: token, p_session: session, p_phone: phone, p_pin: pin });
    if (failure) throw failure; if (!data?.success) throw new Error(data?.error || 'QR_PIN_INVALID'); setIdentity(data.visit);
  }
  function restart() { setIdentity(null); setClosed(false); setStep('phone'); setPhone(''); setName(''); setPhoto(''); setTable(''); setAddress(''); setPin(''); setSession(resetVisit(token)); }
  if (entry?.enabled === false) return <PublicQrMenu token={token} />;
  if (identity && !closed) return <PublicQrMenu key={session} token={token} identity={identity} session={session} onClosed={() => { setIdentity(null); setClosed(true); }} />;
  return <main dir="rtl" className="customer-app customer-entry"><header><span className="customer-eyebrow">{entry?.branch_name || 'Premier'}</span><h1>{closed ? 'انتهت زيارتك' : 'أهلًا بك'}</h1><p>{closed ? 'أُغلق الدخول لهذه الزيارة. يمكنك بدء طلب جديد.' : 'طلبك وحسابك في مكان واحد'}</p></header>
    {error && <p role="alert" className="customer-alert">{error}</p>}
    {!entry ? <><p role="status">جارٍ التحقق من رابط الفرع…</p>{error && <button className="customer-primary" onClick={() => window.location.reload()}>إعادة المحاولة</button>}</> : closed ? <button className="customer-primary" onClick={restart}>بدء طلب جديد</button> : <form onSubmit={e => { e.preventDefault(); void run(step === 'phone' ? lookup : step === 'pin' ? resume : step === 'table' ? () => begin('dine_in') : step === 'delivery' ? () => begin('delivery') : async () => setStep('type')); }}>
      {step === 'phone' && <><label>رقم الهاتف<input type="tel" autoComplete="tel" inputMode="tel" required maxLength={24} value={phone} disabled={busy} onChange={e => setPhone(e.target.value)} /></label><p>إذا كان لديك طلب نشط سنفتح طلبك بعد التحقق من رمز الاسترجاع.</p></>}
      {step === 'name' && <label>اسمك<input required autoComplete="name" minLength={2} maxLength={100} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>}
      {step === 'pin' && <><label>رمز استرجاع الطلب<input required type="text" inputMode="numeric" autoComplete="off" minLength={2} maxLength={2} value={pin} onChange={e => setPin(e.target.value.replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, ''))} /></label><p>الرقمان اللذان ظهرا بعد إرسال أول طلب. إذا نسيتهما، اطلب رمزًا جديدًا من الموظف. بعد ٣ محاولات خاطئة يتوقف الاسترجاع.</p></>}
      {step === 'type' && <div className="customer-entry-types"><h2>نوع طلبك</h2><button type="button" className="customer-primary" onClick={() => setStep('table')}>داخل المطعم · طاولة</button><button type="button" className="customer-primary" onClick={() => setStep('delivery')}>توصيل</button></div>}
      {step === 'table' && <><h2>صوّر رقم طاولتك</h2><p>وجّه الكاميرا لرقم الطاولة فقط. الموظف سيراجع الصورة ويؤكد الطاولة أو يختار لك بديلًا.</p>{photo ? <><img className="customer-table-photo" src={photo} alt="صورة رقم الطاولة" /><button type="button" className="customer-refresh" onClick={() => { setPhoto(''); setCamera(true); }}>إعادة التصوير</button></> : camera ? <TableCamera onCapture={image => { setPhoto(image); setCamera(false); }} /> : <button type="button" className="customer-primary" onClick={() => setCamera(true)}>فتح الكاميرا</button>}<label>رقم الطاولة الظاهر في الصورة<select required value={table} onChange={e => setTable(e.target.value)}><option value="">اختر الطاولة</option>{entry.tables?.map(t => <option key={t.id} value={t.id}>{t.name}{t.busy ? ' · مشغولة' : ''}</option>)}</select></label><p>بعد الدخول ترتبط بهذه الطاولة، وتعديلها يكون لدى الموظف فقط.</p></>}
      {step === 'delivery' && <label>عنوان التوصيل<textarea required minLength={5} maxLength={500} value={address} onChange={e => setAddress(e.target.value)} /></label>}
      {step !== 'type' && <button className="customer-primary" disabled={busy || (step === 'table' && (!photo || !table))}>{busy ? 'جارٍ التحقق…' : step === 'pin' ? 'فتح طلبي' : step === 'table' || step === 'delivery' ? 'دخول المنيو' : 'متابعة'}</button>}
      {step !== 'phone' && <button type="button" disabled={busy} className="customer-refresh" onClick={() => { setStep('phone'); setCamera(false); setError(''); }}>تغيير رقم الهاتف</button>}
    </form>}
  </main>;
}
