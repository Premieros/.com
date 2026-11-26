import { WorkspaceScrollRow } from '@/components/WorkspaceToolbar';
import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, ChefHat, CheckCircle2, UtensilsCrossed, Volume2, VolumeX, AlertTriangle, User } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { isAuthSessionError } from '@/lib/authSessionError';
import { userFacingErrorMessage } from '@/lib/userFacingError';
import { DesignSurface, DesignPageHeader } from '@/components/design/DesignSurface';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import { supabase } from '@/api';
import { catalog } from '@/api/domains/catalog';
import { subscribePosRealtime } from '@/features/pos/services/posRealtime';
import type { KitchenQueueItem, KitchenStation } from '@/lib/types';
import { KitchenCompletedHistory } from '../components/KitchenCompletedHistory';
import { useQrNotificationTone } from '@/features/qr/useQrNotificationTone';
import { hasGenuinelyNewKitchenSend, kitchenSentLineKeys, type KitchenTransferNotice } from '../utils/kitchenSendNotice';

function elapsedColor(seconds: number): string {
  if (seconds > 600) return 'text-ui-danger font-bold';
  if (seconds > 300) return 'text-ui-warning font-semibold';
  return 'text-ui-success';
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function statusBadge(s: string, ar: boolean) {
  if (s === 'cooking') return <span className="rounded-full bg-ui-warning-soft px-2 py-0.5 text-xs font-bold text-ui-warning">{ar ? 'جاري التحضير' : 'Cooking'}</span>;
  if (s === 'ready') return <span className="rounded-full bg-ui-success-soft px-2 py-0.5 text-xs font-bold text-ui-success">{ar ? 'جاهز' : 'Ready'}</span>;
  return <span className="rounded-full bg-ui-info-soft px-2 py-0.5 text-xs font-bold text-ui-info">{ar ? 'جديد' : 'New'}</span>;
}

function modifierText(value: unknown, ar: boolean): string {
  if (!value) return '';
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return typeof value === 'string' ? value : '';
    return parsed
      .map((m: { option_name?: string; option_name_en?: string | null }) => ar ? (m.option_name || m.option_name_en || '') : (m.option_name_en || m.option_name || ''))
      .filter(Boolean)
      .join(' · ');
  } catch {
    return typeof value === 'string' ? value : '';
  }
}

export function KitchenDisplayPage() {
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const can = useCan();
  const canViewKds = Boolean(user) && can('pos.kds_view');
  const canUpdateKds = canViewKds && can('pos.kds_update');
  const accessScope = JSON.stringify([user?.id, branchFilter, canViewKds, canUpdateKds]);

  return (
    <KitchenDisplay
      key={accessScope}
      branchFilter={branchFilter}
      canViewKds={canViewKds}
      canUpdateKds={canUpdateKds}
    />
  );
}

function KitchenDisplay({ branchFilter, canViewKds, canUpdateKds }: {
  branchFilter: string | null;
  canViewKds: boolean;
  canUpdateKds: boolean;
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [station, setStation] = useState('');
  const [view, setView] = useState<'active' | 'completed'>('active');
  const [items, setItems] = useState<KitchenQueueItem[]>([]);
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refreshInterrupted, setRefreshInterrupted] = useState(false);
  const sessionRecovery = useRef<Promise<boolean> | null>(null);
  const loadSequence = useRef(0);
  const queueReads = useRef(new Map<string, { pending: boolean; promise: Promise<void> }>());
  const queueScope = JSON.stringify([branchFilter, station, canViewKds]);
  const currentQueueScope = useRef(queueScope);
  currentQueueScope.current = queueScope;
  useEffect(() => () => { loadSequence.current++; }, []);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [orderContext, setOrderContext] = useState<Record<string, { table_name: string | null; operator_name: string | null }>>({});
  const previousKitchenOrders = useRef<Set<string> | null>(null);
  const previousQueueReadAt = useRef<number | null>(null);
  const [transferNotices, setTransferNotices] = useState<KitchenTransferNotice[]>([]);
  const [noticeError, setNoticeError] = useState(false);
  const [newOrderSignal, setNewOrderSignal] = useState(0);
  const bell = useQrNotificationTone(newOrderSignal, soundEnabled && canViewKds, 'once');
  const statusWritesRef = useRef(new Set<string>());
  const [pendingStatusWrites, setPendingStatusWrites] = useState<ReadonlySet<string>>(new Set());

  const loadStations = useCallback(async () => {
    if (!branchFilter || !canViewKds) {
      setStations([]);
      setStation('');
      return;
    }
    try {
      const { data, error } = await supabase.rpc('get_my_kitchen_stations', { p_branch_id: branchFilter });
      if (error) throw error;
      const allowed = (Array.isArray(data) ? data : []) as KitchenStation[];
      setStations(allowed);
      setStation((current) => current && allowed.some((s) => s.code === current) ? current : '');
    } catch (error) {
      setStations([]);
      setLoadError(userFacingErrorMessage(error, ar ? 'ar' : 'en'));
    }
  }, [ar, branchFilter, canViewKds]);

  const loadNotices = useCallback(async () => {
    if (!branchFilter || !canViewKds) {
      setTransferNotices([]);
      setNoticeError(false);
      return;
    }
    try {
      const { data, error } = await supabase.rpc('get_kitchen_transfer_notices', {
        p_branch_id: branchFilter,
        p_station: station || null,
        p_limit: 24,
      });
      if (currentQueueScope.current !== queueScope) return;
      if (error) throw error;
      const result = data as { success?: boolean; rows?: KitchenTransferNotice[] } | null;
      if (!result?.success || !Array.isArray(result.rows)) throw new Error('KDS_TRANSFER_NOTICES_UNAVAILABLE');
      setTransferNotices(result.rows);
      setNoticeError(false);
    } catch {
      // Notices are supplemental; a failure must not disguise the main KDS
      // queue or erase already-sent work.
      if (currentQueueScope.current === queueScope) setNoticeError(true);
    }
  }, [branchFilter, canViewKds, queueScope, station]);

  const readKitchen = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const isCurrent = () => sequence === loadSequence.current && currentQueueScope.current === queueScope;
    const readStartedAt = Date.now();
    setLoading(true);
    try {
      if (!branchFilter || !canViewKds) {
        setItems([]);
        setOrderContext({});
        previousKitchenOrders.current = null;
        previousQueueReadAt.current = null;
        setLoadError(userFacingErrorMessage(!canViewKds ? 'POS_KDS_VIEW_REQUIRED' : 'BRANCH_REQUIRED', ar ? 'ar' : 'en'));
        return;
      }
      // Display refresh is READ-ONLY: elapsed time must never silently mark
      // a real order as served/completed or alter its inventory/payment state.
      // Authorized staff can still use the explicit status controls below.
      const readQueue = () => supabase.rpc('get_kitchen_queue', {
        p_station: station || null,
        p_branch_id: branchFilter,
      });
      let result = await readQueue();
      if (!isCurrent()) return;
      if (isAuthSessionError(result.error)) {
        if (!sessionRecovery.current) {
          sessionRecovery.current = supabase.auth.refreshSession()
            .then(({ data, error }) => !error && Boolean(data.session))
            .catch(() => false)
            .finally(() => { sessionRecovery.current = null; });
        }
        if (await sessionRecovery.current && isCurrent()) result = await readQueue();
      }
      if (!isCurrent()) return;
      if (result.error) throw result.error;
      setRefreshInterrupted(false);
      setLoadError('');
      const data = result.data;
      const newItems = (data ?? []) as KitchenQueueItem[];
      const currentIds = kitchenSentLineKeys(newItems);
      if (hasGenuinelyNewKitchenSend(previousKitchenOrders.current, newItems, previousQueueReadAt.current)) {
        setNewOrderSignal(signal => signal + 1);
      }
      // Sent-at survives reassignment and quantity splitting. A new order ID
      // alone must never cause another cooking bell or printer dispatch.
      previousKitchenOrders.current = currentIds;
      previousQueueReadAt.current = readStartedAt;
      setItems(newItems);
      void loadNotices();

      const orderIds = [...new Set(newItems.map((item) => item.order_id).filter(Boolean))];
      if (orderIds.length === 0) {
        setOrderContext({});
        setLoadError('');
        return;
      }

      const { data: contextRows, error: contextError } = await catalog.getKitchenOrderContext({
        p_order_ids: orderIds,
        p_branch_id: branchFilter,
      });
      if (!isCurrent()) return;
      if (contextError) {
        setOrderContext({});
        // Supplementary metadata must not generate a queue failure.
        return;
      }

      const nextContext: Record<string, { table_name: string | null; operator_name: string | null }> = {};
      for (const row of (contextRows ?? []) as { order_id: string; table_name: string | null; operator_name: string | null }[]) {
        nextContext[row.order_id] = { table_name: row.table_name, operator_name: row.operator_name };
      }
      setOrderContext(nextContext);
      setLoadError('');
    } catch (error) {
      if (!isCurrent()) return;
      if (isAuthSessionError(error) || !navigator.onLine || /fetch|network|timeout/i.test(String((error as Error)?.message ?? error))) {
        setRefreshInterrupted(true);
        setLoadError('');
      } else {
        setRefreshInterrupted(false);
        setLoadError(userFacingErrorMessage(error, ar ? 'ar' : 'en'));
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [ar, branchFilter, station, canViewKds, loadNotices, queueScope]);

  const load = useCallback(() => {
    const current = queueReads.current.get(queueScope);
    if (current) {
      current.pending = true;
      return current.promise;
    }
    const read = { pending: false, promise: Promise.resolve() };
    read.promise = Promise.resolve().then(async () => {
      do {
        read.pending = false;
        if (currentQueueScope.current !== queueScope) break;
        await readKitchen();
      } while (read.pending);
    }).finally(() => { queueReads.current.delete(queueScope); });
    queueReads.current.set(queueScope, read);
    return read.promise;
  }, [queueScope, readKitchen]);

  useEffect(() => {
    previousKitchenOrders.current = null;
    previousQueueReadAt.current = null;
    setTransferNotices([]);
  }, [branchFilter, station]);

  useEffect(() => { void loadStations(); }, [loadStations]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!branchFilter || !canViewKds) return;
    const unsubscribe = subscribePosRealtime({ branchId: branchFilter, onEvent: () => { void load(); }, debounceMs: 100 });
    return unsubscribe;
  }, [branchFilter, canViewKds, load]);

  useEffect(() => {
    if (!branchFilter || !canViewKds) return;
    const refresh = () => { void load(); };
    const id = setInterval(refresh, refreshInterrupted ? 5000 : 30000);
    window.addEventListener('online', refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', refresh);
    };
  }, [branchFilter, canViewKds, load, refreshInterrupted]);

  const handleKitchenStatus = async (orderId: string, status: string) => {
    if (!canUpdateKds) {
      setLoadError(userFacingErrorMessage('POS_KDS_UPDATE_REQUIRED', ar ? 'ar' : 'en'));
      return;
    }
    // Prevent duplicate clicks while a status mutation is pending. A read
    // refresh (realtime or timer) cannot change the server's kitchen state.
    if (statusWritesRef.current.has(orderId)) return;
    statusWritesRef.current.add(orderId);
    setPendingStatusWrites(new Set(statusWritesRef.current));
    try {
      await catalog.setKitchenStatus(orderId, status);
      setLoadError('');
      void load();
    } catch (error) {
      setLoadError(userFacingErrorMessage(error, ar ? 'ar' : 'en'));
    } finally {
      statusWritesRef.current.delete(orderId);
      setPendingStatusWrites(new Set(statusWritesRef.current));
    }
  };

  const stationName = (v: string) => {
    const s = stations.find(st => st.code === v);
    if (s) return ar ? s.name_ar : s.name_en;
    return v;
  };

  return (
    <DesignSurface testId="kitchen-display">
      <DesignPageHeader title={ar ? 'شاشة المطبخ' : 'Kitchen Display'} subtitle={ar ? 'الطلبات النشطة حسب المحطات المسموح بها للمستخدم' : 'Active orders for the stations assigned to this user'} actions={<>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Select value={station} onChange={e => setStation(e.target.value)} className="min-w-0 flex-1 sm:w-44 sm:flex-none" disabled={!canViewKds}>
            <option value="">{ar ? 'كل المحطات المسموح بها' : 'All Allowed Stations'}</option>
            {stations.filter(s => s.is_active).map(s => <option key={s.code} value={s.code}>{ar ? s.name_ar : s.name_en}</option>)}
          </Select>
          <Button onClick={() => void load()} variant="outline" disabled={!canViewKds}><RefreshCw className="h-4 w-4" /> {ar ? 'تحديث' : 'Refresh'}</Button>
          <button onClick={() => { setSoundEnabled(value => !value); if (!bell.ready && !soundEnabled) void bell.unlock(); }} className="rounded-lg p-2 text-ui-muted hover:bg-ui-muted/10 transition" title={soundEnabled ? (ar ? 'كتم الصوت' : 'Mute') : (ar ? 'تشغيل الصوت' : 'Unmute')}>
            {soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>
          {soundEnabled && !bell.ready && <button type="button" className="rounded-lg border border-ui-border px-3 py-1 text-xs" onClick={() => void bell.unlock()}>{ar ? 'تفعيل جرس المطبخ' : 'Enable kitchen bell'}</button>}
          <span className="whitespace-nowrap text-xs text-ui-muted sm:w-auto sm:text-sm"><span className="me-1 inline-block h-2 w-2 rounded-full bg-ui-success animate-pulse" />{items.length} {ar ? 'طلب/محطة نشطة' : 'active order/station cards'}</span>
        </div>

        <div role="tablist" aria-label={ar ? 'عرض طلبات المطبخ' : 'Kitchen order views'} className="flex shrink-0 gap-2">
          <button
            role="tab"
            aria-selected={view === 'active'}
            onClick={() => setView('active')}
            className="rounded-lg border border-ui-border px-4 py-2 text-sm font-black aria-selected:bg-ui-primary aria-selected:text-white"
          >
            {ar ? 'نشطة' : 'Active'} ({items.length})
          </button>
          <button
            role="tab"
            aria-selected={view === 'completed'}
            onClick={() => setView('completed')}
            className="rounded-lg border border-ui-border px-4 py-2 text-sm font-black aria-selected:bg-ui-primary aria-selected:text-white"
          >
            {ar ? 'مكتمل' : 'Completed'}
          </button>
        </div>

      </>} />
      <div className="space-y-4">
        {view === 'active' && canViewKds && transferNotices.length > 0 && (
          <section data-testid="kds-transfer-notices" className="rounded-xl border border-ui-info/30 bg-ui-info-soft p-3">
            <h3 className="mb-2 text-xs font-black text-ui-text">
              {ar ? 'تغييرات الطاولات والحسابات — لا تحتاج إعادة تحضير' : 'Table / bill changes — no new cooking needed'}
            </h3>
            <ul className="space-y-1">
              {transferNotices.slice(0,8).map(notice => (
                <li key={`${notice.event_id}:${notice.product_name}:${notice.station}`}
                    className="text-xs font-semibold text-ui-text">
                  {ar
                    ? `${notice.product_name} ×${notice.quantity}: ${notice.split_bill ? 'فصل حساب' : 'نقل'} من ${notice.source_table || '—'} إلى ${notice.target_table || '—'} (${notice.target_order_number || '—'})`
                    : `${notice.product_name} ×${notice.quantity}: ${notice.split_bill ? 'separate bill' : 'moved'} from ${notice.source_table || '—'} to ${notice.target_table || '—'} (${notice.target_order_number || '—'})`}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-ui-subtle">
              {ar ? 'تغيير مكان التقديم أو الحساب لا ينشئ تذكرة طبخ جديدة.' : 'Changing seating or bill ownership does not create a new kitchen ticket.'}
            </p>
          </section>
        )}
        {view === 'active' && noticeError && canViewKds && (
          <p role="status" className="text-xs text-ui-warning">
            {ar ? 'تعذر تحديث إشعارات النقل؛ الطلبات الأصلية ما زالت ظاهرة.' : 'Transfer notices could not refresh; original kitchen tickets remain visible.'}
          </p>
        )}

        {view === 'completed' && branchFilter && canViewKds && (
          <KitchenCompletedHistory key={`${branchFilter}:${station}`} branchId={branchFilter} station={station} ar={ar} />
        )}

        {refreshInterrupted && (
          <p role="status" className="text-xs text-ui-muted">
            {ar ? 'توقف التحديث مؤقتًا، جارٍ إعادة الاتصال تلقائيًا…' : 'Updates paused. Reconnecting automatically…'}
          </p>
        )}
        {loadError && (
          <div data-testid="kds-load-error" className="flex flex-col gap-3 rounded-2xl border border-ui-danger/30 bg-ui-danger/10 p-4 text-ui-danger sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0">
                <p className="font-bold">{ar ? 'تعذر تحديث شاشة المطبخ' : 'Kitchen display could not refresh'}</p>
                <p className="break-words text-xs opacity-80">{loadError}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={!canViewKds || loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> {ar ? 'إعادة المحاولة' : 'Retry'}
            </Button>
          </div>
        )}

        {loading && !items.length && !loadError && !refreshInterrupted && <div role="status" aria-label={ar ? 'جارٍ تحميل طلبات المطبخ' : 'Loading kitchen orders'} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => <div key={index} aria-hidden="true" className="h-32 motion-safe:animate-pulse rounded-2xl border border-ui-border bg-ui-surface p-4">
            <div className="mb-4 h-4 w-1/2 rounded bg-ui-page-alt" /><div className="h-3 w-3/4 rounded bg-ui-page-alt" />
          </div>)}
        </div>}

        {view === 'active' && items.length > 0 && <WorkspaceScrollRow className="workspace-kitchen-cards">
          {items.map(item => {
            const context = orderContext[item.order_id];
            const tableLabel = context?.table_name || (item.table_number ? `Table ${String(item.table_number).padStart(2, '0')}` : null);
            return (
            <div key={`${item.order_id}-${item.station}`} className={`rounded-2xl border bg-ui-surface p-3 sm:p-4 shadow-ui-sm transition-all ${item.kitchen_status === 'cooking' ? 'border-ui-warning/40 ring-1 ring-ui-warning' : item.kitchen_status === 'ready' ? 'border-ui-success/40 ring-1 ring-ui-success' : 'border-ui-border'}`}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="font-bold text-ui-text text-base sm:text-lg">#{item.order_number}</span>
                <div className="flex items-center gap-1.5">{statusBadge(item.kitchen_status, ar)}<span className={`text-xs sm:text-sm ${elapsedColor(item.elapsed_seconds)}`}>{formatElapsed(item.elapsed_seconds)}</span>{item.elapsed_seconds >= 2400 && <span data-testid="kds-overdue" className="rounded-full bg-ui-warning-soft px-2 py-0.5 text-[11px] font-bold text-ui-warning">{ar ? 'متأخر' : 'Overdue'}</span>}</div>
              </div>
              <div className="flex items-center gap-2 mb-3 text-xs sm:text-sm text-ui-muted flex-wrap">
                <span className="rounded bg-ui-primary-soft px-2 py-0.5 text-ui-primary font-semibold">{stationName(item.station)}</span>
                {tableLabel && (
                  <span data-testid="kds-table-name" className="inline-flex items-center gap-1 font-black text-ui-text">
                    <UtensilsCrossed className="h-3.5 w-3.5" />
                    {ar ? 'الطاولة:' : 'Table:'} {tableLabel}
                  </span>
                )}
                {context?.operator_name && (
                  <span data-testid="kds-operator-name" className="inline-flex items-center gap-1 font-black text-ui-text">
                    <User className="h-3.5 w-3.5" />
                    {ar ? 'المستخدم:' : 'User:'} {context.operator_name}
                  </span>
                )}
                {item.guest_count && <span>{ar ? 'ضيوف' : 'G'}: {item.guest_count}</span>}
              </div>
              <ul className="space-y-1.5 mb-3">
                {item.items.map((it, idx) => {
                  const mods = modifierText(it.modifiers, ar);
                  return (
                    <li key={idx} className="rounded-lg bg-ui-page-alt px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 break-words text-ui-text font-bold">{it.product_name}</span>
                        <span className="shrink-0 text-ui-muted font-bold text-base">×{it.quantity}</span>
                      </div>
                      {mods && <div data-testid="kds-item-modifiers" className="mt-1 break-words text-[11px] font-semibold text-ui-primary sm:text-xs">{mods}</div>}
                      {it.notes && <div data-testid="kds-item-note" className="mt-1 break-words text-[11px] font-bold text-ui-danger sm:text-xs">{ar ? 'ملاحظة' : 'Note'}: {it.notes}</div>}
                    </li>
                  );
                })}
              </ul>
              {item.notes && <div className="text-xs text-ui-muted italic border-t border-ui-border pt-2 mb-3 break-words">{item.notes}</div>}

              {canUpdateKds && <div className="flex gap-2 border-t border-ui-border pt-3">
                {item.kitchen_status === 'sent' && <button disabled={pendingStatusWrites.has(item.order_id)} onClick={() => void handleKitchenStatus(item.order_id, 'cooking')} className="flex-1 flex items-center justify-center gap-2 rounded-xl disabled:opacity-50 bg-ui-warning text-white py-2.5 px-3 text-sm font-bold active:scale-95 transition-all min-h-11"><ChefHat className="h-5 w-5" /> {ar ? 'بدء التحضير' : 'Start Cooking'}</button>}
                {item.kitchen_status === 'cooking' && <button disabled={pendingStatusWrites.has(item.order_id)} onClick={() => void handleKitchenStatus(item.order_id, 'ready')} className="flex-1 flex items-center justify-center gap-2 rounded-xl disabled:opacity-50 bg-ui-success text-white py-2.5 px-3 text-sm font-bold active:scale-95 transition-all min-h-11"><CheckCircle2 className="h-5 w-5" /> {ar ? 'جاهز للتقديم' : 'Mark Ready'}</button>}
                {item.kitchen_status === 'ready' && <button disabled={pendingStatusWrites.has(item.order_id)} onClick={() => void handleKitchenStatus(item.order_id, 'served')} className="flex-1 flex items-center justify-center gap-2 rounded-xl disabled:opacity-50 bg-ui-info text-white py-2.5 px-3 text-sm font-bold active:scale-95 transition-all min-h-11"><UtensilsCrossed className="h-5 w-5" /> {ar ? 'مكتمل' : 'Completed'}</button>}
              </div>}
            </div>
            );
          })}
        </WorkspaceScrollRow>}

        {view === 'active' && !loading && !items.length && !loadError && !refreshInterrupted && <div className="text-center py-16 text-ui-muted"><ChefHat className="h-12 w-12 mx-auto mb-3 opacity-30" /><div className="text-lg">{ar ? 'لا توجد طلبات نشطة ضمن المحطات المسموح بها' : 'No active orders in your allowed stations'}</div></div>}
      </div>
    </DesignSurface>
  );
}
