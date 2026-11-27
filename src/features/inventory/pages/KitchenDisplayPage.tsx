import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, ChefHat, CheckCircle2, UtensilsCrossed, Volume2, VolumeX, AlertTriangle, User, Utensils, ShoppingBag, Truck, Car, Clock, Sparkles } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { userFacingErrorMessage } from '@/lib/userFacingError';
import { DesignSurface, DesignPageHeader } from '@/components/design/DesignSurface';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import { supabase } from '@/api';
import { catalog } from '@/api/domains/catalog';
import { subscribePosRealtime } from '@/features/pos/services/posRealtime';
import type { KitchenQueueItem, KitchenStation } from '@/lib/types';
import { KitchenCompletedHistory } from '../components/KitchenCompletedHistory';

function elapsedColor(seconds: number): string {
  if (seconds > 600) return 'text-ui-danger font-black bg-ui-danger-soft/40 border-ui-danger/40';
  if (seconds > 300) return 'text-ui-warning font-bold bg-ui-warning-soft/40 border-ui-warning/40';
  return 'text-ui-success font-semibold bg-ui-success-soft/30 border-ui-success/30';
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function statusBadge(s: string, ar: boolean) {
  if (s === 'cooking') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-xs font-black text-amber-600 dark:text-amber-400">
        <ChefHat className="h-3.5 w-3.5" />
        {ar ? 'جاري التحضير' : 'Cooking'}
      </span>
    );
  }
  if (s === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-black text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {ar ? 'جاهز للتسليم' : 'Ready'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/15 px-2.5 py-0.5 text-xs font-black text-blue-600 dark:text-blue-400">
      <Clock className="h-3.5 w-3.5" />
      {ar ? 'جديد / بالانتظار' : 'New / Waiting'}
    </span>
  );
}

function orderTypeBadge(type: string | undefined | null, ar: boolean) {
  if (!type) return null;
  if (type === 'delivery') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/15 px-2 py-0.5 text-xs font-black text-sky-600 dark:text-sky-400">
        <Truck className="h-3.5 w-3.5" />
        {ar ? 'توصيل' : 'Delivery'}
      </span>
    );
  }
  if (type === 'drive_thru') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-purple-500/30 bg-purple-500/15 px-2 py-0.5 text-xs font-black text-purple-600 dark:text-purple-400">
        <Car className="h-3.5 w-3.5" />
        {ar ? 'سيارات' : 'Drive-thru'}
      </span>
    );
  }
  if (type === 'takeaway') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-xs font-black text-amber-600 dark:text-amber-400">
        <ShoppingBag className="h-3.5 w-3.5" />
        {ar ? 'سفري' : 'Takeaway'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-xs font-black text-emerald-600 dark:text-emerald-400">
      <Utensils className="h-3.5 w-3.5" />
      {ar ? 'صالة' : 'Dine-in'}
    </span>
  );
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
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const branchFilter = useBranchFilter();
  const can = useCan();
  const canViewKds = can('pos.kds_view');
  const canUpdateKds = can('pos.kds_update');
  const [station, setStation] = useState('');
  const [view, setView] = useState<'active' | 'completed'>('active');
  const [items, setItems] = useState<KitchenQueueItem[]>([]);
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [orderContext, setOrderContext] = useState<Record<string, { table_name: string | null; operator_name: string | null; order_type?: string | null }>>({});
  const prevCountRef = useRef(0);
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
  }, [branchFilter, canViewKds]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!branchFilter || !canViewKds) {
        setItems([]);
        setOrderContext({});
        prevCountRef.current = 0;
        setLoadError(userFacingErrorMessage(!canViewKds ? 'POS_KDS_VIEW_REQUIRED' : 'BRANCH_REQUIRED', ar ? 'ar' : 'en'));
        return;
      }
      // Display refresh is READ-ONLY: elapsed time must never silently mark
      // a real order as served/completed or alter its inventory/payment state.
      // Authorized staff can still use the explicit status controls below.
      const { data, error } = await supabase.rpc('get_kitchen_queue', {
        p_station: station || null,
        p_branch_id: branchFilter,
      });
      if (error) throw error;
      const newItems = (data ?? []) as KitchenQueueItem[];
      if (soundEnabled && prevCountRef.current > 0 && newItems.length > prevCountRef.current) playBeep();
      prevCountRef.current = newItems.length;
      setItems(newItems);

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
      if (contextError) {
        setOrderContext({});
        setLoadError(userFacingErrorMessage(contextError, ar ? 'ar' : 'en'));
        return;
      }

      const nextContext: Record<string, { table_name: string | null; operator_name: string | null; order_type?: string | null }> = {};
      for (const row of (contextRows ?? []) as { order_id: string; table_name: string | null; operator_name: string | null }[]) {
        nextContext[row.order_id] = { table_name: row.table_name, operator_name: row.operator_name };
      }
      try {
        const { data: oRows } = await supabase.from('orders').select('id, order_type').in('id', orderIds);
        for (const o of (oRows || []) as { id: string; order_type: string }[]) {
          if (nextContext[o.id]) nextContext[o.id].order_type = o.order_type;
          else nextContext[o.id] = { table_name: null, operator_name: null, order_type: o.order_type };
        }
      } catch {}
      setOrderContext(nextContext);
      setLoadError('');
    } catch (error) {
      // Never turn a KDS transport/permission failure into a fake empty queue.
      // Keep the last known cards visible and surface the error so staff can retry.
      setLoadError(userFacingErrorMessage(error, ar ? 'ar' : 'en'));
    } finally {
      setLoading(false);
    }
  }, [branchFilter, station, soundEnabled, canViewKds]);

  const playBeep = () => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      gain.gain.value = 0.3;
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch { /* browser may block audio before user interaction */ }
  };

  useEffect(() => { void loadStations(); }, [loadStations]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!branchFilter || !canViewKds) return;
    const unsubscribe = subscribePosRealtime({ branchId: branchFilter, onEvent: () => { void load(); }, debounceMs: 500 });
    return unsubscribe;
  }, [branchFilter, canViewKds, load]);

  useEffect(() => {
    const id = setInterval(() => { void load(); }, 30000);
    return () => clearInterval(id);
  }, [load]);

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
      <DesignPageHeader title={ar ? 'شاشة المطبخ' : 'Kitchen Display'} subtitle={ar ? 'الطلبات النشطة حسب المحطات المسموح بها للمستخدم' : 'Active orders for the stations assigned to this user'} />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Select value={station} onChange={e => setStation(e.target.value)} className="min-w-0 flex-1 sm:w-44 sm:flex-none" disabled={!canViewKds}>
            <option value="">{ar ? 'كل المحطات المسموح بها' : 'All Allowed Stations'}</option>
            {stations.filter(s => s.is_active).map(s => <option key={s.code} value={s.code}>{ar ? s.name_ar : s.name_en}</option>)}
          </Select>
          <Button onClick={() => void load()} variant="outline" disabled={!canViewKds}><RefreshCw className="h-4 w-4" /> {ar ? 'تحديث' : 'Refresh'}</Button>
          <button onClick={() => setSoundEnabled(!soundEnabled)} className="rounded-lg p-2 text-ui-muted hover:bg-ui-muted/10 transition" title={soundEnabled ? (ar ? 'كتم الصوت' : 'Mute') : (ar ? 'تشغيل الصوت' : 'Unmute')}>
            {soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>
          <span className="w-full text-xs text-ui-muted sm:w-auto sm:text-sm"><span className="me-1 inline-block h-2 w-2 rounded-full bg-ui-success animate-pulse" />{items.length} {ar ? 'طلب/محطة نشطة' : 'active order/station cards'}</span>
        </div>

        <div role="tablist" aria-label={ar ? 'عرض طلبات المطبخ' : 'Kitchen order views'} className="flex flex-wrap gap-2">
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

        {view === 'active' && (
          <p className="text-xs font-medium text-ui-muted">
            {ar
              ? 'تظل الطلبات غير المكتملة ظاهرة حتى يتم تحديث حالتها بواسطة مستخدم مخوّل. يتم تمييز الطلبات المتأخرة فقط.'
              : 'Unfinished orders remain visible until an authorized operator updates their status. Overdue orders are highlighted only.'}
          </p>
        )}

        {view === 'completed' && branchFilter && canViewKds && (
          <KitchenCompletedHistory key={`${branchFilter}:${station}`} branchId={branchFilter} station={station} ar={ar} />
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

        {loading && !items.length && !loadError && <div className="text-ui-muted py-8 text-center">{ar ? 'جاري التحميل...' : 'Loading...'}</div>}

        {view === 'active' && <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map(item => {
            const context = orderContext[item.order_id];
            const tableLabel = context?.table_name || (item.table_number ? `Table ${String(item.table_number).padStart(2, '0')}` : null);
            return (
            <div
              key={`${item.order_id}-${item.station}`}
              data-testid={`kds-card-${item.order_id}`}
              className={`rounded-3xl border bg-ui-surface p-4 sm:p-5 shadow-ui-md transition-all flex flex-col justify-between ${
                item.kitchen_status === 'cooking'
                  ? 'border-amber-500/50 ring-2 ring-amber-500/20'
                  : item.kitchen_status === 'ready'
                  ? 'border-emerald-500/50 ring-2 ring-emerald-500/20'
                  : 'border-ui-border'
              }`}
            >
              <div>
                {/* Header: Order Number, Order Type, Elapsed Timer */}
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xl sm:text-2xl font-black text-ui-text tracking-tight">#{item.order_number}</span>
                    {orderTypeBadge(context?.order_type, ar)}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-xs sm:text-sm px-2.5 py-1 rounded-xl border ${elapsedColor(item.elapsed_seconds)}`}>
                      ⏱️ {formatElapsed(item.elapsed_seconds)}
                    </span>
                    {item.elapsed_seconds >= 2400 && (
                      <span data-testid="kds-overdue" className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-2 py-1 text-[11px] font-black text-rose-600 dark:text-rose-400">
                        {ar ? '⚠️ متأخر' : '⚠️ Overdue'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Subheader: Station, Table, Operator, Guests, and Status Text */}
                <div className="flex items-center gap-1.5 mb-3.5 text-xs text-ui-muted flex-wrap">
                  <span className="rounded-xl bg-ui-primary-soft px-2.5 py-1 text-ui-accent font-black border border-ui-primary/20">
                    📍 {stationName(item.station)}
                  </span>
                  {statusBadge(item.kitchen_status, ar)}
                  {tableLabel && (
                    <span data-testid="kds-table-name" className="inline-flex items-center gap-1 rounded-xl bg-ui-page-alt px-2.5 py-1 font-black text-ui-text border border-ui-border">
                      <UtensilsCrossed className="h-3.5 w-3.5 text-ui-success" />
                      {ar ? 'طاولة:' : 'Table:'} {tableLabel}
                    </span>
                  )}
                  {context?.operator_name && (
                    <span data-testid="kds-operator-name" className="inline-flex items-center gap-1 font-bold text-ui-muted">
                      <User className="h-3 w-3" />
                      {context.operator_name}
                    </span>
                  )}
                  {item.guest_count && <span className="font-bold">👥 {item.guest_count}</span>}
                </div>

                {/* Item List with prominent quantity next to name and modifiers directly beneath */}
                <ul className="space-y-2 mb-3.5">
                  {item.items.map((it, idx) => {
                    const mods = modifierText(it.modifiers, ar);
                    const isLateAddition = (it as any).is_late_addition || (it as any).is_amended;
                    return (
                      <li key={idx} className="rounded-xl border border-ui-border bg-ui-page-alt/70 p-2.5">
                        <div className="flex items-start gap-2.5">
                          <span className="inline-flex items-center justify-center min-w-8 h-8 rounded-xl bg-ui-primary text-ui-primary-fg font-black text-sm px-2 shrink-0 shadow-xs">
                            ×{it.quantity}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-black text-ui-text break-words">{it.product_name}</span>
                              {isLateAddition && (
                                <span className="rounded-md bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.5 text-[10px] font-black text-amber-600 dark:text-amber-400">
                                  ⚡ {ar ? 'جديد / مُعدل' : 'New / Modified'}
                                </span>
                              )}
                            </div>
                            {mods && (
                              <div data-testid="kds-item-modifiers" className="mt-1 text-xs font-bold text-ui-accent break-words">
                                ✦ {mods}
                              </div>
                            )}
                            {it.notes && (
                              <div data-testid="kds-item-note" className="mt-1 rounded-md bg-rose-500/10 border border-rose-500/30 p-1 text-xs font-black text-rose-600 dark:text-rose-400 break-words">
                                📝 {ar ? 'ملاحظة' : 'Note'}: {it.notes}
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {item.notes && <div className="text-xs text-ui-muted italic border-t border-ui-border pt-2 mb-3 break-words font-medium">💬 {item.notes}</div>}
              </div>

              {/* Status Action Buttons with clear descriptive transition labels */}
              {canUpdateKds && (
                <div className="flex gap-2 border-t border-ui-border pt-3">
                  {item.kitchen_status === 'sent' && (
                    <button
                      disabled={pendingStatusWrites.has(item.order_id)}
                      onClick={() => void handleKitchenStatus(item.order_id, 'cooking')}
                      className="flex-1 flex items-center justify-center gap-2 rounded-2xl disabled:opacity-50 bg-amber-500 hover:bg-amber-600 text-white py-3 px-3 text-sm font-black active:scale-95 transition-all shadow-ui-sm min-h-12"
                    >
                      <ChefHat className="h-5 w-5" />
                      <span>{ar ? 'بدء التحضير' : 'Start Cooking'}</span>
                    </button>
                  )}
                  {item.kitchen_status === 'cooking' && (
                    <button
                      disabled={pendingStatusWrites.has(item.order_id)}
                      onClick={() => void handleKitchenStatus(item.order_id, 'ready')}
                      className="flex-1 flex items-center justify-center gap-2 rounded-2xl disabled:opacity-50 bg-emerald-600 hover:bg-emerald-700 text-white py-3 px-3 text-sm font-black active:scale-95 transition-all shadow-ui-sm min-h-12"
                    >
                      <CheckCircle2 className="h-5 w-5" />
                      <span>{ar ? 'تسجيل الجاهزية (جاهز)' : 'Mark Ready'}</span>
                    </button>
                  )}
                  {item.kitchen_status === 'ready' && (
                    <button
                      disabled={pendingStatusWrites.has(item.order_id)}
                      onClick={() => void handleKitchenStatus(item.order_id, 'served')}
                      className="flex-1 flex items-center justify-center gap-2 rounded-2xl disabled:opacity-50 bg-ui-accent hover:bg-ui-accent/90 text-ui-primary-fg py-3 px-3 text-sm font-black active:scale-95 transition-all shadow-ui-sm min-h-12"
                    >
                      <UtensilsCrossed className="h-5 w-5" />
                      <span>{ar ? 'اكتمال التحضير / تم التقديم' : 'Completed / Served'}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>}

        {view === 'active' && !loading && !items.length && !loadError && <div className="text-center py-16 text-ui-muted"><ChefHat className="h-12 w-12 mx-auto mb-3 opacity-30" /><div className="text-lg">{ar ? 'لا توجد طلبات نشطة ضمن المحطات المسموح بها' : 'No active orders in your allowed stations'}</div></div>}
      </div>
    </DesignSurface>
  );
}
