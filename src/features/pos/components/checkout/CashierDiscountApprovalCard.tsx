import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/api';

export function CashierDiscountApprovalCard({
  subtotal,
  currentType,
  onApproved,
  ar,
  canDirectDiscount,
}: {
  subtotal: number;
  currentType: 'amount' | 'percent';
  onApproved: (type: 'amount' | 'percent', amount: number) => void;
  ar: boolean;
  canDirectDiscount: boolean;
}) {
  const [type, setType] = useState<'amount' | 'percent'>(currentType);
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'pending' | 'approved' | 'rejected'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const approvedRequest = useRef<string | null>(null);
  const activeRequest = useRef<string | null>(null);
  const requesting = useRef(false);
  const submittedRequest = useRef<{ type: 'amount' | 'percent'; value: number } | null>(null);
  const submittedSubtotal = useRef<number | null>(null);
  const subtotalRef = useRef(subtotal);
  subtotalRef.current = subtotal;
  const onApprovedRef = useRef(onApproved);
  onApprovedRef.current = onApproved;

  useEffect(() => setType(currentType), [currentType]);


  useEffect(() => {
    if (!requestId) return;

    let active = true;
    let terminal = false;
    let reading = false;
    const isCurrent = () => active && activeRequest.current === requestId && !terminal;
    const acceptStatus = (next: { status?: string }) => {
      if (!isCurrent()) return;
      if (next.status === 'approved') {
        const submitted = submittedRequest.current;
        if (!submitted || approvedRequest.current === requestId) return;
        approvedRequest.current = requestId;
        terminal = true;
        if (submittedSubtotal.current !== subtotalRef.current) {
          setStatus('rejected');
          setError(ar ? 'تغير إجمالي الطلب. أرسل طلب موافقة جديدًا.' : 'Order subtotal changed. Request a new approval.');
          return;
        }
        setStatus('approved');
        onApprovedRef.current(submitted.type, submitted.value);
      } else if (next.status === 'rejected' || next.status === 'expired') {
        terminal = true;
        setStatus('rejected');
      }
    };
    const reconcile = async () => {
      if (!isCurrent() || reading || document.visibilityState !== 'visible') return;
      reading = true;
      try {
        const { data, error: failure } = await supabase.from('approval_requests')
          .select('status').eq('id', requestId).maybeSingle();
        if (!isCurrent()) return;
        if (failure || !data) {
          setError(ar ? 'تعذر التحقق من الموافقة؛ ستتم إعادة المحاولة.' : 'Unable to verify approval; retrying.');
        } else {
          setError('');
          acceptStatus(data);
        }
      } catch {
        if (isCurrent()) setError(ar ? 'تعذر الاتصال للتحقق من الموافقة.' : 'Unable to connect to verify approval.');
      } finally {
        reading = false;
      }
    };
    const channel = supabase
      .channel(`discount-approval-${requestId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'approval_requests',
        filter: `id=eq.${requestId}`,
      }, payload => acceptStatus(payload.new as { status?: string }))
      .subscribe(state => { if (state === 'SUBSCRIBED') void reconcile(); });
    void reconcile();
    const timer = window.setInterval(() => { void reconcile(); }, 10_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void reconcile(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
    };
  }, [requestId]);

  if (canDirectDiscount) return null;

  const request = async () => {
    if (busy || status === 'pending' || amount <= 0 || reason.trim().length < 3) return;
    if (requesting.current) return;

    const normalizedInput = type === 'percent'
      ? Math.min(amount, 100)
      : Math.min(amount, Math.max(subtotal, 0));
    const monetaryDiscount = type === 'percent'
      ? (Math.max(subtotal, 0) * normalizedInput) / 100
      : normalizedInput;
    if (monetaryDiscount <= 0) return;

    requesting.current = true;
    activeRequest.current = null;
    setBusy(true);
    setError('');

    try {
      const { data, error: failure } = await supabase.rpc('request_manager_approval', {
        p_action_type: 'discount',
        p_entity_type: 'sale',
        p_entity_id: null,
        p_payload: {
          discount_amount: monetaryDiscount,
          discount_type: type,
          requested_value: normalizedInput,
          subtotal,
        },
        p_reason: reason.trim(),
      });

      const res = data as {
        success?: boolean;
        request_id?: string;
      } | null;

      if (failure) { setError(failure.message); return; }
      if (res?.success && res.request_id) {
        // The approved action must match exactly what was submitted for review.
        submittedRequest.current = { type, value: normalizedInput };
        submittedSubtotal.current = subtotal;
        approvedRequest.current = null;
        activeRequest.current = res.request_id;
        setRequestId(res.request_id);
        setStatus('pending');
      } else {
        setError(ar ? 'تعذر إرسال طلب الموافقة.' : 'Could not request approval.');
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : (ar ? 'تعذر إرسال الطلب.' : 'Request failed.'));
    } finally {
      requesting.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui-sm">
      <p className="mb-3 text-sm font-black text-ui-text">
        {ar ? 'طلب خصم من المدير' : 'Request manager discount approval'}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as 'amount' | 'percent')}
          disabled={busy || status === 'pending'}
          className="rounded-xl border border-ui-border bg-ui-surface-raised px-3 py-2 text-sm"
        >
          <option value="amount">{ar ? 'قيمة' : 'Amount'}</option>
          <option value="percent">{ar ? 'نسبة %' : 'Percent %'}</option>
        </select>

        <input
          type="number"
          min={0}
          value={amount || ''}
          onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
          disabled={busy || status === 'pending'}
          className="rounded-xl border border-ui-border bg-ui-surface-raised px-3 py-2 text-sm"
          placeholder={ar ? 'قيمة الخصم' : 'Discount'}
        />
      </div>

      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={busy || status === 'pending'}
        className="mt-2 w-full rounded-xl border border-ui-border bg-ui-surface-raised px-3 py-2 text-sm"
        placeholder={ar ? 'سبب الخصم (إجباري)' : 'Reason (required)'}
      />

      {error && <p role="alert" className="mt-2 text-xs text-ui-danger">{error}</p>}
      <button
        type="button"
        onClick={() => void request()}
        disabled={
          busy ||
          status === 'pending' ||
          amount <= 0 ||
          reason.trim().length < 3
        }
        className="mt-3 w-full rounded-xl bg-ui-primary px-4 py-2.5 text-sm font-bold text-ui-primary-fg disabled:opacity-50"
      >
        {status === 'pending'
          ? ar
            ? 'بانتظار موافقة المدير...'
            : 'Waiting for manager...'
          : status === 'approved'
            ? ar
              ? 'تمت الموافقة'
              : 'Approved'
            : status === 'rejected'
              ? ar
                ? 'تم الرفض'
                : 'Rejected'
              : ar
                ? 'إرسال طلب الموافقة'
                : 'Send approval request'}
      </button>
    </div>
  );
}
