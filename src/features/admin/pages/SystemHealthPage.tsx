import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Database, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { admin, catalog } from '@/api';
import { Card } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranchScope } from '@/lib/branchScope';
import { getAllOfflineSales } from '@/core/offline/offlineStorage';
import { formatNumber } from '@/lib/format';
import { AdminDataManagementPanel } from './AdminDataManagementPanel';

type Status = 'ok' | 'warning' | 'error' | 'checking';
type Check = { key: string; ar: string; en: string; status: Status; detail: string; count?: number };

type HealthSnapshot = {
  success?: boolean;
  error?: string;
  generated_at?: string;
  branch_id?: string | null;
  database_ok?: boolean;
  active_shifts?: number;
  duplicate_open_shift_branches?: number;
  open_orders?: number;
  stale_empty_open_orders?: number;
  vacant_tables_with_effective_orders?: number;
  occupied_tables_without_effective_orders?: number;
  unbalanced_journal_entries?: number;
  sale_payment_detail_mismatch?: number;
  sale_item_refund_integrity_violations?: number;
  live_kitchen_inventory_mismatch?: number;
  active_print_jobs?: number;
  stale_active_print_jobs?: number;
  pending_work_authorizations?: number;
  latest_daily_close_at?: string | null;
};

const n = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function icon(status: Status) {
  if (status === 'ok') return <CheckCircle2 className="h-5 w-5 text-ui-success" />;
  if (status === 'error') return <XCircle className="h-5 w-5 text-ui-danger" />;
  if (status === 'warning') return <AlertTriangle className="h-5 w-5 text-ui-warning" />;
  return <RefreshCw className="h-5 w-5 animate-spin text-brand-600" />;
}

function zeroCheck(
  key: string,
  ar: string,
  en: string,
  value: unknown,
  severity: 'warning' | 'error' = 'error',
): Check {
  const count = n(value);
  return {
    key,
    ar,
    en,
    status: count === 0 ? 'ok' : severity,
    count,
    detail: count === 0 ? 'OK' : `${count}`,
  };
}

export function SystemHealthPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const branchFilter = useBranchFilter();
  const branchScope = useBranchScope();
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);
  const [finishedAt, setFinishedAt] = useState<string | null>(null);

  const runChecks = useCallback(async () => {
    setRunning(true);
    setChecks([{ key: 'loading', ar: 'فحص التشغيل', en: 'Operational health', status: 'checking', detail: ar ? 'جارٍ الفحص...' : 'Checking...' }]);

    const targetBranchIds = branchScope.selectedBranchIds.length > 0
      ? branchScope.selectedBranchIds
      : (branchFilter ? [branchFilter] : []);
    const checkBranchIds = targetBranchIds.length > 0 ? targetBranchIds : [null];
    const [remoteResults, offline, catalogComparisons] = await Promise.all([
      Promise.all(
        checkBranchIds.map((branchId) =>
          admin.getSystemHealthSnapshot({ p_branch_id: branchId }),
        ),
      ),
      getAllOfflineSales().catch(() => []),
      Promise.all(
        checkBranchIds.map((branchId) =>
          catalog.compareCanonicalCatalog(branchId).catch((error) => ({
            branch_id: branchId,
            healthy: false,
            legacy_total: 0,
            canonical_total: 0,
            products: { legacy: 0, canonical: 0, mismatches: 0 },
            raw_materials: { legacy: 0, canonical: 0, mismatches: 0 },
            inventory_units: { legacy: 0, canonical: 0, mismatches: 0 },
            error: error instanceof Error ? error.message : String(error),
          })),
        ),
      ),
    ]);

    const failedRemote = remoteResults.find((result) => result.error || !result.data || typeof result.data !== 'object');
    if (failedRemote) {
      setChecks([{
        key: 'database',
        ar: 'قاعدة البيانات',
        en: 'Database',
        status: 'error',
        detail: failedRemote.error?.message || (ar ? 'تعذر تنفيذ فحص التشغيل' : 'Operational health check failed'),
      }]);
      setFinishedAt(new Date().toLocaleString());
      setRunning(false);
      return;
    }

    const snapshots = remoteResults.map((result) => result.data as HealthSnapshot);
    const numericKeys: (keyof HealthSnapshot)[] = [
      'active_shifts',
      'duplicate_open_shift_branches',
      'open_orders',
      'stale_empty_open_orders',
      'vacant_tables_with_effective_orders',
      'occupied_tables_without_effective_orders',
      'unbalanced_journal_entries',
      'sale_payment_detail_mismatch',
      'sale_item_refund_integrity_violations',
      'live_kitchen_inventory_mismatch',
      'active_print_jobs',
      'stale_active_print_jobs',
      'pending_work_authorizations',
    ];
    const snapshot: HealthSnapshot = snapshots.length <= 1
      ? (snapshots[0] || {})
      : {
          success: snapshots.every((row) => row.success !== false),
          database_ok: snapshots.every((row) => row.database_ok !== false),
          generated_at: new Date().toISOString(),
          branch_id: null,
          latest_daily_close_at: (() => {
            const values = snapshots
              .map((row) => row.latest_daily_close_at)
              .filter((value): value is string => !!value)
              .sort();
            return values.length ? values[values.length - 1] : null;
          })(),
        };
    if (snapshots.length > 1) {
      for (const key of numericKeys) {
        (snapshot as Record<string, unknown>)[key] = snapshots.reduce((sum, row) => sum + n(row[key]), 0);
      }
    }
    if (snapshot.success === false) {
      setChecks([{
        key: 'permission',
        ar: 'صلاحية الفحص',
        en: 'Health permission',
        status: 'error',
        detail: snapshot.error || 'PERMISSION_DENIED',
      }]);
      setFinishedAt(new Date().toLocaleString());
      setRunning(false);
      return;
    }

    const blockedOffline = offline.filter((row) => row.status === 'failed').length;
    const retryingOffline = offline.filter((row) => row.status === 'pending' || row.status === 'syncing').length;

    const catalogMismatchCount = catalogComparisons.reduce((sum, row) =>
      sum + row.products.mismatches + row.raw_materials.mismatches + row.inventory_units.mismatches,
    0);
    const catalogReadErrors = catalogComparisons.filter((row) => 'error' in row).length;
    const canonicalLegacyTotal = catalogComparisons.reduce((sum, row) => sum + row.legacy_total, 0);
    const canonicalReadTotal = catalogComparisons.reduce((sum, row) => sum + row.canonical_total, 0);
    const canonicalHealthy = catalogReadErrors === 0
      && catalogMismatchCount === 0
      && canonicalLegacyTotal === canonicalReadTotal;

    const next: Check[] = [
      {
        key: 'database',
        ar: 'قاعدة البيانات',
        en: 'Database',
        status: snapshot.database_ok ? 'ok' : 'error',
        detail: snapshot.database_ok ? (ar ? 'الاتصال والفحص المركزي يعملان' : 'Central operational check is reachable') : (ar ? 'فشل الفحص المركزي' : 'Central check failed'),
      },
      {
        key: 'canonical_catalog',
        ar: 'تطابق كتالوج V2 مع البيانات الحالية',
        en: 'V2 canonical catalog reconciliation',
        status: canonicalHealthy ? 'ok' : 'error',
        detail: catalogReadErrors > 0
          ? (ar ? 'تعذر تنفيذ مقارنة القراءة المزدوجة' : 'Dual-read comparison failed')
          : (canonicalHealthy
            ? (ar
              ? `متطابق: ${canonicalReadTotal} سجل بدون اختلافات`
              : `Matched: ${canonicalReadTotal} rows with no differences`)
            : (ar
              ? `اختلافات: ${catalogMismatchCount} — الحالي ${canonicalLegacyTotal} / V2 ${canonicalReadTotal}`
              : `Differences: ${catalogMismatchCount} — legacy ${canonicalLegacyTotal} / V2 ${canonicalReadTotal}`)),
        count: catalogMismatchCount + catalogReadErrors,
      },
      {
        key: 'active_shifts',
        ar: 'الورديات المفتوحة',
        en: 'Open shifts',
        status: 'ok',
        detail: ar ? 'عدد الورديات المفتوحة حاليًا' : 'Currently open shifts',
        count: n(snapshot.active_shifts),
      },
      {
        key: 'open_orders',
        ar: 'الطلبات المفتوحة',
        en: 'Open orders',
        status: 'ok',
        detail: ar ? 'طلبات open / held الفعلية' : 'Current open / held orders',
        count: n(snapshot.open_orders),
      },
      zeroCheck('duplicate_shifts', 'أكثر من وردية مفتوحة للفرع', 'Duplicate open shifts', snapshot.duplicate_open_shift_branches),
      zeroCheck('stale_empty_orders', 'طلبات فارغة عالقة', 'Stale empty orders', snapshot.stale_empty_open_orders, 'warning'),
      zeroCheck('vacant_with_orders', 'طاولات متاحة عليها طلب فعلي', 'Vacant tables with live orders', snapshot.vacant_tables_with_effective_orders),
      zeroCheck('occupied_without_orders', 'طاولات مشغولة بدون طلب فعلي', 'Occupied tables without live orders', snapshot.occupied_tables_without_effective_orders, 'warning'),
      zeroCheck('unbalanced_journal', 'قيود محاسبية غير متوازنة', 'Unbalanced journal entries', snapshot.unbalanced_journal_entries),
      zeroCheck('payment_mismatch', 'اختلاف تفاصيل المدفوعات', 'Sale payment mismatches', snapshot.sale_payment_detail_mismatch),
      zeroCheck('refund_integrity', 'مخالفات سلامة المرتجعات', 'Refund integrity violations', snapshot.sale_item_refund_integrity_violations),
      zeroCheck('kitchen_inventory', 'اختلاف إرسال المطبخ والمخزون', 'Kitchen / inventory mismatch', snapshot.live_kitchen_inventory_mismatch),
      zeroCheck('stale_print', 'وظائف طباعة عالقة أكثر من 10 دقائق', 'Stale print jobs over 10 minutes', snapshot.stale_active_print_jobs),
      {
        key: 'print_active',
        ar: 'طابور الطباعة النشط',
        en: 'Active print queue',
        status: 'ok',
        detail: ar ? 'قراءة فقط؛ لا يتم تعديل وكيل الطباعة' : 'Read-only; Print Agent is not modified',
        count: n(snapshot.active_print_jobs),
      },
      {
        key: 'work_auth',
        ar: 'طلبات تصريح العمل المنتظرة',
        en: 'Pending work authorizations',
        status: n(snapshot.pending_work_authorizations) > 0 ? 'warning' : 'ok',
        detail: ar ? 'الطلبات المعلقة حاليًا' : 'Currently pending requests',
        count: n(snapshot.pending_work_authorizations),
      },
      {
        key: 'offline_retrying',
        ar: 'عمليات Offline تنتظر المزامنة',
        en: 'Offline items awaiting sync',
        status: retryingOffline > 0 ? 'warning' : 'ok',
        detail: ar ? 'محلية على هذا الجهاز فقط' : 'Local to this device only',
        count: retryingOffline,
      },
      {
        key: 'offline_blocked',
        ar: 'عمليات Offline تحتاج تدخل',
        en: 'Offline items needing review',
        status: blockedOffline > 0 ? 'error' : 'ok',
        detail: ar ? 'عمليات فاشلة تحتاج مراجعة على هذا الجهاز' : 'Failed offline items needing review on this device',
        count: blockedOffline,
      },
      {
        key: 'day_close',
        ar: 'آخر إغلاق يوم',
        en: 'Latest day close',
        status: snapshot.latest_daily_close_at ? 'ok' : 'warning',
        detail: snapshot.latest_daily_close_at
          ? new Date(snapshot.latest_daily_close_at).toLocaleString()
          : (ar ? 'لا يوجد إغلاق يوم ضمن النطاق' : 'No day close found in scope'),
      },
    ];

    setChecks(next);
    setFinishedAt(new Date(snapshot.generated_at || Date.now()).toLocaleString());
    setRunning(false);
  }, [ar, branchFilter, branchScope.scopeKey, branchScope.selectedBranchIds]);

  useEffect(() => { void runChecks(); }, [runChecks]);

  const summary = useMemo(() => ({
    ok: checks.filter((c) => c.status === 'ok').length,
    warnings: checks.filter((c) => c.status === 'warning').length,
    errors: checks.filter((c) => c.status === 'error').length,
  }), [checks]);

  return (
    <div className="space-y-5 pb-10">
      <div className="rounded-3xl bg-gradient-to-br from-slate-950 via-navy-900 to-slate-800 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-ui-success"><ShieldCheck className="h-4 w-4" />System Health</div>
            <h1 className="text-3xl font-bold">{ar ? 'فحص سلامة التشغيل' : 'Operational System Health'}</h1>
            <p className="mt-2 max-w-3xl text-sm text-ui-muted">
              {ar ? 'فحص قراءة فقط لدورة التشغيل الفعلية: الورديات والطلبات والطاولات والمحاسبة والمخزون والطباعة والمزامنة.' : 'Read-only operational checks across shifts, orders, tables, accounting, inventory, printing and offline sync.'}
            </p>
          </div>
          <Button onClick={() => void runChecks()} disabled={running}><RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />{ar ? 'إعادة الفحص' : 'Run again'}</Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5"><div className="text-sm text-ui-subtle">{ar ? 'سليم' : 'Healthy'}</div><div className="mt-1 text-3xl font-bold text-ui-success">{summary.ok}</div></Card>
        <Card className="p-5"><div className="text-sm text-ui-subtle">{ar ? 'تحذيرات' : 'Warnings'}</div><div className="mt-1 text-3xl font-bold text-ui-warning">{summary.warnings}</div></Card>
        <Card className="p-5"><div className="text-sm text-ui-subtle">{ar ? 'أخطاء' : 'Errors'}</div><div className="mt-1 text-3xl font-bold text-ui-danger">{summary.errors}</div></Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-ui-border p-5 dark:border-navy-800"><Database className="h-5 w-5 text-brand-600" /><div><h2 className="font-bold">{ar ? 'فحوص التشغيل' : 'Operational checks'}</h2><p className="text-xs text-ui-subtle">{finishedAt ? `${ar ? 'آخر فحص' : 'Last check'}: ${finishedAt}` : ''}</p></div></div>
        <div className="divide-y divide-slate-100 dark:divide-navy-800">
          {checks.map((check) => (
            <div key={check.key} className="flex items-center gap-4 p-4">
              {icon(check.status)}
              <div className="min-w-0 flex-1"><div className="font-semibold">{ar ? check.ar : check.en}</div><div className="truncate text-xs text-ui-subtle">{check.detail}</div></div>
              {typeof check.count === 'number' && <div className="rounded-lg bg-ui-page-alt px-3 py-1 text-sm font-semibold dark:bg-navy-800">{formatNumber(check.count, 0)}</div>}
            </div>
          ))}
        </div>
      </Card>

      <AdminDataManagementPanel />

      <Card className="p-5"><div className="flex items-start gap-3"><Activity className="mt-0.5 h-5 w-5 text-brand-600" /><div><h3 className="font-bold">{ar ? 'ملاحظة' : 'Note'}</h3><p className="mt-1 text-sm text-ui-subtle">{ar ? 'الفحص قراءة فقط. لا يغير الطباعة أو KDS أو الشفتات أو المخزون أو القيود المحاسبية.' : 'This health check is read-only. It does not mutate printing, KDS, shifts, inventory, or accounting.'}</p></div></div></Card>
    </div>
  );
}
