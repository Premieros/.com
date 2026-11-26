import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '@/api/rpc';
import { Button } from '@/components/Button';
import { DesignPageHeader, DesignSurface } from '@/components/design';
import { useLanguage } from '@/context/LanguageContext';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';
import { APP_ROUTES, posOrderRoute } from '@/core/navigation/routes';
import { useBranchScope } from '@/lib/branchScope';
import type { KitchenQueueItem } from '@/lib/types';
import { useCan } from '@/lib/permissions';
import { useActiveOrders } from '../hooks/useActiveOrders';
import { orderTypeLabel } from '../utils/format';

type DispatchRow = { id: string; order_number: string; order_status: string; dispatch_status: string; created_at: string };
type Card = { id: string; number: string; created: string; type: string; cashier: string; kitchen?: string; delivery?: string };
const columns = {
  cashier: ['الكاشير', 'Cashier'],
  kitchen: ['المطبخ', 'Kitchen'],
  ready: ['جاهز', 'Ready'],
  delivery: ['التوصيل', 'Delivery'],
} as const;
const labels: Record<string, [string, string]> = {
  open: ['مفتوح', 'Open'], held: ['معلّق', 'Held'], completed: ['مكتمل', 'Completed'],
  pending: ['بانتظار الإرسال', 'Pending'], sent: ['أُرسل', 'Sent'], cooking: ['قيد التحضير', 'Cooking'],
  ready: ['جاهز', 'Ready'], served: ['تم التقديم', 'Served'], cancelled: ['ملغى', 'Cancelled'],
  waiting: ['بانتظار التعيين', 'Awaiting assignment'], assigned: ['تم التعيين', 'Assigned'], on_the_way: ['في الطريق', 'On the way'],
};

export function OrderBoardPage() {
  const { lang } = useLanguage();
  const { selectedBranchIds } = useBranchScope();
  if (selectedBranchIds.length !== 1) return <p role="status">{lang === 'ar' ? 'اختر فرعًا واحدًا لعرض لوحة الطلبات.' : 'Select a single branch to open the order board.'}</p>;
  return <OrderBoard key={selectedBranchIds[0]} branch={selectedBranchIds[0]} />;
}

function OrderBoard({ branch }: { branch: string }) {
  const { lang, t } = useLanguage();
  const ar = lang === 'ar';
  const can = useCan();
  const { canAccessPath } = useOrganizationModules();
  const canKitchen = can('pos.kds_view') && canAccessPath(APP_ROUTES.kitchenDisplay);
  const canDelivery = can('pos.view') && canAccessPath(APP_ROUTES.delivery);
  const canOpenPos = can('pos.view') && canAccessPath(APP_ROUTES.pos);
  const { orders, loading, error } = useActiveOrders(branch);
  const [dispatch, setDispatch] = useState<DispatchRow[]>([]);
  const [kitchenQueue, setKitchenQueue] = useState<KitchenQueueItem[]>([]);
  const [loadingKitchen, setLoadingKitchen] = useState(false);
  const [loadingDispatch, setLoadingDispatch] = useState(false);
  const [kitchenError, setKitchenError] = useState(false);
  const [dispatchError, setDispatchError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!canDelivery) return;
    let active = true;
    setLoadingDispatch(true);
    const load = () => {
      void rpc<{ orders: DispatchRow[] }>('delivery_workspace', { p_branch: branch, p_history: false })
        .then(({ data, error: failure }) => {
          if (!active) return;
          setDispatchError(!!failure);
          setDispatch(data?.orders ?? []);
        })
        .catch(() => { if (active) { setDispatchError(true); setDispatch([]); } })
        .finally(() => { if (active) setLoadingDispatch(false); });
    };
    load();
    return () => { active = false; };
  }, [branch, canDelivery, refresh]);

  useEffect(() => {
    if (!canKitchen) return;
    let active = true;
    setLoadingKitchen(true);
    void rpc<KitchenQueueItem[]>('get_kitchen_queue', { p_station: null, p_branch_id: branch })
      .then(({ data, error: failure }) => {
        if (!active) return;
        setKitchenError(!!failure);
        setKitchenQueue(data ?? []);
      })
      .catch(() => { if (active) { setKitchenError(true); setKitchenQueue([]); } })
      .finally(() => { if (active) setLoadingKitchen(false); });
    return () => { active = false; };
  }, [branch, canKitchen, refresh]);

  const deliveryRows = canDelivery ? dispatch : [];
  const deliveryMap = new Map(deliveryRows.map((row) => [row.id, row]));
  const queue = new Map((canKitchen ? kitchenQueue : []).map((item) => [item.order_id, item]));
  const cards: Card[] = orders.map((order) => ({
    id: order.id, number: order.order_number, created: order.created_at,
    type: orderTypeLabel(t, order.order_type), cashier: order.status,
    kitchen: queue.get(order.id)?.kitchen_status || (canKitchen ? order.kitchen_status : undefined),
    delivery: deliveryMap.get(order.id)?.dispatch_status,
  }));
  const existing = new Set(cards.map((card) => card.id));
  for (const entry of deliveryRows) {
    if (existing.has(entry.id) || entry.order_status !== 'completed' || !['waiting', 'assigned', 'on_the_way'].includes(entry.dispatch_status)) continue;
    cards.push({ id: entry.id, number: entry.order_number, created: entry.created_at, type: ar ? 'توصيل' : 'Delivery', cashier: entry.order_status, delivery: entry.dispatch_status, kitchen: queue.get(entry.id)?.kitchen_status });
    existing.add(entry.id);
  }
  for (const [id, ticket] of queue) {
    if (existing.has(id)) continue;
    cards.push({
      id, number: ticket.order_number, created: ticket.created_at,
      type: ar ? 'تذكرة مطبخ' : 'Kitchen ticket', cashier: '', kitchen: ticket.kitchen_status,
    });
  }
  const buckets: Record<keyof typeof columns, Card[]> = { cashier: [], kitchen: [], ready: [], delivery: [] };
  for (const card of cards) {
    const group = card.delivery && (card.delivery !== 'waiting' || card.cashier === 'completed')
      ? 'delivery' : card.kitchen === 'ready' ? 'ready'
        : card.kitchen === 'sent' || card.kitchen === 'cooking' ? 'kitchen' : 'cashier';
    buckets[group].push(card);
  }
  const loadingBoard = loading || (canDelivery && loadingDispatch) || (canKitchen && loadingKitchen);
  const status = (value: string) => labels[value]?.[ar ? 0 : 1] ?? value;

  return (
    <DesignSurface testId="order-board-page">
      <DesignPageHeader
        title={ar ? 'لوحة متابعة الطلبات' : 'Order board'}
        subtitle={ar ? 'متابعة حالة الطلبات بين الكاشير والمطبخ والتوصيل' : 'Track order stages across cashier, kitchen and delivery'}
        actions={(canDelivery || canKitchen) && (
          <Button size="sm" variant="outline" disabled={loadingBoard} onClick={() => setRefresh((value) => value + 1)}>{ar ? 'تحديث الحالات' : 'Refresh statuses'}</Button>
        )}
      />
      {loadingBoard && <p role="status" className="text-xs text-ui-muted">{ar ? 'جارٍ تحميل الطلبات…' : 'Loading orders…'}</p>}
      {(error || (canDelivery && dispatchError) || (canKitchen && kitchenError)) && <p role="alert" className="mb-2 text-ui-danger">
        {error || (ar ? 'تعذّر تحميل بعض حالات التوصيل أو المطبخ.' : 'Some delivery or kitchen states could not be loaded.')}
      </p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(columns) as Array<keyof typeof columns>).filter((group) =>
          group === 'cashier' || (group === 'delivery' ? canDelivery : canKitchen),
        ).map((group) => {
          const badgeTone = group === 'cashier'
            ? 'bg-ui-info-soft text-ui-info'
            : group === 'kitchen'
              ? 'bg-ui-warning-soft text-ui-warning'
              : group === 'ready'
                ? 'bg-ui-success-soft text-ui-success'
                : 'bg-ui-primary-soft text-ui-primary';
          return (
          <section key={group} className="min-w-0 rounded-[22px] border border-ui-border bg-ui-page-alt p-3.5 shadow-ui-sm">
            <h2 className="mb-3 flex items-center justify-between gap-2 px-1 text-sm font-bold text-ui-text">
              <span>{columns[group][ar ? 0 : 1]}</span>
              <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-bold tabular-nums ${badgeTone}`}>{buckets[group].length}</span>
            </h2>
            <div className="space-y-2.5">
              {buckets[group].length === 0 && !loadingBoard && <p className="rounded-[16px] border border-dashed border-ui-border py-6 text-center text-xs text-ui-muted">{ar ? 'لا توجد طلبات' : 'No orders'}</p>}
              {buckets[group].map((card) => {
                const age = Math.max(0, Math.floor((now - Date.parse(card.created)) / 60000));
                return (
                  <article key={card.id} className="rounded-[16px] border border-ui-border bg-ui-surface p-3.5 shadow-ui-sm transition hover:border-ui-border-strong hover:shadow-ui">
                    <div className="flex flex-wrap items-center justify-between gap-1 font-bold">
                      <span className="text-sm text-ui-text tabular-nums">{card.number}</span>
                      <span className="rounded-full bg-ui-page-alt px-2.5 py-0.5 text-[11px] font-semibold text-ui-muted tabular-nums">{Number.isFinite(age) ? `${age} ${ar ? 'دقيقة' : 'min'}` : '—'}</span>
                    </div>
                    <p className="my-2 text-xs font-medium text-ui-muted">{[card.type, card.cashier && status(card.cashier), card.kitchen && status(card.kitchen), card.delivery && status(card.delivery)].filter(Boolean).join(' · ')}</p>
                    {['open', 'held'].includes(card.cashier) && canOpenPos && <Link to={posOrderRoute(card.id)} state={{ branchId: branch }} className="inline-flex items-center rounded-full bg-ui-primary-soft px-3 py-1 text-xs font-semibold text-ui-primary transition hover:bg-ui-primary hover:text-ui-primary-fg">
                      {ar ? 'فتح الطلب' : 'Open order'}
                    </Link>}
                    {card.cashier === 'completed' && card.delivery && canDelivery && <Link to={`${APP_ROUTES.delivery}?record=${card.id}`} className="inline-flex items-center rounded-full bg-ui-primary-soft px-3 py-1 text-xs font-semibold text-ui-primary transition hover:bg-ui-primary hover:text-ui-primary-fg">
                      {ar ? 'فتح التوصيل' : 'Open delivery'}
                    </Link>}
                    {!card.cashier && canKitchen && <Link to={APP_ROUTES.kitchenDisplay} className="inline-flex items-center rounded-full bg-ui-primary-soft px-3 py-1 text-xs font-semibold text-ui-primary transition hover:bg-ui-primary hover:text-ui-primary-fg">
                      {ar ? 'فتح المطبخ' : 'Open kitchen'}
                    </Link>}
                  </article>
                );
              })}
            </div>
          </section>
          );
        })}
      </div>
    </DesignSurface>
  );
}
