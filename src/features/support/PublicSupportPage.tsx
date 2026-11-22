import { useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { supportApi, type SupportKind, type SupportMessage } from './supportApi';
import { SupportMessages } from './SupportMessages';

const buttonClass = 'rounded-xl bg-ui-primary px-4 py-3 font-semibold text-white disabled:opacity-50';
const fieldClass = 'mt-1 w-full rounded-xl border border-ui-border bg-ui-page p-3';

export function PublicSupportPage() {
  const { branchId = '' } = useParams();
  const [mode, setMode] = useState<'new' | 'follow'>('new');
  const [kind, setKind] = useState<SupportKind>('inquiry');
  const [code, setCode] = useState('');
  const [activeCode, setActiveCode] = useState('');
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const attempt = useRef<{ key: string; code: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'new') {
        const key = JSON.stringify([branchId, kind, body.trim()]);
        if (attempt.current?.key !== key) attempt.current = { key, code: crypto.randomUUID().replace(/-/g, '') };
        const result = await supportApi.start(branchId, kind, body.trim(), attempt.current.code);
        if (result.error || !result.data) throw new Error();
        setActiveCode(result.data);
        setCode(result.data);
        setSent(true);
        setMode('follow');
        setMessages([{ id: result.data, body: body.trim(), from_staff: false, created_at: new Date().toISOString() }]);
        attempt.current = null;
      } else {
        const number = code.trim().toLowerCase();
        const result = await supportApi.follow(branchId, number, activeCode === number ? body.trim() || undefined : undefined);
        if (result.error || !result.data) throw new Error();
        setActiveCode(number);
        setMessages(result.data);
      }
      setBody('');
    } catch {
      setMessage(mode === 'new' ? 'تعذر إرسال الرسالة. حاول مرة أخرى بعد قليل.'
        : 'تعذر فتح المحادثة أو إرسال الرسالة. تأكد من رقم المتابعة وحاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  };

  const selectMode = (next: typeof mode) => {
    setMode(next); setActiveCode(''); setMessages([]); setMessage(''); setSent(false); setBody('');
  };
  const inConversation = mode === 'follow' && !!activeCode && activeCode === code.trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/i.test(branchId)) return <p role="alert">افتح الشكاوى والاستفسارات من موقع الفرع.</p>;

  return <main dir="rtl" className="min-h-screen bg-ui-page p-4 text-ui-text sm:p-8">
    <section className="mx-auto max-w-xl space-y-4 rounded-2xl border border-ui-border bg-ui-surface p-5">
      <h1 className="text-2xl font-bold">الشكاوى والاستفسارات</h1>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} aria-pressed={mode === 'new'} onClick={() => selectMode('new')} className="rounded-lg border border-ui-border px-3 py-2">رسالة جديدة</button>
        <button type="button" disabled={busy} aria-pressed={mode === 'follow'} onClick={() => selectMode('follow')} className="rounded-lg border border-ui-border px-3 py-2">متابعة رسالة</button>
      </div>
      {sent && <div role="status" className="space-y-1 rounded-xl bg-ui-success-soft p-3">
        <p>تم الإرسال. احتفظ برقم المتابعة لقراءة الرد. الرقم يتيح الوصول للمحادثة.</p>
        <input aria-label="رقم المتابعة الخاص بك" dir="ltr" readOnly value={activeCode} onFocus={(event) => event.target.select()} className={fieldClass} />
      </div>}
      <SupportMessages messages={messages} />
      <form className="space-y-3" onSubmit={submit}>
        {mode === 'new' ? <label className="block">نوع الرسالة
          <select value={kind} onChange={(event) => setKind(event.target.value as SupportKind)} className={fieldClass}>
            <option value="inquiry">استفسار</option><option value="complaint">شكوى</option>
          </select>
        </label> : <label className="block">رقم المتابعة
          <input dir="ltr" value={code} onChange={(event) => { setCode(event.target.value); setActiveCode(''); setMessages([]); setBody(''); setSent(false); }}
            maxLength={32} autoComplete="off" required className={fieldClass} />
        </label>}
        {(mode === 'new' || inConversation) && <label className="block">{mode === 'new' ? 'رسالتك' : 'إضافة رد'}
          <textarea rows={3} maxLength={2000} required={mode === 'new'} value={body} onChange={(event) => setBody(event.target.value)} className={fieldClass} />
        </label>}
        {message && <p role="alert" className="text-ui-danger">{message}</p>}
        <button disabled={busy || (mode === 'new' && !body.trim()) || (mode === 'follow' && !/^[0-9a-f]{32}$/i.test(code.trim()))} className={buttonClass}>
          {busy ? 'جارٍ التنفيذ…' : mode === 'new' || (inConversation && body.trim()) ? 'إرسال' : 'عرض المحادثة وتحديثها'}
        </button>
      </form>
    </section>
  </main>;
}
