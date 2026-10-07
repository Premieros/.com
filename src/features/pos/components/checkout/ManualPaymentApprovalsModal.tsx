import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock3, RefreshCw, X } from 'lucide-react';
import { supabase } from '@/api';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { useLanguage } from '@/context/LanguageContext';
import { formatCurrency } from '@/lib/format';

interface ManualPaymentApprovalsModalProps {
  open: boolean;
  branchId: string;
  currency: string;
  onClose: () => void;
}

interface QueueRow {
  source_type: 'manager_approval';
  source_id: string;
  branch_id: string;
  title: string;
  status: string;
  requested_by: string | null;
  requested_at: string;
  required_permission: string;
  payload: {
    entity_type?: string;
    entity_id?: string | null;
    reason?: string | null;
    payload?: {
      branch_id?: string;
      payment_method?: string;
      amount?: number;
      reference?: string;
      sender_name?: string | null;
      note?: string | null;
    };
  };
}

export function ManualPaymentApprovalsModal({
  open,
  branchId,
  currency,
  onClose,
}: ManualPaymentApprovalsModalProps) {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!open || !branchId) return;
    setLoading(true);
    setError('');
    const { data, error: loadError } = await supabase.rpc('get_operational_approval_queue', {
      p_branch_id: branchId,
    });
    if (loadError) {
      setError(loadError.message);
      setRows([]);
    } else {
      setRows(
        ((data || []) as QueueRow[]).filter(
          (row) => row.source_type === 'manager_approval' && row.title === 'confirm_manual_payment',
        ),
      );
    }
    setLoading(false);
  }, [branchId, open]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => { void load(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [load, open]);

  const pendingCount = useMemo(() => rows.length, [rows.length]);

  const decide = async (row: QueueRow, approve: boolean) => {
    let reason: string | null = null;
    if (!approve) {
      reason = window.prompt(isAr ? 'سبب الرفض:' : 'Rejection reason:');
      if (reason === null) return;
    }

    setDeciding(row.source_id);
    setError('');
    const { data, error: decideError } = await supabase.rpc('decide_operational_approval', {
      p_source_type: 'manager_approval',
      p_source_id: row.source_id,
      p_approve: approve,
      p_reason: reason,
    });
    const result = data as { success?: boolean; error?: string; detail?: string } | null;
    if (decideError || !result?.success) {
      setError(decideError?.message || result?.detail || result?.error || (isAr ? 'تعذر تنفيذ القرار.' : 'Could not apply decision.'));
    }
    setDeciding(null);
    await load();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isAr ? `تأكيد التحويلات المعلقة (${pendingCount})` : `Pending transfer confirmations (${pendingCount})`}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-ui-border bg-ui-page-alt p-3">
          <div>
            <p className="text-sm font-black text-ui-text">
              {isAr ? 'مراجعة InstaPay والتحويلات البنكية' : 'Review InstaPay and bank transfers'}
            </p>
            <p className="mt-1 text-xs font-medium text-ui-muted">
              {isAr
                ? 'وافق فقط بعد التأكد من وصول المبلغ فعليًا إلى حساب المؤسسة.'
                : 'Approve only after verifying that the funds actually reached the business account.'}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {isAr ? 'تحديث' : 'Refresh'}
          </Button>
        </div>

        {error && (
          <div className="rounded-2xl bg-ui-danger/10 p-3 text-xs font-bold text-ui-danger">
            {error}
          </div>
        )}

        {loading && rows.length === 0 ? (
          <div className="p-8 text-center text-sm font-bold text-ui-muted">
            {isAr ? 'جاري تحميل التحويلات...' : 'Loading transfers...'}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm font-bold text-ui-muted">
            {isAr ? 'لا توجد تحويلات معلقة.' : 'No pending transfers.'}
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const payload = row.payload?.payload || {};
              const method = payload.payment_method;
              const methodLabel = method === 'instapay'
                ? 'InstaPay'
                : (isAr ? 'تحويل بنكي' : 'Bank Transfer');
              const amount = Number(payload.amount || 0);
              return (
                <div key={row.source_id} className="rounded-2xl border border-ui-border bg-ui-surface p-4 shadow-ui-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-ui-primary-soft px-2.5 py-1 text-[11px] font-black text-ui-accent">
                          {methodLabel}
                        </span>
                        <span className="flex items-center gap-1 text-[11px] font-bold text-ui-muted">
                          <Clock3 className="h-3.5 w-3.5" />
                          {new Date(row.requested_at).toLocaleString(isAr ? 'ar-EG' : 'en-US')}
                        </span>
                      </div>
                      <p className="mt-3 text-2xl font-black text-ui-text">
                        {formatCurrency(amount, currency, lang)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => void decide(row, true)}
                        disabled={deciding === row.source_id}
                      >
                        <Check className="h-4 w-4" />
                        {isAr ? 'تأكيد' : 'Approve'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void decide(row, false)}
                        disabled={deciding === row.source_id}
                      >
                        <X className="h-4 w-4" />
                        {isAr ? 'رفض' : 'Reject'}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                    <div className="rounded-xl bg-ui-page-alt p-3">
                      <p className="font-bold text-ui-muted">{isAr ? 'مرجع التحويل' : 'Reference'}</p>
                      <p className="mt-1 break-all font-black text-ui-text">{payload.reference || '-'}</p>
                    </div>
                    <div className="rounded-xl bg-ui-page-alt p-3">
                      <p className="font-bold text-ui-muted">{isAr ? 'اسم المحوّل' : 'Sender'}</p>
                      <p className="mt-1 font-black text-ui-text">{payload.sender_name || '-'}</p>
                    </div>
                    {payload.note && (
                      <div className="rounded-xl bg-ui-page-alt p-3 sm:col-span-2">
                        <p className="font-bold text-ui-muted">{isAr ? 'ملاحظة' : 'Note'}</p>
                        <p className="mt-1 font-black text-ui-text">{payload.note}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
