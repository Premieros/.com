import { ArrowRightLeft } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { formatCurrency } from '@/lib/format';
import type { DiningTable, Order, OrderItem } from '@/lib/types';
import type { OrderKitchenSend } from '../../types';
import { orderOperatorName } from '../../utils/operatorName';
import { usePosPermissions } from '../../hooks/usePosPermissions';

export const TABLE_TILE_STATES = {
  vacant: { ar: 'متاحة', en: 'Available', tone: 'border-ui-border bg-ui-page-alt text-ui-text' },
  occupied: { ar: 'مشغولة', en: 'Occupied', tone: 'border-ui-primary/50 bg-ui-primary-soft text-ui-primary' },
  sent: { ar: 'بالمطبخ', en: 'Kitchen', tone: 'border-ui-info/50 bg-ui-info-soft text-ui-info' },
  additions: { ar: 'إضافة جديدة', en: 'New items', tone: 'border-ui-warning/60 bg-ui-warning-soft text-ui-warning' },
  held: { ar: 'معلقة', en: 'Held', tone: 'border-ui-danger/50 bg-ui-danger-soft text-ui-danger' },
  reserved: { ar: 'محجوزة', en: 'Reserved', tone: 'border-dashed border-ui-info bg-ui-page text-ui-info' },
  closed: { ar: 'مغلقة', en: 'Closed', tone: 'border-dashed border-ui-border-strong bg-ui-page text-ui-muted' },
} as const;

interface TableCardProps {
  table: DiningTable;
  orders: Order[];
  itemsByOrder: Record<string, OrderItem[]>;
  kitchenSendsByOrder: Record<string, OrderKitchenSend[]>;
  currency: string;
  isSelected: boolean;
  onSelect: (table: DiningTable) => void;
  onTransfer?: (order: Order, table: DiningTable) => void;
}

export function TableCard({ table, orders, itemsByOrder, kitchenSendsByOrder, currency, isSelected, onSelect, onTransfer }: TableCardProps) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const perms = usePosPermissions();
  const [activeOrder] = orders;
  const operator = activeOrder ? orderOperatorName(activeOrder) : null;
  let sent = false;
  let unsent = false;
  for (const order of orders) {
    const sentIds = new Set((kitchenSendsByOrder[order.id] ?? []).map((item) => item.order_item_id));
    for (const item of itemsByOrder[order.id] ?? []) {
      if (sentIds.has(item.id)) sent = true;
      else unsent = true;
    }
  }
  const status = orders.some((order) => order.status === 'held') ? 'held'
    : sent && unsent ? 'additions' : sent ? 'sent' : activeOrder ? 'occupied' : table.status;
  const { tone, ar: statusAr, en: statusEn } = TABLE_TILE_STATES[status];
  const statusLabel = ar ? statusAr : statusEn;
  const total = orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  const label = [table.name, statusLabel, activeOrder && `#${activeOrder.order_number}`,
    orders.length > 1 && `${orders.length} ${ar ? 'حسابات' : 'bills'}`,
    activeOrder && formatCurrency(total, currency, lang), operator].filter(Boolean).join(' · ');

  return (
    <div className="group relative min-w-0">
      <button type="button" aria-label={label} title={label} aria-pressed={isSelected} onClick={() => onSelect(table)}
        className={`flex aspect-square w-full flex-col items-start justify-between gap-0.5 overflow-hidden rounded-xl border p-1.5 text-start transition-colors hover:border-ui-primary focus-visible:ring-2 focus-visible:ring-ui-primary ${tone} ${isSelected ? 'ring-2 ring-ui-primary' : ''}`}>
        <span className="w-full truncate text-xs font-bold tabular-nums">{table.name}</span>
        {operator && <span data-testid={`pos-table-operator-${table.id}`} className="w-full truncate text-[9px]">{operator}</span>}
        {orders.length > 1 && <span className="text-[9px] font-bold tabular-nums">{orders.length} {ar ? 'حسابات' : 'bills'}</span>}
      </button>
      {activeOrder && perms.canTransferOrder && onTransfer && (
        <button type="button" onClick={() => onTransfer(activeOrder, table)} title={ar ? 'نقل الطلب' : 'Transfer order'}
          aria-label={ar ? `نقل طلب طاولة ${table.name}` : `Transfer order on ${table.name}`}
          className="absolute bottom-1 end-1 grid h-6 w-6 place-items-center rounded-md border border-ui-border bg-ui-surface text-ui-text shadow-sm focus-visible:ring-2 focus-visible:ring-ui-primary">
          <ArrowRightLeft className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
