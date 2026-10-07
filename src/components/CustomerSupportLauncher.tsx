import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Headphones, Loader2, MessageCircle, Plus, Send, X } from 'lucide-react';
import { support, type SupportConversation, type SupportMessage } from '@/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { Button } from '@/components/Button';

const INTRO_AR = 'يرجى إرسال وصف المشكلة + رقم التواصل + الفرع + رقم الفاتورة/الطلب إن وجد.';
const INTRO_EN = 'Please send: problem description + contact number + branch + invoice/order number if available.';

export function CustomerSupportLauncher() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const branchId = useBranchFilter();

  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState<SupportConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const activeConversation = useMemo(
    () => conversations.find((row) => row.id === activeId) || null,
    [activeId, conversations],
  );

  const loadConversations = useCallback(async () => {
    if (!user || user.role === 'super_admin') return;
    setLoadingConversations(true);
    try {
      const { data, error: requestError } = await support.listMyConversations();
      if (requestError || data?.success === false) throw requestError || new Error(data?.error || 'SUPPORT_LOAD_FAILED');
      const rows = data?.rows || [];
      setConversations(rows);
      setActiveId((current) => {
        if (current && rows.some((row) => row.id === current)) return current;
        return rows[0]?.id || null;
      });
      setError('');
    } catch (loadError) {
      console.error(loadError);
      setError(ar ? 'تعذر تحميل محادثات الدعم.' : 'Could not load support conversations.');
    } finally {
      setLoadingConversations(false);
    }
  }, [ar, user]);

  const loadMessages = useCallback(async (conversationId: string) => {
    setLoadingMessages(true);
    try {
      const { data, error: requestError } = await support.getMessages({ p_conversation_id: conversationId });
      if (requestError || data?.success === false) throw requestError || new Error(data?.error || 'SUPPORT_MESSAGES_FAILED');
      setMessages(data?.rows || []);
      setError('');
    } catch (loadError) {
      console.error(loadError);
      setError(ar ? 'تعذر تحميل رسائل الدعم.' : 'Could not load support messages.');
    } finally {
      setLoadingMessages(false);
    }
  }, [ar]);

  useEffect(() => {
    if (!open) return;
    void loadConversations();
  }, [open, loadConversations]);

  useEffect(() => {
    if (!open || !activeId) {
      setMessages([]);
      return;
    }
    void loadMessages(activeId);
    const timer = window.setInterval(() => {
      void loadMessages(activeId);
      void loadConversations();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [activeId, loadConversations, loadMessages, open]);

  const createConversation = async (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const { data, error: requestError } = await support.openConversation({
        p_branch_id: branchId,
        p_subject: ar ? 'طلب دعم جديد' : 'New support request',
        p_message: body,
      });
      if (requestError || data?.success === false || !data?.conversation_id) {
        throw requestError || new Error(data?.error || 'SUPPORT_CREATE_FAILED');
      }
      setDraft('');
      await loadConversations();
      setActiveId(data.conversation_id);
      await loadMessages(data.conversation_id);
    } catch (sendError) {
      console.error(sendError);
      setError(ar ? 'تعذر إرسال طلب الدعم.' : 'Could not send support request.');
    } finally {
      setSending(false);
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !activeId || sending || activeConversation?.status !== 'open') return;
    setSending(true);
    try {
      const { data, error: requestError } = await support.sendMessage({
        p_conversation_id: activeId,
        p_message: body,
      });
      if (requestError || data?.success === false) throw requestError || new Error(data?.error || 'SUPPORT_SEND_FAILED');
      setDraft('');
      await loadMessages(activeId);
      await loadConversations();
    } catch (sendError) {
      console.error(sendError);
      setError(ar ? 'تعذر إرسال الرسالة.' : 'Could not send message.');
    } finally {
      setSending(false);
    }
  };

  if (!user || user.role === 'super_admin') return null;

  return (
    <>
      <button
        type="button"
        data-testid="support-floating-button"
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-5 end-5 z-[65] flex h-14 w-14 items-center justify-center rounded-full bg-ui-primary text-ui-primary-fg shadow-xl transition hover:bg-ui-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-ring"
        aria-label={ar ? 'محادثة خدمة العملاء' : 'Customer support chat'}
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {open && (
        <section
          data-testid="support-chat-panel"
          className="fixed bottom-24 end-4 z-[64] flex h-[min(72dvh,620px)] w-[min(94vw,390px)] flex-col overflow-hidden rounded-2xl border border-ui-border bg-ui-surface shadow-2xl"
          aria-label={ar ? 'محادثة خدمة العملاء' : 'Customer support chat'}
        >
          <header className="flex items-center justify-between gap-3 border-b border-ui-border bg-ui-page-alt px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ui-primary-soft text-ui-primary">
                <Headphones className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-black text-ui-text">{ar ? 'خدمة العملاء' : 'Customer Support'}</h2>
                <p className="truncate text-[11px] text-ui-subtle">{ar ? 'Premier Support' : 'Premier Support'}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveId(null);
                setMessages([]);
              }}
              className="flex min-h-9 items-center gap-1 rounded-lg border border-ui-border bg-ui-surface px-2 text-[11px] font-bold text-ui-text"
            >
              <Plus className="h-3.5 w-3.5" />
              {ar ? 'جديد' : 'New'}
            </button>
          </header>

          <div className="border-b border-ui-border bg-ui-primary-soft/40 px-4 py-3 text-xs font-semibold leading-5 text-ui-text">
            {ar ? INTRO_AR : INTRO_EN}
          </div>

          {conversations.length > 0 && (
            <div className="flex gap-2 overflow-x-auto border-b border-ui-border px-3 py-2 scrollbar-none">
              {conversations.map((conversation) => (
                <button
                  type="button"
                  key={conversation.id}
                  onClick={() => setActiveId(conversation.id)}
                  className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${
                    conversation.id === activeId
                      ? 'border-ui-primary bg-ui-primary-soft text-ui-primary'
                      : 'border-ui-border bg-ui-page-alt text-ui-muted'
                  }`}
                >
                  {conversation.status === 'open' ? (ar ? 'مفتوح' : 'Open') : (ar ? 'مغلق' : 'Closed')}
                  {' · '}
                  {new Date(conversation.last_message_at).toLocaleDateString(ar ? 'ar-EG' : 'en-GB')}
                </button>
              ))}
            </div>
          )}

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {error && (
              <div className="rounded-xl bg-ui-danger-soft p-3 text-xs font-bold text-ui-danger">{error}</div>
            )}

            {!activeId && !loadingConversations && (
              <div className="rounded-xl border border-dashed border-ui-border bg-ui-page-alt p-4 text-center">
                <Headphones className="mx-auto mb-2 h-8 w-8 text-ui-primary" />
                <p className="text-sm font-black text-ui-text">{ar ? 'كيف يمكننا مساعدتك؟' : 'How can we help?'}</p>
                <p className="mt-1 text-xs leading-5 text-ui-muted">{ar ? INTRO_AR : INTRO_EN}</p>
              </div>
            )}

            {activeId && loadingMessages && messages.length === 0 && (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-ui-primary" /></div>
            )}

            {messages.map((message) => {
              const supportMessage = message.sender_kind === 'support';
              return (
                <div key={message.id} className={`flex ${supportMessage ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-5 ${
                    supportMessage
                      ? 'rounded-es-md bg-ui-page-alt text-ui-text'
                      : 'rounded-ee-md bg-ui-primary text-ui-primary-fg'
                  }`}>
                    {supportMessage && (
                      <p className="mb-1 text-[10px] font-black opacity-70">{ar ? 'خدمة العملاء' : 'Support'}</p>
                    )}
                    <p className="whitespace-pre-wrap">{message.body}</p>
                    <time className="mt-1 block text-[9px] opacity-60" dateTime={message.created_at}>
                      {new Date(message.created_at).toLocaleTimeString(ar ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </div>
                </div>
              );
            })}

            {activeConversation?.status === 'closed' && (
              <div className="rounded-xl bg-ui-page-alt p-3 text-center text-xs font-bold text-ui-muted">
                {ar ? 'تم إغلاق هذه المحادثة. يمكنك بدء محادثة جديدة.' : 'This conversation is closed. You can start a new one.'}
              </div>
            )}
          </div>

          <form
            onSubmit={activeId ? sendMessage : createConversation}
            className="border-t border-ui-border bg-ui-surface p-3"
          >
            <div className="flex items-end gap-2">
              <textarea
                data-testid="support-message-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={Boolean(activeId && activeConversation?.status === 'closed')}
                rows={2}
                maxLength={4000}
                placeholder={ar ? 'اكتب رسالتك وبيانات المشكلة...' : 'Write your message and issue details...'}
                className="min-h-11 flex-1 resize-none rounded-xl border border-ui-border bg-ui-page px-3 py-2 text-sm text-ui-text outline-none focus:border-ui-primary disabled:opacity-50"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!draft.trim() || sending || Boolean(activeId && activeConversation?.status === 'closed')}
                aria-label={ar ? 'إرسال' : 'Send'}
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
