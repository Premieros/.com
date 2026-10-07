import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, MessageSquareReply, RefreshCw, RotateCcw, Search, Send } from 'lucide-react';
import { support, type SupportConversation, type SupportMessage } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/Button';
import { Card } from '@/components/PageHeader';

export function SupportInboxTab() {
  const { lang } = useLanguage();
  const { show } = useToast();
  const ar = lang === 'ar';

  const [statusFilter, setStatusFilter] = useState<'open' | 'closed' | 'all'>('open');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<SupportConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState('');
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const active = useMemo(
    () => rows.find((row) => row.id === activeId) || null,
    [activeId, rows],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [
        row.subject,
        row.organization_name,
        row.branch_name,
        row.customer_name,
        row.customer_email,
      ].some((value) => String(value || '').toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const loadRows = useCallback(async () => {
    setLoadingRows(true);
    try {
      const { data, error } = await support.listAllConversations({
        p_status: statusFilter === 'all' ? null : statusFilter,
      });
      if (error || data?.success === false) throw error || new Error(data?.error || 'SUPPORT_LIST_FAILED');
      const next = data?.rows || [];
      setRows(next);
      setActiveId((current) => current && next.some((row) => row.id === current) ? current : next[0]?.id || null);
    } catch (error) {
      console.error(error);
      show(ar ? 'تعذر تحميل محادثات الدعم' : 'Failed to load support conversations', 'error');
      setRows([]);
      setActiveId(null);
    } finally {
      setLoadingRows(false);
    }
  }, [ar, show, statusFilter]);

  const loadMessages = useCallback(async (conversationId: string) => {
    setLoadingMessages(true);
    try {
      const { data, error } = await support.getMessages({ p_conversation_id: conversationId });
      if (error || data?.success === false) throw error || new Error(data?.error || 'SUPPORT_MESSAGES_FAILED');
      setMessages(data?.rows || []);
    } catch (error) {
      console.error(error);
      show(ar ? 'تعذر تحميل الرسائل' : 'Failed to load messages', 'error');
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, [ar, show]);

  useEffect(() => { void loadRows(); }, [loadRows]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    void loadMessages(activeId);
    const timer = window.setInterval(() => {
      void loadMessages(activeId);
      void loadRows();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [activeId, loadMessages, loadRows]);

  const sendReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeId || !reply.trim() || sending || active?.status !== 'open') return;
    setSending(true);
    try {
      const { data, error } = await support.sendMessage({
        p_conversation_id: activeId,
        p_message: reply.trim(),
      });
      if (error || data?.success === false) throw error || new Error(data?.error || 'SUPPORT_SEND_FAILED');
      setReply('');
      await loadMessages(activeId);
      await loadRows();
    } catch (error) {
      console.error(error);
      show(ar ? 'تعذر إرسال الرد' : 'Failed to send reply', 'error');
    } finally {
      setSending(false);
    }
  };

  const toggleStatus = async () => {
    if (!active || changingStatus) return;
    const next = active.status === 'open' ? 'closed' : 'open';
    setChangingStatus(true);
    try {
      const { data, error } = await support.setConversationStatus({
        p_conversation_id: active.id,
        p_status: next,
      });
      if (error || data?.success === false) throw error || new Error(data?.error || 'SUPPORT_STATUS_FAILED');
      show(
        next === 'closed'
          ? (ar ? 'تم إغلاق المحادثة' : 'Conversation closed')
          : (ar ? 'تم إعادة فتح المحادثة' : 'Conversation reopened'),
        'success',
      );
      await loadRows();
    } catch (error) {
      console.error(error);
      show(ar ? 'تعذر تحديث حالة المحادثة' : 'Failed to update conversation status', 'error');
    } finally {
      setChangingStatus(false);
    }
  };

  return (
    <div className="grid min-h-[620px] gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="overflow-hidden">
        <div className="border-b border-ui-border p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="font-black text-ui-text">{ar ? 'دعم العملاء' : 'Customer Support'}</h3>
              <p className="text-xs text-ui-subtle">{ar ? 'محادثات المؤسسات والعملاء' : 'Tenant and customer conversations'}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => void loadRows()} disabled={loadingRows}>
              <RefreshCw className={`h-4 w-4 ${loadingRows ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          <div className="relative mb-3">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-subtle" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={ar ? 'بحث بالمؤسسة أو العميل...' : 'Search tenant or customer...'}
              className="h-10 w-full rounded-xl border border-ui-border bg-ui-surface ps-9 pe-3 text-sm text-ui-text outline-none focus:border-ui-primary"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(['open', 'closed', 'all'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`rounded-lg border px-2 py-2 text-xs font-black ${
                  statusFilter === status
                    ? 'border-ui-primary bg-ui-primary-soft text-ui-primary'
                    : 'border-ui-border bg-ui-page-alt text-ui-muted'
                }`}
              >
                {status === 'open'
                  ? (ar ? 'مفتوحة' : 'Open')
                  : status === 'closed'
                    ? (ar ? 'مغلقة' : 'Closed')
                    : (ar ? 'الكل' : 'All')}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[560px] overflow-y-auto">
          {filteredRows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setActiveId(row.id)}
              className={`w-full border-b border-ui-border p-3 text-start transition ${
                row.id === activeId ? 'bg-ui-primary-soft' : 'hover:bg-ui-page-alt'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-black text-ui-text">
                  {row.organization_name || row.subject}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                  row.status === 'open' ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-page-alt text-ui-muted'
                }`}>
                  {row.status === 'open' ? (ar ? 'مفتوحة' : 'Open') : (ar ? 'مغلقة' : 'Closed')}
                </span>
              </div>
              <p className="mt-1 truncate text-xs font-semibold text-ui-muted">
                {row.customer_name || row.customer_email || '-'}
              </p>
              <p className="mt-1 truncate text-[11px] text-ui-subtle">
                {row.branch_name || (ar ? 'بدون فرع محدد' : 'No branch')} · {new Date(row.last_message_at).toLocaleString(ar ? 'ar-EG' : 'en-GB')}
              </p>
            </button>
          ))}

          {!loadingRows && filteredRows.length === 0 && (
            <div className="p-8 text-center text-sm font-bold text-ui-subtle">
              {ar ? 'لا توجد محادثات.' : 'No conversations.'}
            </div>
          )}
        </div>
      </Card>

      <Card className="flex min-h-[620px] flex-col overflow-hidden">
        {!active ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-ui-subtle">
            <div>
              <MessageSquareReply className="mx-auto mb-3 h-10 w-10" />
              <p className="font-bold">{ar ? 'اختر محادثة للرد عليها' : 'Select a conversation to reply'}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border p-4">
              <div>
                <h3 className="font-black text-ui-text">{active.organization_name || active.subject}</h3>
                <p className="text-xs text-ui-subtle">
                  {active.customer_name || active.customer_email || '-'}
                  {' · '}
                  {active.branch_name || (ar ? 'بدون فرع محدد' : 'No branch')}
                </p>
              </div>
              <Button
                size="sm"
                variant={active.status === 'open' ? 'outline' : 'secondary'}
                disabled={changingStatus}
                onClick={() => void toggleStatus()}
              >
                {changingStatus
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : active.status === 'open'
                    ? <CheckCircle2 className="h-4 w-4" />
                    : <RotateCcw className="h-4 w-4" />}
                {active.status === 'open'
                  ? (ar ? 'إغلاق المحادثة' : 'Close conversation')
                  : (ar ? 'إعادة فتح' : 'Reopen')}
              </Button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {loadingMessages && messages.length === 0 && (
                <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-ui-primary" /></div>
              )}

              {messages.map((message) => {
                const supportMessage = message.sender_kind === 'support';
                return (
                  <div key={message.id} className={`flex ${supportMessage ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-6 ${
                      supportMessage
                        ? 'rounded-ee-md bg-ui-primary text-ui-primary-fg'
                        : 'rounded-es-md bg-ui-page-alt text-ui-text'
                    }`}>
                      <p className="mb-1 text-[10px] font-black opacity-70">
                        {supportMessage ? (ar ? 'خدمة العملاء' : 'Support') : (message.sender_name || (ar ? 'العميل' : 'Customer'))}
                      </p>
                      <p className="whitespace-pre-wrap">{message.body}</p>
                      <time className="mt-1 block text-[10px] opacity-60" dateTime={message.created_at}>
                        {new Date(message.created_at).toLocaleString(ar ? 'ar-EG' : 'en-GB')}
                      </time>
                    </div>
                  </div>
                );
              })}
            </div>

            <form onSubmit={sendReply} className="border-t border-ui-border p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  rows={2}
                  maxLength={4000}
                  disabled={active.status !== 'open'}
                  placeholder={active.status === 'open'
                    ? (ar ? 'اكتب رد خدمة العملاء...' : 'Write support reply...')
                    : (ar ? 'المحادثة مغلقة' : 'Conversation is closed')}
                  className="min-h-11 flex-1 resize-none rounded-xl border border-ui-border bg-ui-page px-3 py-2 text-sm text-ui-text outline-none focus:border-ui-primary disabled:opacity-50"
                />
                <Button type="submit" size="sm" disabled={!reply.trim() || sending || active.status !== 'open'}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {ar ? 'إرسال' : 'Send'}
                </Button>
              </div>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
