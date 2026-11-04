import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { ExternalLink, MessageSquare, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

const SUPPORT_API = 'https://premieros-agent-support-public.vercel.app/api/support/premier-inbox';
const AGENT_ORIGIN = 'https://premieros-ai-sales-agent-git-feature-3d3de3-sayedalaa82285-7634.vercel.app';

type AgentConversation = {
  id: string; projectId: string; projectName: string; origin: string;
  mode: 'ai' | 'human'; createdAt: string; updatedAt: string;
  employeeName?: string | null; branchName?: string | null;
  organizationName?: string | null; identityVerified?: boolean;
};
type AgentMessage = {
  id: string; conversationId: string; role: 'customer' | 'assistant' | 'employee' | 'system';
  body: string; createdAt: string;
};
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

function isConversation(v: unknown): v is AgentConversation {
  return isRecord(v) && typeof v.id === 'string' && typeof v.projectId === 'string'
    && typeof v.projectName === 'string' && typeof v.origin === 'string'
    && typeof v.updatedAt === 'string'
    && (v.employeeName == null || typeof v.employeeName === 'string')
    && (v.branchName == null || typeof v.branchName === 'string')
    && (v.organizationName == null || typeof v.organizationName === 'string');
}
function isMessage(v: unknown): v is AgentMessage {
  return isRecord(v) && typeof v.id === 'string' && typeof v.conversationId === 'string'
    && typeof v.body === 'string' && typeof v.createdAt === 'string'
    && ['customer', 'assistant', 'employee', 'system'].includes(String(v.role));
}

export function AgentConversationsPanel() {
  const { lang } = useLanguage();
  const { session, user } = useAuth();
  const ar = lang === 'ar';
  const [rows, setRows] = useState<AgentConversation[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const loadConversations = useCallback(async (silent = false) => {
    if (user?.role !== 'super_admin' || !session?.access_token) {
      setError(ar ? 'المحادثات متاحة للمدير العام بعد تسجيل الدخول إلى Premier.' : 'Premier super admin access required.');
      setConnecting(false);
      return;
    }
    if (!silent) setConnecting(true);
    try {
      const response = await fetch(SUPPORT_API, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        headers: { Authorization: 'Bearer ' + session.access_token },
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.error === 'string'
          ? payload.error : (ar ? 'تعذر تحميل محادثات العملاء.' : 'Failed to load conversations.');
        throw new Error(message);
      }
      if (!isRecord(payload) || !Array.isArray(payload.conversations) || !Array.isArray(payload.messages))
        throw new Error(ar ? 'بيانات المحادثات غير صحيحة.' : 'Invalid conversation data.');
      const nextRows = payload.conversations.filter(isConversation).slice(0, 40);
      const allowedIds = new Set(nextRows.map(row => row.id));
      const nextMessages = payload.messages.filter(isMessage)
        .filter(message => allowedIds.has(message.conversationId)).slice(0, 1200);
      setRows(nextRows);
      setMessages(nextMessages);
      setSelectedId(current => nextRows.some(row => row.id === current) ? current : nextRows[0]?.id || '');
      setLoaded(true);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : (ar ? 'تعذر الاتصال بخدمة العملاء.' : 'Unable to connect.'));
    } finally {
      if (!silent) setConnecting(false);
    }
  }, [ar, session?.access_token, user?.role]);

  useEffect(() => {
    if (user?.role !== 'super_admin' || !session?.access_token) return;
    void loadConversations();
    const timer = window.setInterval(() => void loadConversations(true), 15000);
    return () => window.clearInterval(timer);
  }, [loadConversations, session?.access_token, user?.role]);

  const connect = () => { void loadConversations(); };

  const projects = useMemo(() => Array.from(new Map(rows.map(row => [row.projectId, row.projectName]))), [rows]);
  const filtered = useMemo(() => rows.filter(row =>
    (!filter || row.projectId === filter) &&
    (!search.trim() || [row.projectName, row.origin, row.id, row.employeeName || '', row.branchName || '', row.organizationName || ''].some(value =>
      value.toLowerCase().includes(search.toLowerCase().trim())
    ))
  ), [rows, filter, search]);
  const selected = rows.find(row => row.id === selectedId);
  const selectedMessages = useMemo(() => messages.filter(message => message.conversationId === selectedId), [messages, selectedId]);
  const format = (date: string) => {
    const time = new Date(date);
    return Number.isNaN(time.getTime()) ? '' : time.toLocaleString(ar ? 'ar-EG' : 'en-GB');
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ui-border bg-ui-surface p-4">
        <div>
          <h3 className="font-black text-ui-text">{ar ? 'محادثات الشات الجديد' : 'AGENT customer conversations'}</h3>
          <p className="mt-1 text-xs text-ui-subtle">
            {ar ? 'تظهر رسائل AGENT هنا داخل Premier، دون تغيير أو نسخ قاعدة بيانات النظام.' : 'Read AGENT conversations here without changing Premier data.'}
          </p>
        </div>
        <button type="button" disabled={connecting} onClick={connect}
          className="inline-flex items-center gap-2 rounded-xl bg-ui-primary px-4 py-2.5 text-sm font-bold text-ui-primary-fg disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${connecting ? 'animate-spin' : ''}`} />
          {connecting ? (ar ? 'جارٍ تحديث المحادثات...' : 'Connecting...') : loaded
            ? (ar ? 'تحديث المحادثات' : 'Refresh conversations')
            : (ar ? 'تحديث محادثات العملاء' : 'Refresh conversations')}
        </button>
      </div>
      {!loaded && !error && <div className="rounded-xl border border-ui-border bg-ui-page-alt p-5 text-sm leading-7 text-ui-muted">
        {ar
          ? 'تظهر محادثات Premier تلقائيًا باستخدام صلاحية المدير العام الحالية، دون تسجيل دخول إضافي أو نافذة أخرى.'
          : 'Conversations load automatically using the current Premier administrator session.'}
      </div>}
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="grid min-h-[550px] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-2xl border border-ui-border bg-ui-surface">
          <div className="space-y-2 border-b border-ui-border p-3">
            <strong className="text-sm">{ar ? 'المحادثات' : 'Conversations'} ({filtered.length})</strong>
            <select aria-label={ar ? 'تصفية حسب المشروع' : 'Project'} value={filter} onChange={event => setFilter(event.target.value)}
              className="h-10 w-full rounded-xl border border-ui-border bg-ui-surface px-3 text-sm">
              <option value="">{ar ? 'جميع المشاريع' : 'All projects'}</option>
              {projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <input value={search} onChange={event => setSearch(event.target.value)}
              placeholder={ar ? 'بحث في المحادثات...' : 'Search conversations...'}
              className="h-10 w-full rounded-xl border border-ui-border bg-ui-surface px-3 text-sm"/>
          </div>
          <div className="max-h-[570px] overflow-y-auto">
            {filtered.map(row => <button key={row.id} type="button" onClick={() => setSelectedId(row.id)}
              className={`w-full border-b border-ui-border p-3 text-start ${row.id === selectedId ? 'bg-ui-primary-soft' : 'hover:bg-ui-page-alt'}`}>
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 shrink-0 text-ui-primary"/>
                <strong className="truncate text-sm">{row.employeeName || (ar ? 'موظف غير معروف' : 'Unknown employee')}</strong>
              </div>
              <p className="mt-1 text-xs text-ui-muted">{ar ? 'الفرع:' : 'Branch:'} {row.branchName || (ar ? 'غير محدد' : 'Unknown')}</p>
              <p className="mt-1 text-xs text-ui-muted">{ar ? 'المؤسسة:' : 'Organization:'} {row.organizationName || (ar ? 'غير محددة' : 'Unknown')}</p>
              <p className="mt-1 text-[11px] text-ui-subtle">{row.projectName} · {format(row.updatedAt)}</p>
            </button>)}
            {!filtered.length && <p className="p-5 text-center text-sm text-ui-muted">
              {ar ? 'لا توجد محادثات معروضة.' : 'No conversations available.'}
            </p>}
          </div>
        </section>
        <section className="flex min-h-[550px] flex-col overflow-hidden rounded-2xl border border-ui-border bg-ui-surface">
          {selected ? <>
            <div className="border-b border-ui-border p-4">
              <h4 className="font-black">{selected.employeeName || (ar ? 'موظف غير معروف' : 'Unknown employee')}</h4>
              <p className="mt-1 text-sm text-ui-muted">{ar ? 'الفرع:' : 'Branch:'} {selected.branchName || (ar ? 'غير محدد' : 'Unknown')}</p>
              <p className="text-sm text-ui-muted">{ar ? 'المؤسسة:' : 'Organization:'} {selected.organizationName || (ar ? 'غير محددة' : 'Unknown')}</p>
              <p className="mt-1 text-xs text-ui-subtle">{selected.projectName} · {selected.origin} · {format(selected.createdAt)}</p>
              {!selected.identityVerified && <p className="mt-2 text-xs text-amber-700">{ar ? 'هذه المحادثة لم تُربط بعد بهوية موظف موثقة.' : 'Employee identity has not yet been verified for this conversation.'}</p>}
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto bg-ui-page-alt p-4">
              {selectedMessages.map(message => {
                const fromCustomer = message.role === 'customer';
                return <div key={message.id} className={`flex ${fromCustomer ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[87%] rounded-2xl px-3 py-2 text-sm leading-7 ${fromCustomer ? 'bg-ui-surface text-ui-text' : 'bg-ui-primary-soft text-ui-text'}`}>
                    <p className="mb-1 text-xs font-bold text-ui-muted">
                      {fromCustomer ? (ar ? 'العميل' : 'Customer') : message.role === 'assistant'
                        ? (ar ? 'خدمة العملاء' : 'Support') : (ar ? 'موظف الدعم' : 'Support staff')}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    <time className="mt-1 block text-[10px] text-ui-subtle" dateTime={message.createdAt}>{format(message.createdAt)}</time>
                  </div>
                </div>;
              })}
              {!selectedMessages.length && <p className="text-sm text-ui-muted">
                {ar ? 'لا توجد رسائل ضمن المحادثة المعروضة.' : 'No messages in this conversation.'}
              </p>}
            </div>
          </> : <div className="flex flex-1 items-center justify-center p-6 text-center text-ui-muted">
            {ar ? 'اختر محادثة من القائمة لعرض الرسائل.' : 'Select a conversation to read its messages.'}
          </div>}
        </section>
      </div>
      <p className="text-xs text-ui-subtle">
        {ar ? 'عرض للقراءة فقط. تُحمّل آخر 40 محادثة وما يصل إلى 60 رسالة لكل محادثة. استخدم تحديث المحادثات لجلب الجديد.'
          : 'Read-only view of up to 40 conversations and 60 messages per conversation. Use refresh for new messages.'}
        {' '}
        <a href={AGENT_ORIGIN + '/support/conversations'} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-ui-primary underline">
          {ar ? 'لوحة AGENT الكاملة' : 'Full AGENT inbox'} <ExternalLink className="h-3 w-3"/>
        </a>
      </p>
    </div>
  );
}
