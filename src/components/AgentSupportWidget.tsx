import { useEffect, useState, type FormEvent } from 'react';
import { Headphones, Loader2, MessageCircle, RotateCcw, Send, X } from 'lucide-react';

type VisitorSession = { conversationId: string; visitorToken: string };
type ChatLine = { id: number; sender: 'visitor' | 'assistant'; text: string };
type ApiReply = { error?: string; answer?: string; conversationId?: string; visitorToken?: string };

/**
 * Locally rendered support UI. No remote JavaScript or Premier auth token is
 * loaded/sent. Only the explicit visitor question and an AGENT visitor token
 * go to AGENT's separate public-support API.
 */
export function AgentSupportWidget({ onFailure }: { onFailure: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [session, setSession] = useState<VisitorSession | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([
    { id: 1, sender: 'assistant', text: 'أهلًا بك في Premier! كيف يمكنني مساعدتك؟' },
  ]);
  const [error, setError] = useState('');
  const [nextId, setNextId] = useState(2);

  const key = (import.meta.env.VITE_AGENT_SUPPORT_WIDGET_KEY || '').trim();
  const endpoint = (import.meta.env.VITE_AGENT_SUPPORT_ORIGIN || '').trim();

  useEffect(() => {
    try {
      const url = new URL(endpoint);
      if (url.protocol !== 'https:' || url.origin !== endpoint || !/^[a-f0-9]{48}$/.test(key)) {
        onFailure();
      }
    } catch {
      onFailure();
    }
  }, [endpoint, key, onFailure]);

  const api = async (route: string, data: unknown): Promise<ApiReply> => {
    const response = await fetch(endpoint + route, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const payload = await response.json() as ApiReply;
    if (!response.ok) throw new Error(payload.error || 'تعذّر الاتصال بخدمة العملاء.');
    return payload;
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || pending || question.length > 1500) return;
    setPending(true);
    setError('');
    setDraft('');
    setLines((prev) => [...prev, { id: nextId, sender: 'visitor', text: question }]);
    setNextId((current) => current + 1);
    try {
      let current = session;
      if (!current) {
        const started = await api('/api/support/public/sessions', { widgetKey: key });
        if (!started.conversationId || !started.visitorToken) throw new Error('تعذّر بدء المحادثة.');
        current = { conversationId: started.conversationId, visitorToken: started.visitorToken };
        setSession(current);
      }
      const reply = await api('/api/support/public/messages', {
        widgetKey: key,
        conversationId: current.conversationId,
        visitorToken: current.visitorToken,
        text: question,
      });
      setLines((prev) => [...prev, {
        id: nextId + 1,
        sender: 'assistant',
        text: reply.answer || 'لا تتوفر إجابة مؤكدة حاليًا. يمكن التواصل مع الدعم البشري.',
      }]);
      setNextId((current) => current + 2);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'تعذّر إرسال الرسالة.');
    } finally {
      setPending(false);
    }
  };

  const restart = () => {
    setSession(null);
    setError('');
    setLines([{ id: 1, sender: 'assistant', text: 'أهلًا بك! كيف يمكنني مساعدتك؟' }]);
    setNextId(2);
    setDraft('');
  };

  return (
    <div dir="rtl" className="fixed bottom-20 end-4 z-[65] font-[Cairo]">
      {open && (
        <section
          aria-label="مساعد خدمة العملاء الذكي"
          className="mb-3 flex h-[min(70dvh,540px)] w-[min(94vw,390px)] flex-col overflow-hidden rounded-2xl border border-[#dbe8ea] bg-white shadow-2xl"
        >
          <header className="flex items-center gap-3 bg-[#0b5f76] px-4 py-3 text-white">
            <Headphones className="h-6 w-6" />
            <div className="flex-1">
              <h2 className="text-sm font-black">مساعد Premier</h2>
              <p className="text-[11px] text-cyan-100">مدعوم بخدمة AGENT</p>
            </div>
            <button type="button" onClick={restart} aria-label="محادثة جديدة" className="rounded-lg p-2 hover:bg-white/15">
              <RotateCcw className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق" className="rounded-lg p-2 hover:bg-white/15">
              <X className="h-4 w-4" />
            </button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto bg-[#f6fafc] p-4" role="log" aria-live="polite">
            {lines.map((line) => (
              <div key={line.id} className={`flex ${line.sender === 'visitor' ? 'justify-end' : 'justify-start'}`}>
                <p className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-xs leading-6 ${
                  line.sender === 'visitor' ? 'bg-[#0b758b] text-white' : 'bg-[#e9f4f7] text-[#19353f]'
                }`}>{line.text}</p>
              </div>
            ))}
            {pending && <p className="text-xs text-slate-500">جارٍ إعداد الرد…</p>}
          </div>
          {error && (
            <div role="alert" className="space-y-2 border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
              <p>{error}</p>
              <button type="button" onClick={onFailure} className="font-bold underline">
                فتح الدعم البشري بدلًا من ذلك
              </button>
            </div>
          )}
          <form onSubmit={send} className="flex items-end gap-2 border-t border-slate-100 bg-white p-3">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={2}
              maxLength={1500}
              aria-label="رسالة الدعم"
              placeholder="اكتب سؤالك هنا…"
              className="min-h-10 min-w-0 flex-1 resize-none rounded-xl border border-[#cbdde2] bg-white px-3 py-2 text-sm text-[#19353f]"
            />
            <button
              type="submit"
              aria-label="إرسال"
              disabled={pending || !draft.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0b758b] text-white disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
          <p className="bg-white pb-2 text-center text-[10px] text-slate-500">لا ترسل كلمات مرور أو معلومات دفع حساسة.</p>
        </section>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? 'إغلاق مساعد العملاء' : 'فتح مساعد العملاء'}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[#0b758b] text-white shadow-xl transition hover:bg-[#0b5f76]"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>
    </div>
  );
}
