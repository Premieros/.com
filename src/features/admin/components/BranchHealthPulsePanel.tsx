import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { admin } from '@/api';
import { Button } from '@/components/Button';
import { Card } from '@/components/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchScope } from '@/lib/branchScope';

export interface BranchHealthSnapshot {
  success?: boolean;
  error?: string;
  branch_id?: string | null;
  generated_at?: string;
  active_shifts?: number;
  open_orders?: number;
  active_print_jobs?: number;
  stale_active_print_jobs?: number;
  pending_work_authorizations?: number;
}

export function branchHealthSignals(snapshot: BranchHealthSnapshot) {
  const count = (value: unknown) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  };
  return {
    shifts: count(snapshot.active_shifts),
    orders: count(snapshot.open_orders),
    printing: count(snapshot.active_print_jobs),
    stalledPrinting: count(snapshot.stale_active_print_jobs),
    approvals: count(snapshot.pending_work_authorizations),
  };
}

type Result = { branchId: string; snapshot?: BranchHealthSnapshot; error?: boolean };

/** Uses the existing server-authorized health snapshot. Read-only and scoped to selected branches. */
export function BranchHealthPulsePanel() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { user } = useAuth();
  const branchScope = useBranchScope();
  const ids = branchScope.selectedBranchIds;
  const scope = JSON.stringify([user?.id, user?.role, branchScope.scopeKey, ids]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const requestId = useRef(0);
  const [result, setResult] = useState<{ scope: string; rows: Result[]; at: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    if (!user?.id || ids.length === 0) {
      setResult(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const resolved = await Promise.all(ids.map(async branchId => {
        try {
          const response = await admin.getSystemHealthSnapshot({ p_branch_id: branchId });
          const data = response.data as BranchHealthSnapshot | null;
          // A returned snapshot must belong to its requested branch.
          if (response.error || !data || data.success === false || (data.branch_id && data.branch_id !== branchId)) {
            return { branchId, error: true } as Result;
          }
          return { branchId, snapshot: data } as Result;
        } catch {
          return { branchId, error: true } as Result;
        }
      }));
      if (request === requestId.current && activeScope.current === scope) {
        setResult({ scope, rows: resolved, at: new Date().toLocaleString(ar ? 'ar-EG' : 'en-GB') });
      }
    } finally {
      if (request === requestId.current && activeScope.current === scope) setLoading(false);
    }
  }, [ar, ids, scope, user?.id]);

  useEffect(() => {
    setResult(null);
    void refresh();
    return () => { requestId.current += 1; };
  }, [refresh]);

  const names = useMemo(() => new Map(branchScope.organizationBranches.map(branch => [
    branch.id, (ar ? branch.name : (branch.name_en || branch.name)),
  ])), [ar, branchScope.organizationBranches]);
  const current = result?.scope === scope ? result : null;

  return (
    <Card className="overflow-hidden" data-testid="branch-health-pulse">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border p-4">
        <div>
          <h2 className="flex items-center gap-2 font-bold"><Activity className="h-4 w-4 text-ui-primary" />{ar ? 'نبضة الفروع — سلامة التشغيل' : 'Branch pulse — operational health'}</h2>
          <p className="text-xs text-ui-muted">
            {ar ? 'لقطة عند الطلب للفروع المحددة. المؤشرات عددية ولا تمثل تقرير مبيعات أو قياس نشاط لحظي.' : 'On-demand snapshot for selected branches. Counts are not live activity or sales metrics.'}
          </p>
          {current && <p className="mt-1 text-xs text-ui-muted">{ar ? 'آخر تحديث:' : 'Last refreshed:'} {current.at}</p>}
        </div>
        <Button variant="outline" size="sm" disabled={loading || ids.length === 0} onClick={() => void refresh()}>
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{ar ? 'تحديث الفروع' : 'Refresh branches'}
        </Button>
      </div>
      {!current && loading && <p role="status" className="p-4 text-sm text-ui-muted">{ar ? 'جارٍ تحميل حالة الفروع...' : 'Loading branch health...'}</p>}
      {!ids.length && <p className="p-4 text-sm text-ui-muted">{ar ? 'اختر فرعًا من نطاق الفروع.' : 'Select a branch from the branch scope.'}</p>}
      {current && <div className="grid gap-3 p-4 lg:grid-cols-2">
        {current.rows.map(({ branchId, snapshot, error }) => {
          const signals = snapshot ? branchHealthSignals(snapshot) : null;
          return <div key={branchId} className="rounded-xl border border-ui-border bg-ui-page-alt p-4">
            <h3 className="mb-3 font-semibold">{names.get(branchId) || (ar ? 'فرع غير معروف' : 'Unknown branch')}</h3>
            {error || !signals ? <p role="alert" className="text-sm text-ui-danger">
              {ar ? 'تعذر تحميل بيانات هذا الفرع، ولم تُعرض قيم افتراضية.' : 'Could not load this branch; no default zero values are shown.'}
            </p> : (
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                {([
                  ['shifts', ar ? 'ورديات مفتوحة' : 'Open shifts'],
                  ['orders', ar ? 'طلبات مفتوحة' : 'Open orders'],
                  ['printing', ar ? 'مهام طباعة نشطة' : 'Active print jobs'],
                  ['stalledPrinting', ar ? 'طباعة عالقة' : 'Stalled print jobs'],
                  ['approvals', ar ? 'اعتمادات معلقة' : 'Pending approvals'],
                ] as const).map(([key, label]) => (
                  <div key={key} className="rounded-lg border border-ui-border bg-ui-surface p-2">
                    <p className="text-xs text-ui-muted">{label}</p>
                    <p className="mt-1 text-lg font-bold tabular-nums">{signals[key]}</p>
                  </div>
                ))}
              </div>
            )}
          </div>;
        })}
      </div>}
    </Card>
  );
}
