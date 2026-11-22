import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { SupportMessages } from './SupportMessages';
import { supportApi, type SupportMessage, type SupportThread } from './supportApi';

export function CustomerSupportInbox({ branchId }: { branchId: string }) {
  const [rows, setRows] = useState<SupportThread[]>([]);
  const [selected, setSelected] = useState<SupportThread | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  async function load(before?: string) {
    setBusy(true); setError('');
    try {
      const result = await supportApi.list(branchId, before);
      if (result.error || !result.data) throw new Error();
      const page = result.data;
      setRows((current) => before ? [...current, ...page] : page);
      setHasMore(page.length === 30);
    } catch {
      setError('تعذر تحميل الشكاوى والاستفسارات. أعد المحاولة.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, [branchId]);

  async function open(row: SupportThread, reply?: string) {
    setBusy(true); setError('');
    if (selected?.id !== row.id) { setMessages([]); setBody(''); }
    setSelected(row);
    try {
      const result = await supportApi.thread(branchId, row.id, reply);
      if (result.error || !result.data) throw new Error();
      setMessages(result.data);
      if (reply) {
        setBody('');
        setRows((current) => current.map((item) => item.id === row.id ? { ...item, answered: true, latest_message: reply } : item));
      }
    } catch {
      setError(reply ? 'تعذر إرسال الرد. حدّث المحادثة قبل إعادة المحاولة.' : 'تعذر فتح المحادثة.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="space-y-3" dir="rtl" aria-label="الشكاوى والاستفسارات">
    <div className="flex items-center justify-between gap-2">
      <h2 className="font-bold">الشكاوى والاستفسارات</h2>
      <Button variant="outline" disabled={busy} onClick={() => void load()}>تحديث القائمة</Button>
    </div>
    {error && <p role="alert" className="text-ui-danger">{error}</p>}
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="space-y-2">
        {!rows.length && !busy && !error && <p className="text-ui-muted">لا توجد رسائل لهذا الفرع.</p>}
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {rows.map((row) => <li key={row.id}>
            <button type="button" disabled={busy} aria-pressed={selected?.id === row.id}
              onClick={() => void open(row)} className="w-full rounded-xl border border-ui-border p-3 text-start aria-pressed:bg-ui-primary-soft">
              <strong>{row.kind === 'complaint' ? 'شكوى' : 'استفسار'}</strong>
              <span className="ms-2 text-xs text-ui-muted">{row.answered ? 'تم الرد' : 'بانتظار الرد'}</span>
              <p className="truncate text-sm" dir="auto">{row.latest_message}</p>
            </button>
          </li>)}
        </ul>
        {hasMore && <Button variant="outline" disabled={busy} onClick={() => void load(rows[rows.length - 1]?.id)}>تحميل المزيد</Button>}
      </div>
      {selected && <div className="space-y-3 rounded-xl border border-ui-border p-3">
        <SupportMessages messages={messages} />
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); if (!busy && body.trim()) void open(selected, body.trim()); }}>
          <label className="block">رد الفرع
            <textarea rows={3} maxLength={2000} value={body} disabled={busy} onChange={(event) => setBody(event.target.value)}
              className="mt-1 w-full rounded-lg border border-ui-border bg-ui-page p-2" />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !body.trim() || !messages.length}>إرسال الرد</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void open(selected)}>تحديث المحادثة</Button>
          </div>
        </form>
      </div>}
    </div>
  </section>;
}
