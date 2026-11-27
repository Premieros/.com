import { RecordFocus, useRecordFocus } from '@/components/RecordFocus';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RefreshCw, Truck } from 'lucide-react';
import { rpc } from '@/api/rpc';
import { Button } from '@/components/Button';
import { DataTable, type Column } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { DesignPageHeader, DesignSurface } from '@/components/design/DesignSurface';
import { formatDateTime } from '@/lib/format';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';

const statusLabels = {
  waiting: 'بانتظار التعيين', assigned: 'تم التعيين', on_the_way: 'في الطريق',
  delivered: 'تم التسليم', failed: 'تعذّر التسليم',
};
type Status = keyof typeof statusLabels;
type Kind = 'service' | 'driver';
type Entry = { id: string; kind: Kind; name: string; phone: string; active: boolean };
type Order = {
  id: string; order_number: string; order_status: string; created_at: string; updated_at: string | null;
  service_id: string | null; driver_id: string | null; dispatch_status: Status; version: number;
};
type Workspace = { orders: Order[]; directory: Entry[] };
const inputClass = 'mt-1 w-full rounded-lg border border-ui-border bg-ui-page px-3 py-2';

export default function DeliveryWorkspacePage() {
  const branch = useBranchFilter();
  if (!branch) return <p className="p-4 text-sm">اختر فرعًا لعرض التوصيل.</p>;
  return <DeliveryWorkspace key={branch} branch={branch} />;
}

function DeliveryWorkspace({ branch }: { branch: string }) {
  const can = useCan();
  const record = useRecordFocus();
  const [tab, setTab] = useState<'orders' | Kind>('orders');
  const [history, setHistory] = useState(false);
  const [data, setData] = useState<Workspace>({ orders: [], directory: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [driverFilter, setDriverFilter] = useState('');
  const [entry, setEntry] = useState<Entry | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void rpc<Workspace>('delivery_workspace', { p_branch: branch, p_history: history })
      .then(({ data: result, error: failure }) => {
        if (!active) return;
        if (failure || !result) {
          setError('تعذّر تحميل التوصيل. اضغط تحديث لإعادة المحاولة.');
          return;
        }
        setData(result);
      })
      .catch(() => { if (active) setError('تعذّر الاتصال بخدمة التوصيل.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [branch, history, revision]);

  const refresh = () => setRevision((value) => value + 1);
  const names = new Map(data.directory.map((item) => [item.id, item.name]));
  const entryName = (id: string | null) => id ? names.get(id) || '—' : '—';
  const openTab = (next: typeof tab) => { setTab(next); setNotice(''); };
  const addEntry = (kind: Kind) => {
    setError(''); setNotice('');
    setEntry({ id: '', kind, name: '', phone: '', active: true });
  };
  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    if (!entry || saving || !can('settings.manage')) return;
    setSaving(true); setError('');
    try {
      const result = await rpc('delivery_save_directory', {
        p_branch: branch, p_kind: entry.kind, p_name: entry.name.trim(), p_phone: entry.phone,
        p_id: entry.id || null, p_active: entry.active,
      });
      if (result.error) {
        setError(result.error.code === '23505' ? 'هذا الاسم مسجل بالفعل في الفرع.' : 'تعذّر حفظ البيانات. تحقق من الصلاحية والمحاولة.');
        return;
      }
      setEntry(null); setNotice('تم الحفظ.'); refresh();
    } catch {
      setError('تعذّر تأكيد الحفظ. حدّث القائمة قبل إعادة المحاولة.');
    } finally {
      setSaving(false);
    }
  }
  async function saveOrder(event: FormEvent) {
    event.preventDefault();
    if (!order || saving || !can('pos.order.edit')) return;
    setSaving(true); setError('');
    try {
      const result = await rpc('delivery_update_dispatch', {
        p_branch: branch, p_order: order.id, p_version: order.version,
        p_status: order.dispatch_status, p_service: order.service_id, p_driver: order.driver_id,
      });
      if (result.error) {
        if (result.error.message.includes('DELIVERY_REFRESH_REQUIRED')) {
          setOrder(null); refresh(); setNotice('تغيّرت بيانات الطلب لدى موظف آخر. افتح الطلب مجددًا.');
        } else setError('تعذّر تحديث الطلب. تأكد من اختيار طيار أو خدمة نشطة ومن حالة الطلب.');
        return;
      }
      setOrder(null);
      setNotice(order.dispatch_status === 'delivered' && !history
        ? 'تم تسجيل التسليم. لعرض الطلب مجددًا، فعّل «آخر 30 يومًا».'
        : 'تم تحديث حالة التوصيل.');
      refresh();
    } catch {
      setError('تعذّر تأكيد التحديث. حدّث القائمة قبل إعادة المحاولة.');
    } finally {
      setSaving(false);
    }
  }

  const orderColumns: Column<Order>[] = [
    { key: 'order_number', header: 'الطلب', mobilePriority: true, render: (row) => row.order_status === 'completed'
      ? row.order_number
      : <Link className="font-semibold text-ui-primary" to={`/pos/${row.id}`} state={{ branchId: branch }}>{row.order_number}</Link> },
    { key: 'dispatch_status', header: 'حالة التوصيل', mobilePriority: true, render: (row) => statusLabels[row.dispatch_status] },
    { key: 'driver_id', header: 'الطيار', render: (row) => entryName(row.driver_id), filterValue: (row) => entryName(row.driver_id) },
    { key: 'service_id', header: 'الخدمة', render: (row) => entryName(row.service_id), filterValue: (row) => entryName(row.service_id) },
    { key: 'updated_at', header: 'آخر تحديث', render: (row) => formatDateTime(row.updated_at || row.created_at, 'ar') },
    { key: 'actions', header: 'إجراء', render: (row) => can('pos.order.edit') && row.dispatch_status !== 'delivered'
      && ['open', 'held', 'completed'].includes(row.order_status)
      ? <Button size="sm" variant="outline" onClick={() => { setError(''); setOrder({ ...row }); }}>تعيين وتحديث</Button>
      : null },
  ];
  const entryColumns: Column<Entry>[] = [
    { key: 'name', header: 'الاسم', mobilePriority: true },
    { key: 'phone', header: 'هاتف التواصل', render: (row) => <span dir="ltr">{row.phone || '—'}</span> },
    { key: 'active', header: 'الحالة', render: (row) => row.active ? 'نشط' : 'موقوف' },
    { key: 'actions', header: 'إجراء', render: (row) => <div className="flex flex-wrap gap-2">
      {row.kind === 'driver' && <Button size="sm" variant="outline" onClick={() => {
        setDriverFilter(row.id); openTab('orders');
      }}>متابعة طلباته</Button>}
      {can('settings.manage') && <Button size="sm" variant="outline" onClick={() => {
        setError(''); setEntry({ ...row });
      }}>تعديل</Button>}
    </div> },
  ];
  const assignments = (kind: Kind, current: string | null) => data.directory
    .filter((item) => item.kind === kind && (item.active || item.id === current));

  return <DesignSurface testId="delivery-workspace">
    <DesignPageHeader title="التوصيل" actions={<>
      <Button size="sm" variant="outline" onClick={refresh} disabled={loading}><RefreshCw size={16} /> تحديث</Button>
      {can('pos.order.create') && <Link className="inline-flex items-center gap-2 rounded-lg bg-ui-primary px-3 py-2 text-sm font-bold text-white"
        to="/pos" state={{ startStep: 'delivery', branchId: branch }}><Truck size={16} /> طلب توصيل جديد</Link>}
    </>} />
    <div className="flex flex-wrap items-center gap-2">
      {([['orders', 'طلبات التوصيل'], ['service', 'خدمات التوصيل'], ['driver', 'الطيارون']] as const).map(([key, label]) =>
        <button key={key} type="button" aria-pressed={tab === key} onClick={() => openTab(key)}
          className="rounded-lg border border-ui-border px-3 py-2 text-sm font-semibold aria-pressed:bg-ui-primary-soft">{label}</button>)}
      {tab !== 'orders' && can('settings.manage') && <Button size="sm" onClick={() => addEntry(tab)}><Plus size={16} />{tab === 'service' ? 'إضافة خدمة توصيل' : 'إضافة طيار'}</Button>}
      {tab === 'orders' && <>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={history} onChange={(event) => setHistory(event.target.checked)} /> آخر 30 يومًا</label>
        <select className="rounded-lg border border-ui-border bg-ui-page px-2 py-2 text-sm" aria-label="تصفية حسب الطيار" value={driverFilter} onChange={(event) => setDriverFilter(event.target.value)}>
          <option value="">كل الطيارين</option>
          {data.directory.filter((item) => item.kind === 'driver').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </>}
    </div>
    {notice && <p role="status" className="text-sm text-ui-muted">{notice}</p>}
    {tab === 'orders' && record.id && <RecordFocus onClear={record.clear} />}
    {tab === 'orders' ? <DataTable tableId="delivery-orders" columns={orderColumns}
      data={data.orders.filter((row) => (!record.id || record.id === row.id) && (!driverFilter || row.driver_id === driverFilter))} loading={loading}
      error={!entry && !order ? error : null} emptyMessage="لا توجد طلبات توصيل في هذا العرض." />
      : <DataTable key={tab} tableId={`delivery-${tab}`} columns={entryColumns}
        data={data.directory.filter((item) => item.kind === tab)} loading={loading}
        error={!entry && !order ? error : null} emptyMessage={tab === 'service' ? 'لا توجد خدمات توصيل لهذا الفرع.' : 'لا يوجد طيارون لهذا الفرع.'} />}

    <Modal open={!!entry} onClose={() => { if (!saving) setEntry(null); }}
      title={entry?.kind === 'service' ? 'خدمة التوصيل' : 'بيانات الطيار'}>
      {entry && <form className="space-y-3" onSubmit={saveEntry}>
        <label className="block">الاسم<input required maxLength={100} value={entry.name} className={inputClass} onChange={(event) => setEntry({ ...entry, name: event.target.value })} /></label>
        <label className="block">هاتف التواصل<input type="tel" maxLength={32} value={entry.phone} className={inputClass} onChange={(event) => setEntry({ ...entry, phone: event.target.value })} /></label>
        <label className="flex gap-2"><input type="checkbox" checked={entry.active} onChange={(event) => setEntry({ ...entry, active: event.target.checked })} /> نشط ومتاح للتعيين</label>
        {error && <p role="alert" className="text-ui-danger">{error}</p>}
        <Button type="submit" disabled={saving || !entry.name.trim()}>حفظ</Button>
      </form>}
    </Modal>
    <Modal open={!!order} onClose={() => { if (!saving) setOrder(null); }} title={`توصيل الطلب ${order?.order_number || ''}`}>
      {order && <form className="space-y-3" onSubmit={saveOrder}>
        <label className="block">خدمة التوصيل<select className={inputClass} value={order.service_id || ''} onChange={(event) => setOrder({ ...order, service_id: event.target.value || null })}>
          <option value="">بدون خدمة</option>{assignments('service', order.service_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label className="block">الطيار<select className={inputClass} value={order.driver_id || ''} onChange={(event) => setOrder({ ...order, driver_id: event.target.value || null })}>
          <option value="">بدون طيار</option>{assignments('driver', order.driver_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label className="block">الحالة<select className={inputClass} value={order.dispatch_status} onChange={(event) => setOrder({ ...order, dispatch_status: event.target.value as Status })}>
          {Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        {error && <p role="alert" className="text-ui-danger">{error}</p>}
        <p className="text-xs text-ui-muted">اختر طيارًا أو خدمة قبل تعيين الطلب أو تسجيل خروجه للتوصيل.</p>
        <Button type="submit" disabled={saving || (['assigned', 'on_the_way', 'delivered'].includes(order.dispatch_status) && !order.driver_id && !order.service_id)}>حفظ التحديث</Button>
      </form>}
    </Modal>
  </DesignSurface>;
}
