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
import { filterQrCustomers, rankWithinCustomerBranch, sortQrCustomersByPurchases, type QrCustomerFilter } from './qrCustomerRanking';
import { StaffGuestVisits } from './StaffGuestVisits';
import { StaffGuestRatings } from './StaffGuestRatings';

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
  const [filter, setFilter] = useState<QrCustomerFilter>('all');
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

  const filtered = useMemo(() => filterQrCustomers(rows, search, filter), [rows, search, filter]);

  if (!allowed) return null;
  return <section data-testid="qr-customer-history" className="space-y-3 rounded-xl border border-ui-border bg-ui-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="text-base font-bold">{ar ? 'عملاء طلبات QR — الأعلى شراءً' : 'QR ordering customers — top spenders'}</h2>
        <p className="text-xs text-ui-muted">
          {ar
            ? 'ترتيب المشتريات داخل كل فرع وعملته، والفاتورة المكتملة تُحسب مرة واحدة فقط. مرتبط بهوية الزيارة وليس بتطابق الهاتف. طلبات العملاء الأخرى تظهر بالسجل دون إضافتها للمشتريات.'
            : 'Ranked within each branch and currency; every settled invoice counts once. Other requests remain in history; no phone-based CRM matching.'}
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
    <div className="flex flex-wrap gap-2" role="group" aria-label={ar ? 'تصفية عملاء QR' : 'Filter QR customers'}>
      {([
        ['all', ar ? 'الجميع' : 'All'],
        ['purchased', ar ? 'قاموا بالشراء' : 'Purchased'],
        ['rated', ar ? 'لديهم تقييمات' : 'Rated'],
        ['pending', ar ? 'طلبات معلقة' : 'Pending orders'],
      ] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)}
        aria-pressed={filter === value}
        className={`rounded-lg border px-3 py-2 text-xs font-semibold ${filter === value ? 'border-ui-primary bg-ui-primary-soft text-ui-primary' : 'border-ui-border text-ui-text'}`}>
        {label}
      </button>)}
    </div>
    {!loading && !error && <p className="text-xs text-ui-muted">{ar ? `عدد النتائج: ${filtered.length}` : `Results: ${filtered.length}`}</p>}
    {loading && <p className="text-sm text-ui-muted">{ar ? 'جارٍ تحميل العملاء...' : 'Loading customers...'}</p>}
    {error && <p role="alert" className="text-sm text-ui-danger">{error}</p>}
    {!loading && !error && filtered.length === 0 && <p className="text-sm text-ui-muted">
      {ar ? 'لا يوجد عملاء QR مطابقون في الفروع المحددة.' : 'No matching QR customers in selected branches.'}
    </p>}
    {!loading && !error && filtered.map((customer) => {
      const branch = branches.find(item => item.id === customer.branch_id);
      const rank = rankWithinCustomerBranch(rows, customer.id);
      const currency = effectiveSettings(customer.branch_id)?.currency || 'EGP';
      return <details key={customer.id} className="rounded-xl border border-ui-border bg-ui-page-alt p-3">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ui-primary-soft font-bold text-ui-primary">{rank}</span>
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
            <h3 className="mb-2 text-sm font-bold">{ar ? 'فواتير الشراء المكتملة' : 'Completed purchase invoices'}</h3>
            {!customer.purchases.length && <p className="text-xs text-ui-muted">{ar ? 'لا توجد فواتير مكتملة منسوبة لهذا العميل.' : 'No settled invoices attributable to this guest.'}</p>}
            {customer.purchases.map(purchase => <div key={purchase.id} className="mb-2 rounded-lg border border-ui-border bg-ui-surface p-3 text-xs">
              <p className="font-semibold">#{purchase.invoice_number || purchase.id.slice(0, 8)}</p>
              <p className="text-ui-muted">{new Date(purchase.created_at).toLocaleString(ar ? 'ar-EG' : 'en-GB')}</p>
              <p className="mt-1 font-bold">{formatCurrency(purchase.net_paid, currency, lang)}</p>
            </div>)}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-bold">{ar ? 'طلبات العميل السابقة' : 'Customer request history'}</h3>
            {!customer.orders.length && <p className="text-xs text-ui-muted">{ar ? 'لا توجد طلبات.' : 'No requests.'}</p>}
            {customer.orders.map(order => <div key={order.id} className="mb-2 rounded-lg border border-ui-border bg-ui-surface p-3 text-xs">
              <p className="font-semibold">#{order.order_number || order.id.slice(0, 8)} · {order.order_type === 'delivery' ? (ar ? 'توصيل' : 'Delivery') : (ar ? 'داخل المطعم' : 'Dine-in')} · {order.table_name}</p>
              <p className="text-ui-muted">{new Date(order.created_at).toLocaleString(ar ? 'ar-EG' : 'en-GB')} · {order.status}</p>
              {order.items?.length > 0 && <ul className="mt-2 space-y-1" aria-label={ar ? 'أصناف الطلب' : 'Requested items'}>
                {order.items.map((item, index) => <li key={index} className="rounded border border-ui-border bg-ui-page-alt p-2">
                  <strong>{item.name || (ar ? 'صنف غير مسمى' : 'Unnamed item')}</strong>
                  {' · '}{item.quantity} × {item.price}
                  {item.notes && <p className="mt-1 text-ui-muted">{item.notes}</p>}
                </li>)}
              </ul>}
              {order.items_truncated && <p className="mt-1 text-ui-warning">{ar ? 'تم عرض أول 30 صنفًا فقط.' : 'Showing the first 30 items only.'}</p>}
              <p className="mt-1 text-ui-muted">{ar ? 'تظهر الفواتير المكتملة مرة واحدة في قسم المشتريات أعلاه' : 'Completed invoices appear once in Purchases above'}</p>
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
          <div>
            <h3 className="mb-2 text-sm font-bold">{ar ? 'سجل طلبات الخدمة والشيك' : 'Service and check requests'}</h3>
            {!customer.service_history.length && <p className="text-xs text-ui-muted">{ar ? 'لا توجد طلبات خدمة سابقة.' : 'No previous service calls.'}</p>}
            {customer.service_history.map(item => <div key={item.id} className="mb-2 rounded-lg border border-ui-border bg-ui-surface p-3 text-xs">
              <p className="font-semibold">{item.kind === 'check' ? (ar ? 'طلب شيك' : 'Check request') : (ar ? 'طلب خدمة' : 'Service request')} · {item.table_name} · {item.status}</p>
              {item.note && <p className="mt-1 whitespace-pre-wrap break-words">{item.note}</p>}
              <p className="text-ui-muted">{new Date(item.created_at).toLocaleString(ar ? 'ar-EG' : 'en-GB')}</p>
            </div>)}
          </div>
        </div>
      </details>;
    })}
    <p className="text-xs text-ui-muted">{ar ? 'يظهر ما يصل إلى 250 عميلًا و50 فاتورة شراء و50 طلبًا و20 تقييمًا و30 طلب خدمة لكل ملف في كل فرع. ملفات عملاء QR منفصلة عن سجل الائتمان حتى يتم التحقق من الهوية.' : 'Up to 250 guests, 50 requests and 20 ratings per guest per branch. QR profiles stay separate from credit accounts pending identity verification.'}</p>
    {can('pos.view') && branchIds.map(id => <div key={id}>
      <StaffGuestVisits branchId={id} canReview={can('pos.order.edit')} />
      <StaffGuestRatings branchId={id} />
    </div>)}
  </section>;
}
