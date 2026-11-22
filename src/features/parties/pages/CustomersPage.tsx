import { CustomerSupportInbox } from '@/features/support/CustomerSupportInbox';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader } from '@/components/design/DesignSurface';
import { DesignSearch } from '@/components/design/DesignSearch';
import { DesignPanel } from '@/components/design/DesignPanel';
import { DesignPagination } from '@/components/design/DesignPagination';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { BranchBadge } from '@/components/BranchBadge';
import { BusinessAttributesFields } from '@/features/shared/BusinessAttributesFields';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatCurrency } from '@/lib/format';
import { importFromExcel } from '@/lib/excel';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranchScope } from '@/lib/branchScope';
import { useCan } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { ArAgingRow, Customer } from '@/lib/types';
import { qr } from '@/api/domains/qr';
import { qrError } from '@/features/qr/errors';
import type { QrCustomerHistory } from '@/features/qr/service';

type CustomerViewRow = Customer & { qrHistory?: QrCustomerHistory };
const isQrGuest = (row: CustomerViewRow) => Boolean(row.qrHistory);

/** View adapters only: never persist a QR guest as a CRM customer automatically. */
const toQrCustomerRow = (guest: QrCustomerHistory): CustomerViewRow => ({
  id: `qr:${guest.branch_id}:${guest.id}`,
  branch_id: guest.branch_id,
  name: guest.name,
  phone: guest.phone,
  name_en: null,
  email: null,
  address: null,
  tax_number: null,
  balance: 0,
  notes: null,
  customer_type: 'customer',
  created_at: guest.purchases[0]?.created_at || guest.orders[0]?.created_at || '',
  qrHistory: guest,
});
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';

export function CustomersPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const branchFilter = useBranchFilter();
  const branchScope = useBranchScope();
  const { runtime } = useOrganizationModules();
  const customerLabel = runtime.terminology.customer[lang === 'ar' ? 'ar' : 'en'];
  const { rows: items, loading, total, hasMore, loadMore, loadingMore, refresh: reloadCustomers, fetchAll: fetchAllCustomers } = usePaginatedRows<Customer>({
    table: 'customers',
    select: '*',
    order: { column: 'created_at', ascending: false },
    branch_ids: branchScope.selectedBranchIds,
    pageSize: 100,
  });
  const [supportOpen, setSupportOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [customerView, setCustomerView] = useState<'all' | 'registered' | 'qr' | 'outstanding'>('all');
  const [qrGuests, setQrGuests] = useState<QrCustomerHistory[]>([]);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrLoadError, setQrLoadError] = useState('');
  const [selectedQrGuest, setSelectedQrGuest] = useState<QrCustomerHistory | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [openBalances, setOpenBalances] = useState<Record<string, number>>({});
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';
  const [form, setForm] = useState({ name: '', name_en: '', phone: '', email: '', address: '', tax_number: '', balance: 0, notes: '', branch_id: '' });
  const [businessAttributes, setBusinessAttributes] = useState<Record<string, unknown>>({});

  useEffect(() => {
    let cancelled = false;
    const loadOpenBalances = async () => {
      const branchIds = branchScope.selectedBranchIds;
      if (!branchIds.length) {
        if (!cancelled) setOpenBalances({});
        return;
      }
      const results = await Promise.all(
        branchIds.map((branchId) => api.accounting.getArAging({ p_branch_id: branchId, p_as_of: new Date().toISOString().slice(0, 10) })),
      );
      const next: Record<string, number> = {};
      results.forEach(({ data }) => {
        ((data as ArAgingRow[]) || []).forEach((row) => { next[row.customer_id] = Number(row.open_amount || 0); });
      });
      if (!cancelled) setOpenBalances(next);
    };
    void loadOpenBalances();
    return () => { cancelled = true; };
  }, [branchScope.scopeKey]);

  useEffect(() => {
    let active = true;
    setQrGuests([]);
    setQrLoadError('');
    if (!can('customers.view') || !branchScope.selectedBranchIds.length) return;
    setQrLoading(true);
    void Promise.all(branchScope.selectedBranchIds.map(async (id) => {
      const result = await qr.customerHistory({ p_branch: id });
      if (result.error) throw result.error;
      return (result.data || []).filter((guest) => guest.branch_id === id);
    })).then((groups) => {
      if (active) setQrGuests(groups.flat());
    }).catch((error) => {
      if (active) setQrLoadError(qrError(error));
    }).finally(() => {
      if (active) setQrLoading(false);
    });
    return () => { active = false; };
    // Scope key is authoritative; changing branch reloads QR records.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchScope.scopeKey]);

  const balanceFor = (customer: Customer) => Number(openBalances[customer.id] || 0);
  const allRows = useMemo<CustomerViewRow[]>(() => [
    ...items,
    ...qrGuests.filter((guest) => branchScope.selectedBranchSet.has(guest.branch_id)).map(toQrCustomerRow),
  ], [items, qrGuests, branchScope.scopeKey]);
  const term = search.trim().toLowerCase();
  const matchesCustomerView = (customer: CustomerViewRow) =>
    customerView === 'all' ||
    (customerView === 'registered' && !isQrGuest(customer)) ||
    (customerView === 'qr' && isQrGuest(customer)) ||
    (customerView === 'outstanding' && !isQrGuest(customer) && balanceFor(customer) > 0);
  const filtered = allRows.filter((c) => matchesCustomerView(c) &&
    (!term || c.name.toLowerCase().includes(term) || c.phone?.includes(term)));
  const openAdd = () => { setEditing(null); setBusinessAttributes({}); setForm({ name: '', name_en: '', phone: '', email: '', address: '', tax_number: '', balance: 0, notes: '', branch_id: branchFilter || '' }); setModalOpen(true); };
  const openEdit = (c: Customer) => { setEditing(c); setBusinessAttributes(((c as Customer & { business_attributes?: Record<string, unknown> }).business_attributes) || {}); setForm({ name: c.name, name_en: c.name_en || '', phone: c.phone || '', email: c.email || '', address: c.address || '', tax_number: c.tax_number || '', balance: c.balance, notes: c.notes || '', branch_id: c.branch_id || branchFilter || '' }); setModalOpen(true); };

  const save = async () => {
    if (!form.name) { show(t('required'), 'error'); return; }
    const payload = { ...form, branch_id: branchFilter || form.branch_id || null, business_attributes: businessAttributes };
    if (editing) {
      const { error } = await supabase.from('customers').update(payload).eq('id', editing.id);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('update', 'customers', editing.id);
    } else {
      const { error } = await supabase.from('customers').insert(payload);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('create', 'customers');
    }
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadCustomers();
  };

  const remove = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('customers').delete().eq('id', deleteId);
    if (error) show(error.message, 'error');
    else { show(t('deleteSuccess'), 'success'); await logAudit('delete', 'customers', deleteId); }
    setDeleteId(null);
    reloadCustomers();
  };

  const handleImport = async (file: File) => {
    try {
      const rows = await importFromExcel(file);
      const payload = rows.map((r) => ({ name: String(r.Name || r.name || ''), phone: String(r.Phone || r.phone || ''), email: String(r.Email || r.email || ''), address: String(r.Address || r.address || ''), tax_number: String(r.TaxNumber || ''), balance: 0, branch_id: branchFilter || branches[0]?.id || null })).filter((r) => r.name);
      const { error } = await supabase.from('customers').insert(payload);
      if (error) show(error.message, 'error');
      else { show(`${payload.length} ${t('import')} OK`, 'success'); reloadCustomers(); }
    } catch (err) { show(String(err), 'error'); }
  };

  const columns: Column<CustomerViewRow>[] = [
    { key: 'name', header: t('name'), render: (c) => <span className="font-medium text-ui-text">{c.name}</span> },
    { key: 'source', header: lang === 'ar' ? 'نوع العميل' : 'Customer source',
      filterValue: (c) => isQrGuest(c) ? 'QR' : (lang === 'ar' ? 'عميل مسجل' : 'Registered'),
      exportValue: (c) => isQrGuest(c) ? 'QR' : 'Registered',
      render: (c) => <span className="rounded-lg border border-ui-border bg-ui-page-alt px-2 py-1 text-xs font-semibold text-ui-muted">
        {isQrGuest(c) ? 'QR' : (lang === 'ar' ? 'مسجل' : 'Registered')}
      </span> },
    { key: 'branch', header: t('branch'), filterValue: (c) => branches.find((b) => b.id === c.branch_id)?.name || '', exportValue: (c) => branches.find((b) => b.id === c.branch_id)?.name || '', render: (c) => <BranchBadge name={branches.find((b) => b.id === c.branch_id)?.name || '-'} /> },
    { key: 'phone', header: t('phone'), render: (c) => c.phone || '-' },
    { key: 'email', header: t('emailField'), render: (c) => c.email || '-' },
    { key: 'address', header: t('address'), render: (c) => c.address || '-' },
    { key: 'balance', header: t('amount'),
      filterValue: (c) => isQrGuest(c) ? '' : balanceFor(c),
      exportValue: (c) => isQrGuest(c) ? '' : balanceFor(c),
      render: (c) => {
      if (isQrGuest(c)) return <span className="text-ui-muted" title={lang === 'ar' ? 'لم يتم ربط حساب ائتمان لهذا العميل' : 'No verified credit account linked'}>—</span>;
      const balance = balanceFor(c);
      return <span className={balance > 0 ? 'text-ui-danger font-medium' : ''}>{formatCurrency(balance, currency, lang)}</span>;
    } },
    { key: 'actions', header: t('actions'), filterable: false, render: (c) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        {!isQrGuest(c) && can('customers.manage') && (
          <button onClick={() => openEdit(c)} className="ui-icon-action ui-icon-action-info"><Edit2 className="w-4 h-4" /></button>
        )}
        {!isQrGuest(c) && can('customers.manage') && (
          <button onClick={() => setDeleteId(c.id)} className="ui-icon-action ui-icon-action-danger"><Trash2 className="w-4 h-4" /></button>
        )}
      </div>
    )},
  ];

  return (
    <DesignSurface testId="customers-page">
      <DesignPageHeader title={customerLabel} actions={
        <>
          {can('customers.manage') && branchFilter && (
            <Button variant="outline" size="sm" aria-pressed={supportOpen} onClick={() => setSupportOpen((open) => !open)}>
              {supportOpen ? 'قائمة العملاء' : 'الشكاوى والاستفسارات'}
            </Button>
          )}
          {can('customers.manage') && (
            <Button size="sm" onClick={openAdd} data-testid="customers-add">
              <Plus className="w-4 h-4" /> {t('add')}
            </Button>
          )}
        </>
      } />
      {supportOpen && can('customers.manage') && branchFilter ? (
        <DesignPanel testId="customers-support-panel">
          <CustomerSupportInbox key={branchFilter} branchId={branchFilter} />
        </DesignPanel>
      ) : <DesignPanel testId="customers-table-panel" bodyClassName="p-2 sm:p-3">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-ui-border pb-3">
          <div className="flex max-w-full gap-4 overflow-x-auto" role="tablist" aria-label={lang === 'ar' ? 'عرض العملاء' : 'Customer views'}>
            {([
              { key: 'all', ar: 'الكل', en: 'All' },
              { key: 'registered', ar: 'المسجلون', en: 'Registered' },
              { key: 'qr', ar: 'عملاء QR', en: 'QR guests' },
              { key: 'outstanding', ar: 'أرصدة مستحقة', en: 'Outstanding' },
            ] as const).map((tab) => (
              <button type="button" role="tab" key={tab.key}
                aria-selected={customerView === tab.key}
                onClick={() => setCustomerView(tab.key)}
                className={`shrink-0 border-b-2 px-1 py-2 text-sm font-semibold transition-colors ${customerView === tab.key ? 'border-ui-primary text-ui-text' : 'border-transparent text-ui-muted hover:text-ui-text'}`}>
                {tab[lang]}
              </button>
            ))}
          </div>
          <DesignSearch value={search} onChange={setSearch}
            placeholder={lang === 'ar' ? 'بحث بالاسم أو الهاتف' : 'Search name or phone'}
            label={t('search')} testId="customers-search" className="w-full sm:w-64" />
        </div>
        {qrLoading && <p role="status" className="mb-2 text-xs text-ui-muted">{lang === 'ar' ? 'جارٍ تحميل عملاء QR...' : 'Loading QR customers...'}</p>}
        {qrLoadError && <p role="alert" className="mb-2 text-xs text-ui-danger">
          {lang === 'ar' ? 'تعذر تحميل عملاء QR؛ تظهر سجلات العملاء المسجلين فقط. ' : 'Could not load QR customers; showing registered customers only. '}{qrLoadError}
        </p>}
        <DataTable
          tableId="customers"
          columns={columns}
          data={filtered}
          loading={loading}
          emptyMessage={t('noData')}
          onRowClick={(row) => {
            if (row.qrHistory) setSelectedQrGuest(row.qrHistory);
            else if (can('customers.manage')) openEdit(row);
          }}
          enableExport={can('customers.export')}
          enableTemplate={can('customers.manage')}
          onImportFile={can('customers.manage') ? handleImport : undefined}
          exportFilename="customers"
          exportDataProvider={async () => {
            const all = await fetchAllCustomers();
            // Export QR guests from the same branch-scoped data already shown;
            // they are not silently converted to or merged with CRM accounts.
            const combined: CustomerViewRow[] = [
              ...all,
              ...qrGuests.filter((guest) => branchScope.selectedBranchSet.has(guest.branch_id)).map(toQrCustomerRow),
            ];
            return combined.filter((customer) => matchesCustomerView(customer) &&
              (!term || customer.name.toLowerCase().includes(term) || customer.phone?.includes(term)));
          }}
          templateFilename="customers-template"
        />
        <DesignPagination loaded={allRows.length} total={total + qrGuests.length} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>}
      <Modal open={!!selectedQrGuest} onClose={() => setSelectedQrGuest(null)}
        title={lang === 'ar' ? 'تفاصيل عميل QR' : 'QR customer details'} size="lg">
        {selectedQrGuest && (
          <div className="space-y-4" data-testid="qr-customer-details">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-ui-border p-3">
                <p className="text-xs text-ui-muted">{t('name')}</p>
                <p className="font-bold">{selectedQrGuest.name}</p>
              </div>
              <div className="rounded-xl border border-ui-border p-3">
                <p className="text-xs text-ui-muted">{t('phone')}</p>
                <p dir="auto" className="font-semibold">{selectedQrGuest.phone || '—'}</p>
              </div>
              <div className="rounded-xl border border-ui-border p-3">
                <p className="text-xs text-ui-muted">{lang === 'ar' ? 'عدد المشتريات' : 'Purchases'}</p>
                <p className="font-bold">{selectedQrGuest.purchase_count}</p>
              </div>
              <div className="rounded-xl border border-ui-border p-3">
                <p className="text-xs text-ui-muted">{lang === 'ar' ? 'مشتريات QR المسددة' : 'Settled QR purchases'}</p>
                <p className="font-bold">{formatCurrency(selectedQrGuest.total_spent,
                  effectiveSettings(selectedQrGuest.branch_id)?.currency || 'EGP', lang)}</p>
              </div>
            </div>
            <p className="text-xs text-ui-muted">
              {lang === 'ar'
                ? 'هذه بيانات سجل QR؛ لا يتم دمجها مع حساب ائتمان العميل المسجل دون تحقق من الهوية.'
                : 'This is a QR visit profile; it is not automatically linked to a registered customer credit account.'}
            </p>
            {selectedQrGuest.purchases.length > 0 && (
              <div>
                <h3 className="mb-2 font-bold">{lang === 'ar' ? 'فواتير QR المكتملة' : 'Completed QR invoices'}</h3>
                <div className="max-h-52 space-y-2 overflow-auto">
                  {selectedQrGuest.purchases.map((purchase) => (
                    <div key={purchase.id} className="flex justify-between gap-3 rounded-lg border border-ui-border p-3 text-sm">
                      <span>{purchase.invoice_number || purchase.id.slice(0, 8)}</span>
                      <span>{formatCurrency(purchase.net_paid,
                        effectiveSettings(selectedQrGuest.branch_id)?.currency || 'EGP', lang)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `${t('edit')} — ${customerLabel}` : `${t('add')} — ${customerLabel}`}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
            <Input label={t('phone')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input label={t('emailField')} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Input label={t('address')} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <Input label="Tax Number" value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} />
          </div>
          {!branchFilter && (
            <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
              <option value="">--</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
          <Textarea label={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <BusinessAttributesFields entity="customer" value={businessAttributes} onChange={setBusinessAttributes} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={save}>{t('save')}</Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={remove} title={t('delete')} message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} />
    </DesignSurface>
  );
}