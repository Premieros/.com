import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, ShieldCheck } from 'lucide-react';
import { supabase } from '@/api';
import { Button } from '@/components/Button';
import { Card } from '@/components/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';

type HealthMetric = 'split_tender_mismatch' | 'posted_journal_imbalance'
  | 'overdue_fixed_day_close' | 'empty_closed_day_snapshot';
type HealthRow = {
  metric: HealthMetric;
  bucket_start: string;
  measured_at: string;
  affected_count: number;
  status: 'ok' | 'review';
};
type HealthResponse = {
  success?: boolean;
  error?: string;
  last_sampled_at?: string | null;
  rows?: HealthRow[];
};
const titles: Record<HealthMetric, { ar: string; en: string }> = {
  split_tender_mismatch: { ar: 'تطابق دفعات البيع المقسّم', en: 'Split tender reconciliation' },
  posted_journal_imbalance: { ar: 'توازن القيود المنشورة', en: 'Posted journal balance' },
  overdue_fixed_day_close: { ar: 'الإغلاق اليومي المتأخر', en: 'Overdue business-day close' },
  empty_closed_day_snapshot: { ar: 'سلامة تقارير الأيام المغلقة', en: 'Sealed-day snapshot integrity' },
};
const keys = Object.keys(titles) as HealthMetric[];

export function PosOperationalTrendPanel() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [sampled, setSampled] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (user?.role !== 'super_admin') return;
    setLoading(true);
    try {
      const response = await supabase.rpc('get_pos_operational_health_recent', { p_buckets: 24 });
      if (response.error) throw response.error;
      const data = response.data as HealthResponse | null;
      if (!data || data.success !== true || !Array.isArray(data.rows)) {
        throw new Error(data?.error || 'HEALTH_HISTORY_UNAVAILABLE');
      }
      setRows(data.rows);
      setSampled(data.last_sampled_at || null);
      setError(null);
    } catch {
      setError(ar
        ? 'تعذر قراءة سجل المراقبة؛ لا يمكن اعتبار النظام سليمًا من دون قياس.'
        : 'Health history is unavailable; no healthy status can be assumed.');
      setRows([]);
      setSampled(null);
    } finally {
      setLoading(false);
    }
  }, [ar, user?.role]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Global metrics span organizations: never issue this request for
  // branch-scoped employees or owners, even if this component is mounted.
  if (user?.role !== 'super_admin') return null;

  const latest = rows.length ? rows[0].bucket_start : null;
  const current = rows.filter(row => row.bucket_start === latest);
  const stale = !sampled || Date.now() - new Date(sampled).getTime() > 30 * 60 * 1000;
  const missing = keys.filter(k => !current.some(row => row.metric === k));

  return (
    <Card className="overflow-hidden" data-testid="pos-operational-trends">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border p-4">
        <div>
          <h2 className="flex items-center gap-2 font-bold">
            <ShieldCheck className="h-4 w-4 text-ui-primary" />
            {ar ? 'مراقبة التشغيل المؤرشفة — السوبر أدمن' : 'Recorded operations health — super admin'}
          </h2>
          <p className="text-xs text-ui-subtle">
            {ar ? 'مؤشرات عامة مجمّعة كل 15 دقيقة؛ ليست تفاصيل مستخدمين أو فواتير.'
              : 'Global 15-minute aggregate indicators, not user or invoice data.'}
          </p>
          {sampled && <p className="text-xs text-ui-muted">
            {ar ? 'آخر عينة: ' : 'Last sample: '}{new Date(sampled).toLocaleString(ar ? 'ar-EG' : 'en-GB')}
          </p>}
        </div>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          {ar ? 'تحديث' : 'Refresh'}
        </Button>
      </div>
      <div className="space-y-3 p-4">
        {error && <p role="alert" className="rounded-lg bg-ui-danger/10 p-3 text-sm text-ui-danger">{error}</p>}
        {!error && (stale || missing.length>0) && <p role="status" className="rounded-lg bg-ui-warning/10 p-3 text-xs text-ui-warning">
          {ar ? 'القياس مفقود أو قديم؛ لا تعتبر هذه الفترة خالية من الأعطال.' : 'Monitoring is missing or stale. Do not interpret missing data as healthy.'}
        </p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {keys.map(key => {
            const row = current.find(item => item.metric === key);
            return (
              <div key={key} className="rounded-xl border border-ui-border bg-ui-page-alt p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Activity className="h-4 w-4" />
                  {ar ? titles[key].ar : titles[key].en}
                </div>
                <p className="text-2xl font-black">{row ? row.affected_count : '—'}</p>
                <p className="text-xs text-ui-subtle">{row
                  ? (row.status === 'review' ? (ar ? 'تحتاج مراجعة' : 'Review required') : (ar ? 'لا إشارات في الفترة' : 'No signals in sample'))
                  : (ar ? 'لا توجد عينة' : 'No sample')}</p>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-ui-subtle">
          {ar
            ? 'الحالات المعروضة إشارات تشخيصية فقط؛ أخطاء إدخال العميل لا تُصنّف تلقائيًا عيوبًا في Premier OS. لا تُرسل هذه اللوحة إشعارات خارجية.'
            : 'These are diagnostics, not automatic software-defect classifications. This panel does not send external notifications.'}
        </p>
      </div>
    </Card>
  );
}
