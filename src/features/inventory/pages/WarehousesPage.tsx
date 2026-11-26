import { useState } from 'react';
import { Plus, Edit2, Trash2, Warehouse as WarehouseIcon, CheckCircle2, MapPin } from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader } from '@/components/design/DesignSurface';
import { DesignPanel } from '@/components/design/DesignPanel';
import { DesignPagination } from '@/components/design/DesignPagination';
import { DataTable, type Column } from '@/components/DataTable';
import { StatCard } from '@/components/PageHeader';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { BranchBadge } from '@/components/BranchBadge';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import { useGuidedWorkflow } from '@/core/guard';
import type { Warehouse, Branch } from '@/lib/types';

export function WarehousesPage() {
  const { t, lang } = useLanguage();
  const ar = lang === 'ar';
  const { show } = useToast();
  const can = useCan();
  const branchFilter = useBranchFilter();
  const { guidedContext, completePrerequisiteAndReturn } = useGuidedWorkflow();
  const { rows: items, loading, total, hasMore, loadMore, loadingMore, refresh: reloadWarehouses } = usePaginatedRows<Warehouse>({
    table: 'warehouses',
    select: '*, branch:branches(*)',
    order: { column: 'created_at', ascending: false },
    branch_id: branchFilter,
    pageSize: 100,
  });
  const { branches } = useBranches();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', branch_id: '', address: '', is_active: true });

  const openAdd = () => { setEditing(null); setForm({ name: '', branch_id: branchFilter || '', address: '', is_active: true }); setModalOpen(true); };
  const openEdit = (w: Warehouse) => { setEditing(w); setForm({ name: w.name, branch_id: w.branch_id || '', address: w.address || '', is_active: w.is_active }); setModalOpen(true); };

  const save = async () => {
    if (!form.name) { show(t('required'), 'error'); return; }
    const payload = { ...form, branch_id: branchFilter || form.branch_id || null };
    if (editing) {
      const { error } = await supabase.from('warehouses').update(payload).eq('id', editing.id);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('update', 'warehouses', editing.id);
    } else {
      const { error } = await supabase.from('warehouses').insert(payload);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('create', 'warehouses');
    }
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadWarehouses();

    if (!editing && guidedContext?.missingStep.key.includes('warehouse')) {
      setTimeout(() => {
        completePrerequisiteAndReturn();
      }, 500);
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('warehouses').delete().eq('id', deleteId);
    if (error) show(error.message, 'error');
    else { show(t('deleteSuccess'), 'success'); await logAudit('delete', 'warehouses', deleteId); }
    setDeleteId(null);
    reloadWarehouses();
  };

  const columns: Column<Warehouse>[] = [
    { key: 'name', header: t('name'), render: (w) => <span className="font-medium text-ui-text">{w.name}</span> },
    { key: 'branch', header: t('branch'), render: (w) => <BranchBadge name={(w as Warehouse & { branch?: Branch }).branch?.name || '-'} /> },
    { key: 'address', header: t('address'), render: (w) => w.address || '-' },
    { key: 'is_active', header: t('status'), render: (w) => (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${w.is_active ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-page-alt text-ui-subtle dark:text-ui-subtle'}`}>
        {w.is_active ? t('active') : t('inactive')}
      </span>
    )},
    { key: 'actions', header: t('actions'), render: (w) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        {can('warehouses.manage') && (
          <button onClick={() => openEdit(w)} className="ui-icon-action ui-icon-action-info"><Edit2 className="w-4 h-4" /></button>
        )}
        {can('warehouses.manage') && (
          <button onClick={() => setDeleteId(w.id)} className="ui-icon-action ui-icon-action-danger"><Trash2 className="w-4 h-4" /></button>
        )}
      </div>
    )},
  ];

  const activeCount = items.filter((w) => w.is_active).length;

  return (
    <DesignSurface testId="warehouses-page">
      <DesignPageHeader
        title={t('warehouses')}
        subtitle={ar ? 'مواقع التخزين والفروع وحالة التفعيل' : 'Storage locations, branches and site status'}
        actions={
        can('warehouses.manage') && <Button size="sm" onClick={openAdd} data-testid="warehouses-add"><Plus className="w-4 h-4" /> {t('add')}</Button>
      } />
      <section className="grid gap-3.5 sm:grid-cols-3">
        <StatCard
          title={ar ? 'إجمالي المستودعات' : 'Total locations'}
          value={String(items.length)}
          icon={<WarehouseIcon className="h-4 w-4" />}
          color="brand"
        />
        <StatCard
          title={ar ? 'مستودعات نشطة' : 'Active sites'}
          value={String(activeCount)}
          icon={<CheckCircle2 className="h-4 w-4" />}
          color="green"
        />
        <StatCard
          title={ar ? 'غير نشطة' : 'Inactive'}
          value={String(Math.max(0, items.length - activeCount))}
          icon={<MapPin className="h-4 w-4" />}
          color="amber"
        />
      </section>
      {items.length > 0 && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.slice(0, 6).map((w) => {
            const branchName = (w as Warehouse & { branch?: Branch }).branch?.name || '-';
            return (
              <div
                key={w.id}
                onClick={can('warehouses.manage') ? () => openEdit(w) : undefined}
                className={`rounded-[22px] border border-ui-border bg-ui-surface p-5 shadow-ui transition hover:border-ui-primary/40 ${can('warehouses.manage') ? 'cursor-pointer' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-ui-primary-soft text-ui-primary">
                      <WarehouseIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-[15px] font-bold text-ui-text">{w.name}</h3>
                      <p className="truncate text-xs text-ui-muted">{branchName}</p>
                    </div>
                  </div>
                  <Badge variant={w.is_active ? 'success' : 'default'} size="sm">
                    {w.is_active ? t('active') : t('inactive')}
                  </Badge>
                </div>
                <div className="mt-3.5 flex items-center gap-1.5 text-xs text-ui-muted">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-ui-subtle" />
                  <span className="truncate">{w.address || '—'}</span>
                </div>
              </div>
            );
          })}
        </section>
      )}
      <DesignPanel testId="warehouses-table-panel">
        <DataTable columns={columns} data={items} loading={loading} emptyMessage={t('noData')} onRowClick={can('warehouses.manage') ? openEdit : undefined} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('edit') : t('add')}>
        <div className="space-y-4">
          <Input label={t('name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          {!branchFilter && (
            <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
              <option value="">--</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
          <Input label={t('address')} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Select label={t('status')} value={form.is_active ? '1' : '0'} onChange={(e) => setForm({ ...form, is_active: e.target.value === '1' })}>
            <option value="1">{t('active')}</option>
            <option value="0">{t('inactive')}</option>
          </Select>
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
