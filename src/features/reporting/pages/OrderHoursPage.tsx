import { useEffect, useMemo, useState } from 'react';
import { rpc } from '@/api/rpc';
import { DesignPageHeader, DesignPanel, DesignSurface } from '@/components/design';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchScope } from '@/lib/branchScope';
import { useCan } from '@/lib/permissions';

type OrderHour = { weekday: number; hour: number; order_type: string; channel: string; orders: number };
const hours = Array.from({ length: 24 }, (_, hour) => hour);
const weekdays = [1, 2, 3, 4, 5, 6, 7];
const orderLabels: Record<string, [string, string]> = {
  dine_in: ['صالة', 'Dine-in'], takeaway: ['استلام', 'Pickup'], delivery: ['توصيل', 'Delivery'],
  drive_thru: ['سيارات', 'Drive-through'], car: ['سيارة', 'Car'], quick: ['سريع', 'Quick'],
};

export function OrderHoursPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const can = useCan();
  const allowed = can('pos.view');
  const { selectedBranchIds } = useBranchScope();
  const branch = selectedBranchIds.length === 1 ? selectedBranchIds[0] : '';
  const [requestedDays, setDays] = useState(7);
  const days = can('history.unlimited') ? requestedDays : 7;
  const [channel, setChannel] = useState('');
  const [orderType, setOrderType] = useState('');
  const [result, setResult] = useState<{ key: string; data: OrderHour[]; failed: boolean }>();
  const key = `${branch}:${days}`;

  useEffect(() => {
    if (!branch || !allowed) return;
    let active = true;
    void rpc<OrderHour[]>('get_workspace_order_hours', { p_branch: branch, p_days: days })
      .then(({ data, error }) => { if (active) setResult({ key, data: data ?? [], failed: !!error }); })
      .catch(() => { if (active) setResult({ key, data: [], failed: true }); });
    return () => { active = false; };
  }, [branch, days, key, allowed]);

  const visible = allowed && result?.key === key ? result : undefined;
  const { counts, peak, total, types } = useMemo(() => {
    const counts = new Map<string, number>();
    const types = new Set<string>();
    let total = 0;
    for (const row of visible?.data ?? []) {
      types.add(row.order_type);
      if ((channel && channel !== row.channel) || (orderType && orderType !== row.order_type)) continue;
      const cell = `${row.weekday}:${row.hour}`;
      const count = Number(row.orders);
      counts.set(cell, (counts.get(cell) ?? 0) + count);
      total += count;
    }
    return { counts, peak: Math.max(0, ...counts.values()), total, types: [...types].sort() };
  }, [visible, channel, orderType]);

  const locale = ar ? 'ar-EG' : 'en-GB';
  const weekday = (day: number) => new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2026, 0, 4 + day)));
  const filterClass = 'h-9 rounded-lg border border-ui-border bg-ui-surface px-2 text-sm';

  return (
    <DesignSurface testId="order-hours-page">
      <DesignPageHeader title={ar ? 'أوقات الذروة' : 'Peak order hours'} subtitle={ar
        ? 'الطلبات المكتملة حسب وقت إنشائها بتوقيت القاهرة، مجمّعة حسب اليوم والساعة.'
        : 'Completed orders grouped by the weekday and hour when they were created, in Cairo time.'} />
      {!allowed || !branch ? (
        <p role="status">{!allowed
          ? (ar ? 'تحتاج إلى صلاحية عرض نقطة البيع.' : 'Point-of-sale viewing access is required.')
          : (ar ? 'اختر فرعًا واحدًا.' : 'Select a single branch.')}</p>
      ) : (
        <DesignPanel>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs">{ar ? 'الفترة' : 'Period'}
              <select value={days} onChange={(event) => setDays(Number(event.target.value))} className={filterClass}>
                <option value={7}>{ar ? 'آخر 7 أيام' : 'Last 7 days'}</option>
                {can('history.unlimited') && <option value={30}>{ar ? 'آخر 30 يومًا' : 'Last 30 days'}</option>}
              </select>
            </label>
            <label className="grid gap-1 text-xs">{ar ? 'المصدر' : 'Source'}
              <select value={channel} onChange={(event) => setChannel(event.target.value)} className={filterClass}>
                <option value="">{ar ? 'كل المصادر' : 'All sources'}</option>
                <option value="pos">{ar ? 'نقطة البيع' : 'Point of sale'}</option>
                <option value="website">{ar ? 'طلبات شارك فيها الموقع أو QR' : 'Orders with website or QR activity'}</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs">{ar ? 'نوع الطلب' : 'Order type'}
              <select value={orderType} onChange={(event) => setOrderType(event.target.value)} className={filterClass}>
                <option value="">{ar ? 'كل الأنواع' : 'All types'}</option>
                {orderType && !types.includes(orderType) && <option value={orderType}>{orderLabels[orderType]?.[ar ? 0 : 1] ?? orderType}</option>}
                {types.map((type) => <option key={type} value={type}>{orderLabels[type]?.[ar ? 0 : 1] ?? type}</option>)}
              </select>
            </label>
            {visible && !visible.failed && <span className="text-sm font-bold text-ui-text">{ar ? 'الإجمالي' : 'Total'} · {total.toLocaleString(locale)}</span>}
          </div>
          {!visible ? <p role="status">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
            : visible.failed ? <p role="alert">{ar ? 'تعذّر تحميل أوقات الذروة.' : 'Peak hours could not be loaded.'}</p>
            : total === 0 ? <p>{ar ? 'لا توجد طلبات مطابقة.' : 'No matching orders.'}</p>
            : <div className="overflow-x-auto">
              <table className="w-full min-w-max border-separate border-spacing-1 text-center text-xs">
                <caption className="sr-only">{ar ? 'عدد الطلبات لكل ساعة ويوم' : 'Order count per hour and weekday'}</caption>
                <thead><tr><th scope="col">{ar ? 'اليوم' : 'Day'}</th>{hours.map((hour) => (
                  <th scope="col" key={hour} className="px-1 tabular-nums">{String(hour).padStart(2, '0')}</th>
                ))}</tr></thead>
                <tbody>{weekdays.map((day) => (
                  <tr key={day}>
                    <th scope="row" className="text-start">{weekday(day)}</th>
                    {hours.map((hour) => {
                      const count = counts.get(`${day}:${hour}`) ?? 0;
                      return <td key={hour} className="min-w-8 rounded p-1 tabular-nums" style={{
                        backgroundColor: count ? `rgb(var(--ui-primary) / ${0.08 + 0.3 * count / peak})` : undefined,
                      }}>{count.toLocaleString(locale)}</td>;
                    })}
                  </tr>
                ))}</tbody>
              </table>
            </div>}
        </DesignPanel>
      )}
    </DesignSurface>
  );
}
