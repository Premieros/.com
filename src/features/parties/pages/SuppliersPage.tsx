import { RecordFocus, useRecordFocus } from '@/components/RecordFocus';
import { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, Trophy, FileText, Building2, Wallet, MapPin, LayoutGrid, List } from 'lucide-react';
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
import { formatDate, formatCurrency } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranchScope } from '@/lib/branchScope';
import { useCan } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import { useGuidedWorkflow } from '@/core/guard';
import { SupplierStatementModal } from '../components/SupplierStatementModal';
import type { ApAgingRow, Supplier, SupplierEvaluationRow } from '@/lib/types';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';

export function SuppliersPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const record = useRecordFocus();
  const branchFilter = useBranchFilter();
  const branchScope = useBranchScope();
  const { runtime } = useOrganizationModules();
  const supplierLabel = runtime.terminology.supplier[lang === 'ar' ? 'ar' : 'en'];
  const { guidedContext, completePrerequisiteAndReturn } = useGuidedWorkflow();
  const { rows: items, loading, total, hasMore, loadMore, loadingMore, refresh: reloadSuppliers, fetchAll: fetchAllSuppliers } = usePaginatedRows<Supplier>({
    table: 'suppliers',
    filters: record.id ? [{ column: 'id', value: record.id }] : undefined,
    select: '*',
    order: { column: 'created_at', ascending: false },
    branch_ids: branchScope.selectedBranchIds,
    pageSize: 100,
  });
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [statementSupplier, setStatementSupplier] = useState<Supplier | null>(null);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [evaluation, setEvaluation] = useState<SupplierEvaluationRow[]>([]);
  const [evLoading, setEvLoading] = useState(false);
  const [openBalances, setOpenBalances] = useState<Record<string, number>>({});
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';
  const [form, setForm] = useState({ name: '', name_en: '', phone: '', email: '', address: '', tax_number: '', balance: 0, notes: '', branch_id: '' });
  const [businessAttributes, setBusinessAttributes] = useState<Record<string, unknown>>({});

  const { selectedBranchIds, scopeKey } = branchScope;
  useEffect(() => {
    let cancelled = false;
    const loadOpenBalances = async () => {
      if (!selectedBranchIds.length) {
        if (!cancelled) setOpenBalances({});
        return;
      }
      const results = await Promise.all(
        selectedBranchIds.map((branchId) => api.accounting.getApAging({ p_branch_id: branchId, p_as_of: new Date().toISOString().slice(0, 10) })),
      );
      const next: Record<string, number> = {};
      results.forEach(({ data }) => {
        ((data as ApAgingRow[]) || []).forEach((row) => { next[row.supplier_id] = Number(row.open_amount || 0); });
      });
      if (!cancelled) setOpenBalances(next);
    };
    void loadOpenBalances();
    return () => { cancelled = true; };
  }, [scopeKey, selectedBranchIds]);

  const balanceFor = (supplier: Supplier) => Number(openBalances[supplier.id] || 0);
  const filtered = items.filter((s) => record.id ? s.id === record.id : !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.phone?.includes(search));
  const openAdd = () => { setEditing(null); setBusinessAttributes({}); setForm({ name: '', name_en: '', phone: '', email: '', address: '', tax_number: '', balance: 0, notes: '', branch_id: branchFilter || '' }); setModalOpen(true); };
  const openEdit = (s: Supplier) => { setEditing(s); setBusinessAttributes(((s as Supplier & { business_attributes?: Record<string, unknown> }).business_attributes) || {}); setForm({ name: s.name, name_en: s.name_en || '', phone: s.phone || '', email: s.email || '', address: s.address || '', tax_number: s.tax_number || '', balance: s.balance, notes: s.notes || '', branch_id: s.branch_id || branchFilter || '' }); setModalOpen(true); };

  const save = async () => {
    if (!form.name) { show(t('required'), 'error'); return; }
    const payload = { ...form, branch_id: branchFilter || form.branch_id || null, business_attributes: businessAttributes };
    if (editing) {
      const { error } = await supabase.from('suppliers').update(payload).eq('id', editing.id);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('update', 'suppliers', editing.id);
    } else {
      const { error } = await supabase.from('suppliers').insert(payload);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('create', 'suppliers');
    }
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadSuppliers();

    if (!editing && guidedContext?.missingStep.key.includes('supplier')) {
      setTimeout(() => { completePrerequisiteAndReturn(); }, 500);
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('suppliers').delete().eq('id', deleteId);
    if (error) show(error.message, 'error');
    else { show(t('deleteSuccess'), 'success'); await logAudit('delete', 'suppliers', deleteId); }
    setDeleteId(null);
    reloadSuppliers();
  };

  const loadEvaluation = async () => {
    setEvLoading(true);
    const { data } = await api.procurement.getSupplierEvaluation({ p_branch_id: branchFilter || null });
    setEvaluation(((data as SupplierEvaluationRow[]) || []).map((r) => ({ ...r, id: r.supplier_id })));
    setEvLoading(false);
  };

  const toggleEvaluation = () => {
    const next = !showEvaluation;
    setShowEvaluation(next);
    if (next) loadEvaluation();
  };

  const columns: Column<Supplier>[] = [
    { key: 'name', header: t('name'), render: (s) => <span className="font-medium text-ui-text">{s.name}</span> },
    { key: 'branch', header: t('branch'), filterValue: (s) => branches.find((b) => b.id === s.branch_id)?.name || '', exportValue: (s) => branches.find((b) => b.id === s.branch_id)?.name || '', render: (s) => <BranchBadge name={branches.find((b) => b.id === s.branch_id)?.name || '-'} /> },
    { key: 'phone', header: t('phone'), render: (s) => s.phone || '-' },
    { key: 'email', header: t('emailField'), render: (s) => s.email || '-' },
    { key: 'address', header: t('address'), render: (s) => s.address || '-' },
    { key: 'balance', header: t('amount'), filterValue: balanceFor, exportValue: balanceFor, render: (s) => {
      const balance = balanceFor(s);
      return <span className={balance > 0 ? 'text-ui-danger font-medium' : ''}>{formatCurrency(balance, currency, lang)}</span>;
    } },
    { key: 'actions', header: t('actions'), filterable: false, render: (s) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => setStatementSupplier(s)}
          className="p-1.5 rounded-md hover:bg-ui-primary-soft text-ui-primary"
          title={lang === 'ar' ? 'كشف حساب المورد' : 'Supplier statement'}
          data-testid={`supplier-statement-${s.id}`}
        ><FileText className="w-4 h-4" /></button>
        {can('suppliers.manage') && (
          <button onClick={() => openEdit(s)} className="ui-icon-action ui-icon-action-info"><Edit2 className="w-4 h-4" /></button>
        )}
        {can('suppliers.manage') && (
          <button onClick={() => setDeleteId(s.id)} className="ui-icon-action ui-icon-action-danger"><Trash2 className="w-4 h-4" /></button>
        )}
      </div>
    )},
  ];

  const evaluationColumns: Column<SupplierEvaluationRow>[] = [
    { key: 'supplier_name', header: t('supplier'), render: (r) => <span className="font-medium text-ui-text">{r.supplier_name}</span> },
    { key: 'orders_count', header: t('ordersCount'), render: (r) => r.orders_count },
    { key: 'total_purchased', header: t('totalPurchases'), render: (r) => <span className="font-semibold">{formatCurrency(r.total_purchased, currency, lang)}</span> },
    { key: 'total_returned', header: t('totalReturned'), render: (r) => formatCurrency(r.total_returned, currency, lang) },
    { key: 'return_rate', header: t('returnRate'), render: (r) => `${r.return_rate}%` },
    { key: 'avg_order_value', header: t('avgOrderValue'), render: (r) => formatCurrency(r.avg_order_value, currency, lang) },
    { key: 'quotations_count', header: t('quotationsCount'), render: (r) => r.quotations_count },
    { key: 'last_purchase_at', header: t('lastPurchaseAt'), render: (r) => (r.last_purchase_at ? formatDate(r.last_purchase_at, lang) : '-') },
  ];

  const totalPayables = filtered.reduce((sum, s) => sum + Math.max(0, balanceFor(s)), 0);
  const unpaidSuppliers = filtered.filter((s) => balanceFor(s) > 0).length;
  const ar = lang === 'ar';

  return (
    <DesignSurface testId="suppliers-page">
      {record.id && <RecordFocus onClear={record.clear} />}
      <DesignPageHeader
        title={supplierLabel}
        subtitle={ar ? 'إدارة الموردين والأرصدة المستحقة وكشوف الحساب' : 'Manage suppliers, open payables and account statements'}
        actions={
        <>
          {can('purchases.evaluation') && (
            <Button variant="outline" size="sm" onClick={toggleEvaluation} data-testid="suppliers-evaluation"><Trophy className="w-4 h-4" /> {t('supplierEvaluation')}</Button>
          )}
          {can('suppliers.manage') && (
            <Button size="sm" onClick={openAdd} data-testid="suppliers-add"><Plus className="w-4 h-4" /> {t('add')}</Button>
          )}
        </>
      } />
      {showEvaluation ? (
        <DesignPanel testId="suppliers-evaluation-panel">
          <DataTable tableId="supplier-evaluation" columns={evaluationColumns} data={evaluation} loading={evLoading} emptyMessage={t('noData')} enableExport={can('purchases.evaluation')} exportFilename="supplier-evaluation" />
        </DesignPanel>
      ) : (
        <>
          <section className="premier-refresh-stagger grid gap-3.5 sm:grid-cols-3">
            <StatCard title={ar ? 'إجمالي الموردين' : 'Total suppliers'} value={String(filtered.length)} icon={<Building2 className="h-4 w-4" />} color="brand" />
            <StatCard title={ar ? 'أرصدة مستحقة للموردين' : 'Open payables'} value={formatCurrency(totalPayables, currency, lang)} icon={<Wallet className="h-4 w-4" />} color="amber" trend={unpaidSuppliers > 0 ? (ar ? `${unpaidSuppliers} مورد` : `${unpaidSuppliers} open`) : undefined} />
            <StatCard title={ar ? 'الفروع النشطة' : 'Branches'} value={String(branches.length)} icon={<MapPin className="h-4 w-4" />} color="green" />
          </section>
          <DesignPanel testId="suppliers-search-panel" bodyClassName="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <DesignSearch value={search} onChange={setSearch} placeholder={t('search')} label={t('search')} testId="suppliers-search" className="w-full sm:w-72" />
              <div className="inline-flex items-center gap-1 rounded-full border border-ui-border bg-ui-page-alt p-1" role="group" aria-label={ar ? 'طريقة العرض' : 'View mode'}>
                <button type="button" onClick={() => setViewMode('cards')} aria-pressed={viewMode === 'cards'} title={ar ? 'عرض البطاقات' : 'Cards view'} className={`grid h-8 w-8 place-items-center rounded-full transition-all ${viewMode === 'cards' ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm' : 'text-ui-muted hover:text-ui-text'}`}>
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => setViewMode('list')} aria-pressed={viewMode === 'list'} title={ar ? 'عرض الجدول' : 'Table view'} className={`grid h-8 w-8 place-items-center rounded-full transition-all ${viewMode === 'list' ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm' : 'text-ui-muted hover:text-ui-text'}`}>
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>
          </DesignPanel>
          <DesignPanel testId="suppliers-table-panel" bodyClassName="p-4 sm:p-5">
            {viewMode === 'cards' ? (
              loading ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, idx) => <div key={idx} className="h-44 animate-pulse rounded-[20px] border border-ui-border bg-ui-page-alt" />)}
                </div>
              ) : filtered.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-ui-border bg-ui-page-alt/60 py-14 text-center text-sm text-ui-muted">{t('noData')}</div>
              ) : (
                <div className="premier-refresh-stagger grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {filtered.map((s) => {
                    const balance = balanceFor(s);
                    const branchName = branches.find((b) => b.id === s.branch_id)?.name || '—';
                    return (
                      <article
                        key={s.id}
                        onClick={can('suppliers.manage') ? () => openEdit(s) : undefined}
                        className={`premier-refresh-subcard group flex h-full min-w-0 flex-col justify-between overflow-hidden p-4 ${can('suppliers.manage') ? 'cursor-pointer' : ''}`}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ui-primary-soft text-sm font-bold text-ui-primary">
                                {s.name.trim().slice(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <h3 className="truncate text-[15px] font-semibold text-ui-text group-hover:text-ui-primary">{s.name}</h3>
                                <p className="truncate text-xs text-ui-muted">{s.phone || s.email || '—'}</p>
                              </div>
                            </div>
                            {balance > 0 && <Badge variant="warning" size="sm" className="shrink-0">{ar ? 'مستحق' : 'Open'}</Badge>}
                          </div>
                          <div className="mt-3 flex items-center gap-1.5 text-xs text-ui-muted">
                            <MapPin className="h-3.5 w-3.5 shrink-0 text-ui-subtle" />
                            <span className="truncate">{s.address || branchName}</span>
                          </div>
                        </div>
                        <div className="mt-3.5">
                          <div className="grid grid-cols-2 gap-3 border-t border-ui-border pt-3">
                            <div className="min-w-0">
                              <p className="truncate text-[11px] font-medium text-ui-subtle">{t('amount')}</p>
                              <p className={`mt-0.5 truncate text-sm font-bold tabular-nums ${balance > 0 ? 'text-ui-danger' : 'text-ui-text'}`}>{formatCurrency(balance, currency, lang)}</p>
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-[11px] font-medium text-ui-subtle">{t('branch')}</p>
                              <p className="mt-0.5 truncate text-sm font-semibold text-ui-text">{branchName}</p>
                            </div>
                          </div>
                          {balance > 0 && totalPayables > 0 && (
                            <div className="mt-2.5">
                              <WorkspaceMeter value={balance} max={totalPayables} tone="warning" height="xs" />
                            </div>
                          )}
                          <div className="mt-3 flex items-center justify-end gap-1 border-t border-ui-border pt-2.5" onClick={(e) => e.stopPropagation()}>
                            <button type="button" onClick={() => setStatementSupplier(s)} className="ui-icon-action ui-icon-action-info" title={ar ? 'كشف حساب المورد' : 'Supplier statement'} data-testid={`supplier-statement-${s.id}`}>
                              <FileText className="h-4 w-4" />
                            </button>
                            {can('suppliers.manage') && <button type="button" onClick={() => openEdit(s)} className="ui-icon-action ui-icon-action-info"><Edit2 className="h-4 w-4" /></button>}
                            {can('suppliers.manage') && <button type="button" onClick={() => setDeleteId(s.id)} className="ui-icon-action ui-icon-action-danger"><Trash2 className="h-4 w-4" /></button>}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )
            ) : (
            <DataTable
              tableId="suppliers"
              columns={columns}
              data={filtered}
              loading={loading}
              emptyMessage={t('noData')}
              onRowClick={can('suppliers.manage') ? openEdit : undefined}
              enableExport={can('suppliers.manage')}
              enableTemplate={can('suppliers.manage')}
              exportFilename="suppliers"
              exportDataProvider={async () => {
                const all = await fetchAllSuppliers();
                const term = search.trim().toLowerCase();
                return term
                  ? all.filter((supplier) => supplier.name.toLowerCase().includes(term) || supplier.phone?.includes(search))
                  : all;
              }}
              templateFilename="suppliers-template"
            />
            )}
            <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
          </DesignPanel>
        </>
      )}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `${t('edit')} — ${supplierLabel}` : `${t('add')} — ${supplierLabel}`}>
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
          <BusinessAttributesFields entity="supplier" value={businessAttributes} onChange={setBusinessAttributes} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={save}>{t('save')}</Button>
          </div>
        </div>
      </Modal>
      <SupplierStatementModal
        open={!!statementSupplier}
        supplierId={statementSupplier?.id || null}
        branchId={statementSupplier?.branch_id || null}
        currency={currency}
        onClose={() => setStatementSupplier(null)}
      />
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={remove} title={t('delete')} message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} />
    </DesignSurface>
  );
}