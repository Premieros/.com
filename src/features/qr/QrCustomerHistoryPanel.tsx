import { useEffect, useMemo, useState } from 'react';
import { qr } from '@/api/domains/qr';
import { useCan } from '@/lib/permissions';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchScope } from '@/lib/branchScope';
import { useBranches } from '@/hooks/useBranches';
import { useSettings } from '@/context/SettingsContext';
import { formatCurrency } from '@/lib/format';
import { qrError } from './errors';
import type { QrCustomerHistory } from './service';
import { StaffGuestVisits } from './StaffGuestVisits';
import { StaffGuestRatings } from './StaffGuestRatings';

export function sortQrCustomersByPurchases(rows: QrCustomerHistory[]): QrCustomerHistory[] {
  return [...rows].sort((a, b) => Number(b.total_spent || 0) - Number(a.total_spent || 0)
    || a.name.localeCompare(b.name, 'ar') || a.id.localeCompare(b.id));
}

/** QR guest profiles are kept distinct from ordinary CRM contacts until identity is verified. */
export function QrCustomerHistoryPanel() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const can = useCan();
  const scope = useBranchScope();
  const { branches } = useBranches();
  const { effectiveSettings } = useSettings();
  const [rows, setRows] = useState<QrCustomerHistory[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const allowed = can('customers.view');
  const branchIds = scope.selectedBranchIds;
  const scopeKey = scope.scopeKey;

  useEffect(() => {
    let active = true;
    setRows([]); setError('');
    if (!allowed || !branchIds.length) return;
    setLoading(true);
    void Promise.all(branchIds.map(async id => {
      const response = await qr.customerHistory({ p_branch: id });
      if (response.error) throw response.error;
      return (response.data || []).filter(row => row.branch_id === id);
    })).then(groups => {
      if (active) setRows(sortQrCustomersByPurchases(groups.flat()));
    }).catch(failure => {
      if (active) { setRows([]); setError(qrError(failure)); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // Scope key is authoritative: rerun on any branch selection change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, scopeKey, revision]);

  const filtered = useMemo(() => rows.filter(row =>
    !search || `${row.name} ${row.phone}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  ), [rows, search]);

  if (!allowed) return null;
  return <section data-testid="qr-customer-history" className="space-y-3 rounded-xl border border-ui-border bg-ui-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="text-base font-bold">{ar ? 'عملاء طلبات QR — الأعلى شراءً' : 'QR ordering customers — top spenders'}</h2>
        <p className="text-xs text-ui-muted">
          {ar
            ? 'إجمالي مشتريات الفواتير المكتملة فقط، مرتبط بهوية الزيارة وليس بتطابق الهاتف. طلبات العملاء الأخرى تظهر بالسجل دون إضافتها للمشتريات.'
            : 'Only settled sales linked to the guest visit count as purchases. Other requests remain in history; no phone-based CRM matching.'}
        </p>
      </div>
      <button type="button" onClick={() => setRevision(value => value + 1)} disabled={loading}
        className="rounded-lg border border-ui-border px-3 py-2 text-xs font-semibold">
        {ar ? 'تحديث العملاء' : 'Refresh customers'}
      </button>
    </div>
    <input type="search" value={search} onChange={event => setSearch(event.target.value)}
      aria-label={ar ? 'ابحث في عملاء طلبات QR' : 'Search QR customers'}
      placeholder={ar ? 'اسم العميل أو رقم الهاتف' : 'Customer name or phone'}
      className="w-full rounded-lg border border-ui-border bg-ui-page px-3 py-2 text-sm" />
    {loading && <p className="text-sm text-ui-muted">{ar ? 'جارٍ تحميل العملاء...' : 'Loading customers...'}</p>}
    {error && <p role="alert" className="text-sm text-ui-danger">{error}</p>}
    {!loading && !error && filtered.length === 0 && <p className="text-sm text-ui-muted">
      {ar ? 'لا يوجد عملاء QR مطابقون في الفروع المحددة.' : 'No matching QR customers in selected branches.'}
    </p>}
    {!loading && !error && filtered.map((customer, rank) => {
      const branch = branches.find(item => item.id === customer.branch_id);
      const currency = effectiveSettings(customer.branch_id)?.currency || 'EGP';
      return <details key={customer.id} className="rounded-xl border border-ui-border bg-ui-page-alt p-3">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ui-primary-soft font-bold text-ui-primary">{rank + 1}</span>
            <div className="min-w-[140px] flex-1">
              <p className="font-bold">{customer.name}</p>
              <p className="text-xs text-ui-muted" dir="ltr">{customer.phone}</p>
              <p className="text-xs text-ui-muted">{branch?.name || ''}</p>
            </div>
            <div className="text-end text-sm">
              <p className="font-bold">{formatCurrency(customer.total_spent, currency, lang)}</p>
              <p className="text-xs text-ui-muted">{customer.purchase_count} {ar ? 'عمليات شراء' : 'purchases'}</p>
              <p className="text-xs text-ui-muted">
                {customer.rating_count ? `★ ${customer.average_rating ?? '—'} / 5 · ${customer.rating_count}` : (ar ? 'لم يُقيّم بعد' : 'Not yet rated')}
              </p>
            </div>
          </div>
        </summary>
        <div className="mt-3 space-y-3 border-t border-ui-border pt-3">
          <div>
            <h3 className="mb-2 text-sm font-bold">{ar ? 'طلبات العميل السابقة' : 'Customer request history'}</h3>
            {!customer.orders.length && <p className="text-xs text-ui-muted">{ar ? 'لا توجد طلبات.' : 'No requests.'}</p>}
            {customer.orders.map(order => <div key={order.id} className="mb-2 rounded-lg border border-ui-border bg-ui-surface p-3 text-xs">
              <p className="font-semibold">#{order.order_number || order.id.slice(0, 8)} · {order.order_type === 'delivery' ? (ar ? 'توصيل' : 'Delivery') : (ar ? 'داخل المطعم' : 'Dine-in')} · {order.table_name}</p>
              <p className="text-ui-muted">{new Date(order.created_at).toLocaleString(ar ? 'ar-EG' : 'en-GB')} · {order.status}</p>
              <p className="mt-1">{order.paid_value == null
                ? (ar ? 'غير محسوب ضمن المشتريات المدفوعة' : 'Not counted as a settled purchase')
                : formatCurrency(order.paid_value, currency, lang)}</p>
            </div>)}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-bold">{ar ? 'تقييمات هذا العميل' : 'This customer’s ratings'}</h3>
            {!customer.ratings.length && <p className="text-xs text-ui-muted">{ar ? 'لا توجد تقييمات.' : 'No ratings.'}</p>}
            {customer.ratings.map((rating, index) => <div key={`${rating.created_at}-${index}`} className="mb-2 rounded-lg border border-ui-border bg-ui-surface p-3 text-xs">
              <p className="font-bold">★ {rating.overall}/5 · {ar ? 'الطعام' : 'Food'} {rating.food}/5 · {ar ? 'الخدمة' : 'Service'} {rating.service}/5</p>
              {rating.note && <p className="mt-1 whitespace-pre-wrap break-words">{rating.note}</p>}
              <p className="text-ui-muted">{new Date(rating.created_at).toLocaleString(ar ? 'ar-EG' : 'en-GB')}</p>
            </div>)}
          </div>
        </div>
      </details>;
    })}
    <p className="text-xs text-ui-muted">{ar ? 'يظهر ما يصل إلى 250 ملف عميل و50 طلبًا و20 تقييمًا لكل ملف في كل فرع. ملفات عملاء QR منفصلة عن سجل الائتمان حتى يتم التحقق من الهوية.' : 'Up to 250 guests, 50 requests and 20 ratings per guest per branch. QR profiles stay separate from credit accounts pending identity verification.'}</p>
    {can('pos.view') && branchIds.map(id => <div key={id}>
      <StaffGuestVisits branchId={id} canReview={can('pos.order.edit')} />
      <StaffGuestRatings branchId={id} />
    </div>)}
  </section>;
}
