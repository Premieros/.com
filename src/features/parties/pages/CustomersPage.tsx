import { WorkspaceControls } from '@/components/WorkspaceToolbar';
import { RecordFocus, useRecordFocus } from '@/components/RecordFocus';
import { CustomerSupportInbox } from '@/features/support/CustomerSupportInbox';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Edit2, Trash2, Users, UserCheck, QrCode, Wallet, MapPin, Mail, Phone, LayoutGrid, List, Rows3, X, ArrowUpDown, ArrowUpRight } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader } from '@/components/design/DesignSurface';
import { DesignSearch } from '@/components/design/DesignSearch';
import { DesignPanel } from '@/components/design/DesignPanel';
import { DesignPagination } from '@/components/design/DesignPagination';
import { WorkspaceMeter } from '@/components/design/WorkspaceIndicators';
import { DataTable, type Column } from '@/components/DataTable';
import { StatCard } from '@/components/PageHeader';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { BranchBadge } from '@/components/BranchBadge';
import { BusinessAttributesFields } from '@/features/shared/BusinessAttributesFields';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatCurrency, formatNumber } from '@/lib/format';
import { importFromExcel } from '@/lib/excel';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranchScope } from '@/lib/branchScope';
import { useCan } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { ArAgingRow, Customer } from '@/lib/types';
import { APP_ROUTES } from '@/core/navigation/routes';
import { qr } from '@/api/domains/qr';
import { qrError } from '@/features/qr/errors';
import type { QrCustomerHistory } from '@/features/qr/service';

type CustomerViewRow = Customer & { qrHistory?: QrCustomerHistory };
type CustomerSaleSummary = {
  id: string;
  invoice_number: string | null;
  total: number | null;
  refunded_amount?: number | null;
  status: string | null;
  created_at: string;
};
const isQrGuest = (row: CustomerViewRow) => Boolean(row.qrHistory);

const AVATAR_TONES = [
  'bg-[#dce7f7] text-[#284b7e] dark:bg-[#1e314a] dark:text-[#a8c7f5]',
  'bg-[#d8eee7] text-[#1c6254] dark:bg-[#193b34] dark:text-[#86d8c5]',
  'bg-[#f4e2ec] text-[#7a3153] dark:bg-[#462133] dark:text-[#f2a8c8]',
  'bg-[#f5ead4] text-[#7c5316] dark:bg-[#463417] dark:text-[#f2c879]',
  'bg-[#e2ecd6] text-[#3c611e] dark:bg-[#273a18] dark:text-[#b4d66a]',
];

function customerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'C';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

function avatarTone(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

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
  const record = useRecordFocus();
  const branchFilter = useBranchFilter();
  const branchScope = useBranchScope();
  const { runtime } = useOrganizationModules();
  const customerLabel = runtime.terminology.customer[lang === 'ar' ? 'ar' : 'en'];
  const { rows: items, loading, total, hasMore, loadMore, loadingMore, refresh: reloadCustomers, fetchAll: fetchAllCustomers } = usePaginatedRows<Customer>({
    table: 'customers',
    filters: record.id ? [{ column: 'id', value: record.id }] : undefined,
    select: '*',
    order: { column: 'created_at', ascending: false },
    branch_ids: branchScope.selectedBranchIds,
    enabled: can('customers.view'),
    pageSize: 100,
  });
  const [supportOpen, setSupportOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [customerView, setCustomerView] = useState<'all' | 'registered' | 'qr' | 'outstanding'>('all');
  const [qrGuests, setQrGuests] = useState<QrCustomerHistory[]>([]);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrLoadError, setQrLoadError] = useState('');
  const [selectedQrGuest, setSelectedQrGuest] = useState<QrCustomerHistory | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerViewRow | null>(null);
  const [customerSales, setCustomerSales] = useState<CustomerSaleSummary[]>([]);
  const [customerSalesLoading, setCustomerSalesLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'rows' | 'list'>('cards');
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'balance'>('recent');
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [openBalances, setOpenBalances] = useState<Record<string, number>>({});
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';
  const [form, setForm] = useState({ name: '', name_en: '', phone: '', email: '', address: '', tax_number: '', balance: 0, notes: '', branch_id: '' });
  const [businessAttributes, setBusinessAttributes] = useState<Record<string, unknown>>({});

  const canViewCustomers = can('customers.view');
  useEffect(() => {
    let cancelled = false;
    const loadOpenBalances = async () => {
      if (!canViewCustomers || !branchScope.selectedBranchIds.length) {
        if (!cancelled) setOpenBalances({});
        return;
      }
      const results = await Promise.all(
        branchScope.selectedBranchIds.map((branchId) => api.accounting.getArAging({ p_branch_id: branchId, p_as_of: new Date().toISOString().slice(0, 10) })),
      );
      const next: Record<string, number> = {};
      results.forEach(({ data }) => {
        ((data as ArAgingRow[]) || []).forEach((row) => { next[row.customer_id] = Number(row.open_amount || 0); });
      });
      if (!cancelled) setOpenBalances(next);
    };
    void loadOpenBalances();
    return () => { cancelled = true; };
  }, [canViewCustomers, branchScope.selectedBranchIds]);

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

  const balanceFor = useCallback((customer: Customer) => Number(openBalances[customer.id] || 0), [openBalances]);
  const allRows = useMemo<CustomerViewRow[]>(() => [
    ...items,
    ...qrGuests.filter((guest) => !record.id && branchScope.selectedBranchSet.has(guest.branch_id)).map(toQrCustomerRow),
  ], [items, qrGuests, branchScope.selectedBranchSet, record.id]);
  const term = search.trim().toLowerCase();
  const matchesCustomerView = (customer: CustomerViewRow) =>
    customerView === 'all' ||
    (customerView === 'registered' && !isQrGuest(customer)) ||
    (customerView === 'qr' && isQrGuest(customer)) ||
    (customerView === 'outstanding' && !isQrGuest(customer) && balanceFor(customer) > 0);
  const filtered = useMemo(() => {
    const base = allRows.filter((c) => record.id ? c.id === record.id : matchesCustomerView(c) &&
      (!term || c.name.toLowerCase().includes(term) || c.phone?.includes(term)));
    if (sortBy === 'name') return [...base].sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'balance') return [...base].sort((a, b) => (isQrGuest(b) ? 0 : balanceFor(b)) - (isQrGuest(a) ? 0 : balanceFor(a)));
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, record.id, customerView, term, sortBy, openBalances]);

  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    if (can('customers.manage')) {
      setEditing(null);
      setBusinessAttributes({});
      setForm({ name: '', name_en: '', phone: '', email: '', address: '', tax_number: '', balance: 0, notes: '', branch_id: branchFilter || '' });
      setModalOpen(true);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    if (!selectedCustomer || isQrGuest(selectedCustomer) || !can('sales.view')) {
      setCustomerSales([]);
      setCustomerSalesLoading(false);
      return;
    }
    setCustomerSalesLoading(true);
    void (async () => {
      try {
        let query = supabase
          .from('sales')
          .select('id, invoice_number, total, refunded_amount, status, created_at')
          .eq('customer_id', selectedCustomer.id)
          .eq('is_archived', false)
          .order('created_at', { ascending: false })
          .limit(30);
        if (branchScope.selectedBranchIds.length) {
          query = query.in('branch_id', branchScope.selectedBranchIds);
        }
        const { data, error } = await query;
        if (!active) return;
        if (error || !Array.isArray(data)) setCustomerSales([]);
        else setCustomerSales(data as CustomerSaleSummary[]);
      } finally {
        if (active) setCustomerSalesLoading(false);
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomer?.id, branchScope.scopeKey]);

  useEffect(() => {
    if (!selectedCustomer) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedCustomer(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedCustomer]);

  const openAdd = () => { setEditing(null); setBusinessAttributes({}); setForm({ name: '', name_en: '', phone: '', email: '', address: '', tax_number: '', balance: 0, notes: '', branch_id: branchFilter || '' }); setModalOpen(true); };
  const openEdit = (c: Customer) => { setEditing(c); setBusinessAttributes(((c as Customer & { business_attributes?: Record<string, unknown> }).business_attributes) || {}); setForm({ name: c.name, name_en: c.name_en || '', phone: c.phone || '', email: c.email || '', address: c.address || '', tax_number: c.tax_number || '', balance: c.balance, notes: c.notes || '', branch_id: c.branch_id || branchFilter || '' }); setModalOpen(true); };

  const save = async () => {
    if (!form.name) { show(t('required'), 'error'); return; }
    const payload = { ...form, branch_id: branchFilter || form.branch_id || null, business_attributes: businessAttributes };
    if (editing) {
      const { error } = await supabase.from('customers').update(payload).eq('id', editing.id);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('update', 'customers', editing.id);
      if (selectedCustomer?.id === editing.id) {
        setSelectedCustomer((prev) => (prev ? { ...prev, ...payload } : null));
      }
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
    const removedId = deleteId;
    const { error } = await supabase.from('customers').delete().eq('id', removedId);
    if (error) show(error.message, 'error');
    else {
      show(t('deleteSuccess'), 'success');
      await logAudit('delete', 'customers', removedId);
      if (selectedCustomer?.id === removedId) setSelectedCustomer(null);
    }
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

  const registeredCount = useMemo(() => allRows.filter((row) => !isQrGuest(row)).length, [allRows]);
  const qrCount = useMemo(() => allRows.filter((row) => isQrGuest(row)).length, [allRows]);
  const outstandingRows = useMemo(() => allRows.filter((row) => !isQrGuest(row) && balanceFor(row) > 0), [allRows, balanceFor]);
  const totalOpenBalance = useMemo(
    () => outstandingRows.reduce((sum, row) => sum + balanceFor(row), 0),
    [outstandingRows, balanceFor],
  );
  const ar = lang === 'ar';

  return (
    <DesignSurface testId="customers-page">
      {record.id && <RecordFocus onClear={record.clear} />}
      <DesignPageHeader
        title={customerLabel}
        subtitle={ar ? 'العملاء المسجلون وضيوف QR والأرصدة المفتوحة' : 'Registered accounts, QR shoppers and open balances'}
        actions={
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

      {!supportOpen && (
        <section className="premier-refresh-stagger grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title={ar ? 'إجمالي العملاء' : 'Total customers'}
            value={formatNumber(allRows.length, 0)}
            icon={<Users className="h-4 w-4" />}
            color="brand"
            trend={ar ? `${registeredCount} مسجل` : `${registeredCount} registered`}
          />
          <StatCard
            title={ar ? 'الحسابات المسجلة' : 'Registered accounts'}
            value={formatNumber(registeredCount, 0)}
            icon={<UserCheck className="h-4 w-4" />}
            color="green"
          />
          <StatCard
            title={ar ? 'ضيوف QR' : 'QR guests'}
            value={formatNumber(qrCount, 0)}
            icon={<QrCode className="h-4 w-4" />}
            color="blue"
          />
          <StatCard
            title={ar ? 'أرصدة مستحقة' : 'On account, unpaid'}
            value={formatCurrency(totalOpenBalance, currency, lang)}
            icon={<Wallet className="h-4 w-4" />}
            color="amber"
            trend={outstandingRows.length > 0 ? (ar ? `${outstandingRows.length} حساب` : `${outstandingRows.length} open`) : undefined}
          />
        </section>
      )}

      {supportOpen && can('customers.manage') && branchFilter ? (
        <DesignPanel testId="customers-support-panel">
          <CustomerSupportInbox key={branchFilter} branchId={branchFilter} />
        </DesignPanel>
      ) : <DesignPanel testId="customers-table-panel" bodyClassName="p-4 sm:p-5">
        <WorkspaceControls><div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2" role="tablist" aria-label={ar ? 'عرض العملاء' : 'Customer views'}>
            {([
              { key: 'all', ar: 'الكل', en: 'All customers', count: allRows.length },
              { key: 'registered', ar: 'المسجلون', en: 'Registered', count: registeredCount },
              { key: 'qr', ar: 'عملاء QR', en: 'QR guests', count: qrCount },
              { key: 'outstanding', ar: 'أرصدة مستحقة', en: 'Outstanding', count: outstandingRows.length },
            ] as const).map((tab) => {
              const active = customerView === tab.key;
              return (
                <button
                  type="button"
                  role="tab"
                  key={tab.key}
                  aria-selected={active}
                  onClick={() => setCustomerView(tab.key)}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-1.5 text-[13px] font-semibold transition-all ${
                    active
                      ? 'border-ui-text bg-ui-text text-ui-surface shadow-ui-sm'
                      : 'border-ui-border bg-ui-surface text-ui-muted hover:border-ui-border-strong hover:text-ui-text'
                  }`}
                >
                  <span>{tab[lang]}</span>
                  <span className={`tabular-nums text-[11px] ${active ? 'opacity-75' : 'text-ui-subtle'}`}>{tab.count}</span>
                </button>
              );
            })}
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-initial">
            <DesignSearch value={search} onChange={setSearch}
              placeholder={ar ? 'بحث بالاسم أو الهاتف…' : 'Name, phone or city…'}
              label={t('search')} testId="customers-search" className="min-w-0 w-full sm:w-56 xl:w-64" />
            <label className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-ui-border bg-ui-surface px-3 text-xs font-semibold text-ui-muted shadow-ui-sm">
              <ArrowUpDown className="h-3.5 w-3.5 text-ui-subtle" />
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as 'recent' | 'name' | 'balance')}
                aria-label={ar ? 'ترتيب حسب' : 'Sort by'}
                className="bg-transparent text-xs font-semibold text-ui-text outline-none"
              >
                <option value="recent">{ar ? 'الأحدث' : 'Most recent'}</option>
                <option value="name">{ar ? 'الاسم أ-ي' : 'Name A–Z'}</option>
                <option value="balance">{ar ? 'الأعلى رصيداً' : 'Open balance'}</option>
              </select>
            </label>
            <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ui-border bg-ui-page-alt p-1" role="group" aria-label={ar ? 'طريقة العرض' : 'View mode'}>
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                aria-pressed={viewMode === 'cards'}
                title={ar ? 'عرض البطاقات' : 'Cards view'}
                className={`grid h-8 w-8 place-items-center rounded-full transition-all ${viewMode === 'cards' ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm' : 'text-ui-muted hover:text-ui-text'}`}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('rows')}
                aria-pressed={viewMode === 'rows'}
                title={ar ? 'قائمة مضغوطة' : 'Compact list'}
                className={`grid h-8 w-8 place-items-center rounded-full transition-all ${viewMode === 'rows' ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm' : 'text-ui-muted hover:text-ui-text'}`}
              >
                <Rows3 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                aria-pressed={viewMode === 'list'}
                title={ar ? 'عرض الجدول' : 'Table view'}
                className={`grid h-8 w-8 place-items-center rounded-full transition-all ${viewMode === 'list' ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm' : 'text-ui-muted hover:text-ui-text'}`}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div></WorkspaceControls>
        {qrLoading && <p role="status" className="mb-2 text-xs text-ui-muted">{ar ? 'جارٍ تحميل عملاء QR...' : 'Loading QR customers...'}</p>}
        {qrLoadError && <p role="alert" className="mb-2 text-xs text-ui-danger">
          {ar ? 'تعذر تحميل عملاء QR؛ تظهر سجلات العملاء المسجلين فقط. ' : 'Could not load QR customers; showing registered customers only. '}{qrLoadError}
        </p>}
        {viewMode === 'cards' ? (
          loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="h-48 animate-pulse rounded-[20px] border border-ui-border bg-ui-page-alt" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-ui-border bg-ui-page-alt/60 py-14 text-center text-sm text-ui-muted">
              {t('noData')}
            </div>
          ) : (
            <div className="premier-refresh-stagger grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((c) => {
                const qrGuest = isQrGuest(c);
                const balance = qrGuest ? 0 : balanceFor(c);
                const maxBal = Math.max(1, totalOpenBalance);
                const branchName = branches.find((b) => b.id === c.branch_id)?.name || '—';
                return (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (c.qrHistory) setSelectedQrGuest(c.qrHistory);
                      else setSelectedCustomer(c);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        if (c.qrHistory) setSelectedQrGuest(c.qrHistory);
                        else setSelectedCustomer(c);
                      }
                    }}
                    className="premier-refresh-subcard group flex h-full min-w-0 cursor-pointer flex-col justify-between overflow-hidden p-4 text-start focus-visible:outline-2 focus-visible:outline-ui-primary"
                  >
                    <div>
                      <div className="flex items-start gap-3">
                        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${avatarTone(c.id || c.name)}`}>
                          {customerInitials(c.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-[15px] font-semibold text-ui-text group-hover:text-ui-primary">{c.name}</h3>
                          <p className="truncate text-xs text-ui-muted">{c.phone || c.name_en || c.email || '—'}</p>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center gap-1.5 text-xs text-ui-muted">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-ui-subtle" />
                        <span className="truncate">{c.address || branchName}</span>
                      </div>

                      <div className="mt-3 flex min-h-[26px] flex-wrap items-center gap-1.5">
                        <Badge variant={qrGuest ? 'info' : 'success'} size="sm">
                          {qrGuest ? 'QR' : (ar ? 'مسجل' : 'Registered')}
                        </Badge>
                        {!qrGuest && balance > 0 && (
                          <Badge variant="warning" size="sm">
                            {ar ? 'رصيد مستحق' : 'Unpaid'}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="mt-3.5">
                      <div className="grid grid-cols-2 gap-3 border-t border-ui-border pt-3">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-medium text-ui-subtle">{qrGuest ? (ar ? 'مشتريات QR' : 'QR purchases') : (ar ? 'الرصيد المستحق' : 'Open balance')}</p>
                          <p className={`mt-0.5 truncate text-sm font-bold tabular-nums ${balance > 0 ? 'text-ui-danger' : 'text-ui-text'}`}>
                            {qrGuest ? formatNumber(c.qrHistory?.purchase_count || 0, 0) : formatCurrency(balance, currency, lang)}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-medium text-ui-subtle">{t('branch')}</p>
                          <p className="mt-0.5 truncate text-sm font-semibold text-ui-text">{branchName}</p>
                        </div>
                      </div>
                      <div className="mt-2.5 min-h-[6px]">
                        {!qrGuest && balance > 0 && (
                          <WorkspaceMeter value={balance} max={maxBal} tone="warning" height="xs" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : viewMode === 'rows' ? (
          loading ? (
            <div className="space-y-2.5">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="h-16 animate-pulse rounded-[16px] border border-ui-border bg-ui-page-alt" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-ui-border bg-ui-page-alt/60 py-14 text-center text-sm text-ui-muted">
              {t('noData')}
            </div>
          ) : (
            <div className="premier-refresh-stagger space-y-2.5">
              {filtered.map((c) => {
                const qrGuest = isQrGuest(c);
                const balance = qrGuest ? 0 : balanceFor(c);
                const branchName = branches.find((b) => b.id === c.branch_id)?.name || '—';
                return (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (c.qrHistory) setSelectedQrGuest(c.qrHistory);
                      else setSelectedCustomer(c);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        if (c.qrHistory) setSelectedQrGuest(c.qrHistory);
                        else setSelectedCustomer(c);
                      }
                    }}
                    className="premier-refresh-subcard group grid cursor-pointer grid-cols-1 items-center gap-3 rounded-[16px] px-4 py-3 text-start sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_minmax(0,0.9fr)]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarTone(c.id || c.name)}`}>
                        {customerInitials(c.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ui-text group-hover:text-ui-primary">{c.name}</p>
                        <p className="truncate text-xs text-ui-muted">{c.phone || c.name_en || c.email || '—'}</p>
                      </div>
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5 text-xs text-ui-muted">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-ui-subtle" />
                      <span className="truncate">{c.address || branchName}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={qrGuest ? 'info' : 'success'} size="sm">{qrGuest ? 'QR' : (ar ? 'مسجل' : 'Registered')}</Badge>
                      {!qrGuest && balance > 0 && <Badge variant="warning" size="sm">{ar ? 'مستحق' : 'Unpaid'}</Badge>}
                    </div>
                    <div className="text-start sm:text-end">
                      <p className="text-[11px] text-ui-subtle">{qrGuest ? (ar ? 'مشتريات QR' : 'QR purchases') : (ar ? 'الرصيد' : 'Balance')}</p>
                      <p className={`text-sm font-bold tabular-nums ${balance > 0 ? 'text-ui-danger' : 'text-ui-text'}`}>
                        {qrGuest ? formatNumber(c.qrHistory?.purchase_count || 0, 0) : formatCurrency(balance, currency, lang)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
        <DataTable
          tableId="customers"
          columns={columns}
          data={filtered}
          loading={loading}
          emptyMessage={t('noData')}
          onRowClick={(row) => {
            if (row.qrHistory) setSelectedQrGuest(row.qrHistory);
            else setSelectedCustomer(row);
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
              ...qrGuests.filter((guest) => !record.id && branchScope.selectedBranchSet.has(guest.branch_id)).map(toQrCustomerRow),
            ];
            return combined.filter((customer) => matchesCustomerView(customer) &&
              (!term || customer.name.toLowerCase().includes(term) || customer.phone?.includes(term)));
          }}
          templateFilename="customers-template"
        />
        )}
        <DesignPagination loaded={allRows.length} total={total + qrGuests.length} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>}

      {selectedCustomer && (
        <div className="fixed inset-0 z-[75] flex justify-end p-2.5 sm:p-3.5" dir={ar ? 'rtl' : 'ltr'}>
          <div className="absolute inset-0 bg-ui-text/30 backdrop-blur-sm" onClick={() => setSelectedCustomer(null)} aria-hidden="true" />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={selectedCustomer.name}
            className="premier-refresh-drawer relative z-10 flex h-full w-full max-w-[480px] flex-col overflow-hidden"
          >
            <div className="flex items-start justify-between gap-3 border-b border-ui-border px-6 py-5">
              <div className="flex min-w-0 items-center gap-3.5">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold ${avatarTone(selectedCustomer.id || selectedCustomer.name)}`}>
                  {customerInitials(selectedCustomer.name)}
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold text-ui-text">{selectedCustomer.name}</h2>
                  <p className="truncate text-xs text-ui-muted">
                    {selectedCustomer.name_en ? `${selectedCustomer.name_en} · ` : ''}
                    {branches.find((b) => b.id === selectedCustomer.branch_id)?.name || '—'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                aria-label={ar ? 'إغلاق' : 'Close'}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-ui-border bg-ui-page-alt text-ui-muted hover:text-ui-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
              <div className="flex flex-wrap gap-2">
                <Badge variant="success">{ar ? 'عميل مسجل' : 'Registered account'}</Badge>
                {balanceFor(selectedCustomer) > 0 && <Badge variant="warning">{ar ? 'رصيد مستحق' : 'Unpaid balance'}</Badge>}
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <div className="rounded-[16px] border border-ui-border bg-ui-page-alt p-3.5 sm:col-span-2">
                  <div className="flex items-center gap-2 text-xs text-ui-muted">
                    <Mail className="h-3.5 w-3.5 text-ui-primary" />
                    <span>{t('emailField')}</span>
                  </div>
                  <p className="mt-1 truncate text-sm font-semibold text-ui-text">{selectedCustomer.email || '—'}</p>
                </div>
                <div className="rounded-[16px] border border-ui-border bg-ui-page-alt p-3.5">
                  <div className="flex items-center gap-2 text-xs text-ui-muted">
                    <Phone className="h-3.5 w-3.5 text-ui-primary" />
                    <span>{t('phone')}</span>
                  </div>
                  <p dir="auto" className="mt-1 truncate text-sm font-semibold text-ui-text tabular-nums">{selectedCustomer.phone || '—'}</p>
                </div>
                <div className="rounded-[16px] border border-ui-border bg-ui-page-alt p-3.5">
                  <div className="flex items-center gap-2 text-xs text-ui-muted">
                    <MapPin className="h-3.5 w-3.5 text-ui-primary" />
                    <span>{t('address')}</span>
                  </div>
                  <p className="mt-1 truncate text-sm font-semibold text-ui-text">{selectedCustomer.address || '—'}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-[16px] border border-ui-border bg-ui-surface p-3.5 shadow-ui-sm">
                  <p className="text-xs text-ui-muted">{ar ? 'الرصيد المستحق' : 'Open balance'}</p>
                  <p className={`mt-1 text-xl font-bold tabular-nums ${balanceFor(selectedCustomer) > 0 ? 'text-ui-danger' : 'text-ui-text'}`}>
                    {formatCurrency(balanceFor(selectedCustomer), currency, lang)}
                  </p>
                </div>
                <div className="rounded-[16px] border border-ui-border bg-ui-surface p-3.5 shadow-ui-sm">
                  <p className="text-xs text-ui-muted">{ar ? 'الرقم الضريبي' : 'Tax number'}</p>
                  <p className="mt-1 truncate text-base font-bold text-ui-text tabular-nums">{selectedCustomer.tax_number || '—'}</p>
                </div>
                {can('sales.view') && (
                  <>
                    <div className="rounded-[16px] border border-ui-border bg-ui-surface p-3.5 shadow-ui-sm">
                      <p className="text-xs text-ui-muted">{ar ? 'إجمالي المشتريات' : 'Lifetime spend'}</p>
                      <p className="mt-1 text-xl font-bold text-ui-text tabular-nums">
                        {formatCurrency(
                          customerSales.reduce((sum, s) => sum + Math.max(0, Number(s.total || 0) - Number(s.refunded_amount || 0)), 0),
                          currency,
                          lang,
                        )}
                      </p>
                    </div>
                    <div className="rounded-[16px] border border-ui-border bg-ui-surface p-3.5 shadow-ui-sm">
                      <p className="text-xs text-ui-muted">{ar ? 'عدد الفواتير' : 'Orders'}</p>
                      <p className="mt-1 text-lg font-bold text-ui-text tabular-nums">{formatNumber(customerSales.length, 0)}</p>
                    </div>
                  </>
                )}
              </div>

              {can('sales.view') && (() => {
                const now = new Date();
                const buckets = Array.from({ length: 6 }, (_, idx) => {
                  const d = new Date(now.getFullYear(), now.getMonth() - (5 - idx), 1);
                  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                  return {
                    key,
                    label: d.toLocaleDateString(ar ? 'ar-EG' : 'en-US', { month: 'short' }),
                    value: 0,
                  };
                });
                const map = new Map(buckets.map((b) => [b.key, b]));
                customerSales.forEach((sale) => {
                  const key = sale.created_at.slice(0, 7);
                  const bucket = map.get(key);
                  if (bucket) bucket.value += Math.max(0, Number(sale.total || 0) - Number(sale.refunded_amount || 0));
                });
                const peak = Math.max(1, ...buckets.map((b) => b.value));
                return (
                  <div className="rounded-[18px] border border-ui-border bg-ui-page-alt p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs font-bold text-ui-text">{ar ? 'الإنفاق الشهري (آخر 6 أشهر)' : 'Monthly spend (6 months)'}</p>
                      {customerSalesLoading && <span className="text-[11px] text-ui-muted">{ar ? 'جارٍ التحميل...' : 'Loading...'}</span>}
                    </div>
                    <div className="grid grid-cols-6 items-end gap-2">
                      {buckets.map((b) => (
                        <div key={b.key} className="flex flex-col items-center gap-1.5">
                          <div className="flex h-20 w-full items-end overflow-hidden rounded-[10px] bg-ui-surface p-0.5">
                            <div
                              className="w-full rounded-[8px] bg-ui-primary transition-all"
                              style={{ height: `${b.value > 0 ? Math.max(12, Math.round((b.value / peak) * 100)) : 4}%`, opacity: b.value > 0 ? 1 : 0.2 }}
                              title={`${b.label}: ${formatCurrency(b.value, currency, lang)}`}
                            />
                          </div>
                          <span className="text-[10px] font-semibold text-ui-muted">{b.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {can('sales.view') && customerSales.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-ui-text">{ar ? 'أحدث الفواتير' : 'Recent orders'}</p>
                  {customerSales.slice(0, 5).map((sale) => (
                    <Link
                      key={sale.id}
                      to={`${APP_ROUTES.sales}?saleId=${encodeURIComponent(sale.id)}`}
                      onClick={() => setSelectedCustomer(null)}
                      className="group flex items-center justify-between gap-3 rounded-[14px] border border-ui-border bg-ui-page-alt px-3.5 py-2.5 text-xs transition hover:border-ui-primary/40 hover:bg-ui-surface"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-bold text-ui-text tabular-nums group-hover:text-ui-primary">{sale.invoice_number || sale.id.slice(0, 8)}</p>
                        <p className="text-[11px] text-ui-muted tabular-nums">{new Date(sale.created_at).toLocaleDateString(ar ? 'ar-EG' : 'en-US')}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={sale.status === 'returned' ? 'danger' : 'success'} size="sm">{sale.status || 'completed'}</Badge>
                        <span className="font-bold text-ui-text tabular-nums">
                          {formatCurrency(Math.max(0, Number(sale.total || 0) - Number(sale.refunded_amount || 0)), currency, lang)}
                        </span>
                        <ArrowUpRight className="h-3.5 w-3.5 text-ui-subtle group-hover:text-ui-primary" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {selectedCustomer.notes && (
                <div className="rounded-[16px] border border-ui-border bg-ui-page-alt p-3.5">
                  <p className="text-xs font-semibold text-ui-muted">{t('notes')}</p>
                  <p className="mt-1 text-sm text-ui-text">{selectedCustomer.notes}</p>
                </div>
              )}
            </div>

            {can('customers.manage') && (
              <div className="flex items-center gap-2.5 border-t border-ui-border bg-ui-surface px-6 py-4">
                <Button
                  className="flex-1"
                  onClick={() => {
                    const target = selectedCustomer;
                    setSelectedCustomer(null);
                    openEdit(target);
                  }}
                >
                  <Edit2 className="h-4 w-4" />
                  <span>{t('edit')}</span>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const id = selectedCustomer.id;
                    setSelectedCustomer(null);
                    setDeleteId(id);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-ui-danger" />
                  <span>{t('delete')}</span>
                </Button>
              </div>
            )}
          </aside>
        </div>
      )}
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