import type { SupportMessage } from './supportApi';

export function SupportMessages({ messages }: { messages: SupportMessage[] }) {
  return <ul className="max-h-80 space-y-2 overflow-y-auto overscroll-contain" aria-label="المحادثة">
    {messages.map((message) => <li key={message.id}
      className={`rounded-xl border border-ui-border p-3 ${message.from_staff ? 'bg-ui-primary-soft' : 'bg-ui-page-alt'}`}>
      <strong className="text-xs">{message.from_staff ? 'فريق الفرع' : 'العميل'}</strong>
      <p dir="auto" className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
      <time dateTime={message.created_at} className="text-xs text-ui-muted">
        {new Date(message.created_at).toLocaleString('ar-EG')}
      </time>
    </li>)}
  </ul>;
}
