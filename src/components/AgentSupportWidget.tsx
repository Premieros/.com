import { useEffect, useState, type FormEvent } from 'react';
import { Headphones, Loader2, MessageCircle, RotateCcw, Send, X } from 'lucide-react';

type VisitorSession = { conversationId: string; visitorToken: string };
type ChatLine = { id: number; sender: 'visitor' | 'assistant'; text: string };
type ApiReply = { error?: string; answer?: string; conversationId?: string; visitorToken?: string };
type PageHint = { route: string; title: string; section: string; alertsVisible: number; alertKinds: string[] };
const mentionsProblem = (message: string) =>
  /(?:مشكلة|خطأ|خطا|فشل|تعذر|عطل|مش شغال|مش بتشتغل|مش بيفتح|مش ظاهر|مش راضي|مش قادر|لا يعمل|لا يفتح|error|bug|issue|failed|not working)/i.test(message);
function currentPageHint(): PageHint {
  // Only page identity and alert count. Never send form, table or customer data.
  const heading = document.querySelector('main h1, [role="main"] h1');
  const section = (heading?.textContent || '').trim().slice(0, 70);
  // Only classify visible error notices on-device; never transmit their raw text.
  const notices = Array.from(document.querySelectorAll('[role="alert"]'))
    .filter(el => !el.closest('[data-premier-support-widget]'))
    .filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).slice(0, 8);
  const labels = notices.map(el => {
    const text = (el.textContent || '').toLowerCase();
    if (/صلاحية|مسموح|مرفوض|permission|forbidden|denied|unauthorized/.test(text)) return 'صلاحيات الوصول';
    if (/اتصال|شبكة|انترنت|شبكه|network|fetch|connection|timeout/.test(text)) return 'الاتصال بالشبكة';
    if (/حفظ|فشل|تعذر|failed|save|server/.test(text)) return 'إتمام العملية أو الحفظ';
    if (/مطلوب|ناقص|غير صالح|invalid|required|validation/.test(text)) return 'التحقق من البيانات';
    return 'تنبيه في الصفحة';
  });
  return {
    route: (window.location.hash.split('?')[0] || window.location.pathname).slice(0, 90),
    title: document.title.slice(0, 80),
    section,
    alertsVisible: notices.length,
    alertKinds: Array.from(new Set(labels)).slice(0, 3),
  };
}


/**
 * Locally rendered support UI. No remote JavaScript or Premier auth token is
 * loaded/sent. Only the explicit visitor question and an AGENT visitor token
 * go to AGENT's separate public-support API.
 */
export function AgentSupportWidget({ onFailure, trialEnabled = false }: { onFailure: () => void; trialEnabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [session, setSession] = useState<VisitorSession | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([
    { id: 1, sender: 'assistant', text: 'أهلًا بك في Premier! كيف يمكنني مساعدتك؟' },
  ]);
  const [error, setError] = useState('');
  const [nextId, setNextId] = useState(2);

  // This public key is scoped on AGENT to https://premieros-sage.vercel.app.
  // No credentials or Premier Supabase tokens leave this app.
  const key = (trialEnabled ? 'dc926f2840ca4334fd94c0dc811e481c73c9b6843d178729' : (import.meta.env.VITE_AGENT_SUPPORT_WIDGET_KEY || '')).trim();
  const endpoint = (trialEnabled ? 'https://premieros-agent-support-public.vercel.app' : (import.meta.env.VITE_AGENT_SUPPORT_ORIGIN || '')).trim();

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
    const pageContext = mentionsProblem(question) ? currentPageHint() : undefined;
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
        ...(pageContext ? { pageContext } : {}),
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
    <div dir="rtl" className="fixed bottom-4 end-3 z-[65] font-[Cairo] sm:bottom-5 sm:end-5">
      {open && (
        <section
          aria-label="محادثة خدمة عملاء Premier"
          className="mb-2 flex h-[min(57dvh,430px)] w-[min(89vw,330px)] flex-col overflow-hidden rounded-2xl border border-[#dbe8ea] bg-white shadow-xl"
        >
          <header className="flex items-center gap-2 bg-[#0b5f76] px-3 py-2.5 text-white">
            <Headphones className="h-6 w-6" />
            <div className="flex-1">
              <h2 className="text-base font-black">خدمة عملاء Premier</h2>
              <p className="text-xs text-cyan-100">كيف يمكننا مساعدتك؟</p>
            </div>
            <button type="button" onClick={restart} aria-label="محادثة جديدة" className="rounded-lg p-2 hover:bg-white/15">
              <RotateCcw className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق" className="rounded-lg p-2 hover:bg-white/15">
              <X className="h-4 w-4" />
            </button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto bg-[#f6fafc] p-3" role="log" aria-live="polite">
            {lines.map((line) => (
              <div key={line.id} className={`flex ${line.sender === 'visitor' ? 'justify-end' : 'justify-start'}`}>
                <p className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-6 ${
                  line.sender === 'visitor' ? 'bg-[#0b758b] text-white' : 'bg-[#e9f4f7] text-[#19353f]'
                }`}>{line.text}</p>
              </div>
            ))}
            {pending && (
              <div className="flex justify-start" role="status" aria-label="خدمة العملاء تكتب الآن">
                <span className="sr-only">خدمة العملاء تكتب الآن</span>
                <div aria-hidden="true" className="flex items-center gap-1.5 rounded-2xl bg-[#e9f4f7] px-4 py-3">
                  <span className="h-2 w-2 rounded-full bg-[#0b758b] animate-bounce [animation-delay:0ms] motion-reduce:animate-none" />
                  <span className="h-2 w-2 rounded-full bg-[#0b758b] animate-bounce [animation-delay:150ms] motion-reduce:animate-none" />
                  <span className="h-2 w-2 rounded-full bg-[#0b758b] animate-bounce [animation-delay:300ms] motion-reduce:animate-none" />
                </div>
              </div>
            )}
          </div>
          {error && (
            <div role="alert" className="space-y-2 border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
              <p>{error}</p>
              <button type="button" onClick={onFailure} className="font-bold underline">
                فتح الدعم البشري بدلًا من ذلك
              </button>
            </div>
          )}
          <form onSubmit={send} className="flex items-end gap-2 border-t border-slate-100 bg-white p-2.5">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={2}
              maxLength={1500}
              aria-label="رسالة الدعم"
              placeholder="اكتب سؤالك هنا…"
              className="min-h-10 min-w-0 flex-1 resize-none rounded-xl border border-[#cbdde2] bg-white px-3 py-2 text-base text-[#19353f]"
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
          <p className="bg-white pb-2 text-center text-xs text-slate-500">لا ترسل كلمات مرور أو معلومات دفع حساسة.</p>
        </section>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? 'إغلاق خدمة العملاء' : 'فتح خدمة العملاء'}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0b758b] text-white shadow-lg transition hover:bg-[#0b5f76]"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>
    </div>
  );
}
