import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/api';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { DesignPanel } from '@/components/design/DesignPanel';
import { DesignPageHeader, DesignSurface } from '@/components/design/DesignSurface';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useLanguage } from '@/context/LanguageContext';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { formatCurrency, formatDate } from '@/lib/format';

interface BusinessRecordRow {
  id: string;
  organization_id: string;
  branch_id: string | null;
  record_type: string;
  status: string;
  title: string;
  customer_id: string | null;
  supplier_id: string | null;
  product_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  amount: number | null;
  currency: string | null;
  attributes: Record<string, unknown>;
  notes: string | null;
  created_at: string;
}

interface OptionRow {
  id: string;
  name: string;
}

const EMPTY_FORM = {
  record_type: '',
  status: 'open',
  title: '',
  customer_id: '',
  supplier_id: '',
  product_id: '',
  starts_at: '',
  ends_at: '',
  amount: 0,
  currency: 'EGP',
  notes: '',
};

export function BusinessRecordsPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { show } = useToast();
  const { organizationId, runtime } = useOrganizationModules();
  const branchId = useBranchFilter();
  const [rows, setRows] = useState<BusinessRecordRow[]>([]);
  const [customers, setCustomers] = useState<OptionRow[]>([]);
  const [suppliers, setSuppliers] = useState<OptionRow[]>([]);
  const [products, setProducts] = useState<OptionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const recordTypes = useMemo(
    () => runtime.recordTypes,
    [runtime],
  );

  const typeMap = useMemo(
    () => new Map(recordTypes.map((type) => [type.key, type])),
    [recordTypes],
  );

  const load = useCallback(async () => {
    if (!organizationId) {
      setRows([]);
      return;
    }

    setLoading(true);
    const [recordsRes, customersRes, suppliersRes, productsRes] = await Promise.all([
      (() => {
        let query = supabase
          .from('business_records')
          .select('*')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false });
        if (branchId) query = query.eq('branch_id', branchId);
        return query.limit(200);
      })(),
      (() => {
        let query = supabase.from('customers').select('id,name').order('name');
        if (branchId) query = query.eq('branch_id', branchId);
        return query.limit(500);
      })(),
      (() => {
        let query = supabase.from('suppliers').select('id,name').order('name');
        if (branchId) query = query.eq('branch_id', branchId);
        return query.limit(500);
      })(),
      (() => {
        let query = supabase.from('products').select('id,name').order('name');
        if (branchId) query = query.eq('branch_id', branchId);
        return query.limit(500);
      })(),
    ]);

    if (recordsRes.error) show(recordsRes.error.message, 'error');

    setRows((recordsRes.data || []) as BusinessRecordRow[]);
    setCustomers((customersRes.data || []) as OptionRow[]);
    setSuppliers((suppliersRes.data || []) as OptionRow[]);
    setProducts((productsRes.data || []) as OptionRow[]);
    setLoading(false);
  }, [branchId, organizationId, show]);

  useEffect(() => {
    void load();
  }, [load]);

  const openAdd = () => {
    const firstType = recordTypes[0]?.key || '';
    setForm({ ...EMPTY_FORM, record_type: firstType });
    setModalOpen(true);
  };

  const save = async () => {
    if (!organizationId || !form.record_type || !form.title.trim()) {
      show(ar ? 'أكمل نوع السجل والعنوان.' : 'Complete record type and title.', 'error');
      return;
    }

    const def = typeMap.get(form.record_type);
    if (def?.customerRequired && !form.customer_id) {
      show(ar ? 'اختر العميل لهذا السجل.' : 'Select a customer for this record.', 'error');
      return;
    }
    if (def?.supplierRequired && !form.supplier_id) {
      show(ar ? 'اختر المورد لهذا السجل.' : 'Select a supplier for this record.', 'error');
      return;
    }

    const { error } = await supabase.from('business_records').insert({
      organization_id: organizationId,
      branch_id: branchId || null,
      record_type: form.record_type,
      status: form.status,
      title: form.title.trim(),
      customer_id: form.customer_id || null,
      supplier_id: form.supplier_id || null,
      product_id: form.product_id || null,
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      amount: form.amount || null,
      currency: form.currency || 'EGP',
      notes: form.notes.trim() || null,
      attributes: {},
    });

    if (error) {
      show(error.message, 'error');
      return;
    }

    show(ar ? 'تم حفظ سجل النشاط.' : 'Business record saved.', 'success');
    setModalOpen(false);
    await load();
  };

  const remove = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('business_records').delete().eq('id', deleteId);
    if (error) show(error.message, 'error');
    else show(ar ? 'تم الحذف.' : 'Deleted.', 'success');
    setDeleteId(null);
    await load();
  };

  const columns: Column<BusinessRecordRow>[] = [
    {
      key: 'record_type',
      header: ar ? 'النوع' : 'Type',
      render: (row) => {
        const def = typeMap.get(row.record_type);
        return def ? (ar ? def.ar : def.en) : row.record_type;
      },
    },
    { key: 'title', header: ar ? 'البيان' : 'Title', render: (row) => row.title },
    { key: 'status', header: ar ? 'الحالة' : 'Status', render: (row) => row.status },
    {
      key: 'amount',
      header: ar ? 'القيمة' : 'Amount',
      render: (row) => row.amount == null ? '-' : formatCurrency(Number(row.amount), row.currency || 'EGP', lang),
    },
    {
      key: 'starts_at',
      header: ar ? 'التاريخ' : 'Date',
      render: (row) => row.starts_at ? formatDate(row.starts_at, lang) : '-',
    },
    {
      key: 'actions',
      header: ar ? 'الإجراءات' : 'Actions',
      render: (row) => (
        <button
          type="button"
          onClick={() => setDeleteId(row.id)}
          className="ui-icon-action ui-icon-action-danger"
          title={ar ? 'حذف' : 'Delete'}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ),
    },
  ];

  const selectedType = typeMap.get(form.record_type);

  return (
    <DesignSurface testId="business-records-page">
      <DesignPageHeader
        title={runtime.navigation.menuLabels['business-records']?.[ar ? 'ar' : 'en'] || (ar ? 'سجلات النشاط' : 'Business Records')}
        subtitle={ar
          ? `سجلات تشغيل ${runtime.title.ar} حسب ملف النشاط الفعلي.`
          : `Operational records for ${runtime.title.en}, driven by the active business profile.`}
        actions={recordTypes.length > 0 ? (
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4" />
            {ar ? 'إضافة سجل' : 'Add record'}
          </Button>
        ) : undefined}
      />

      {recordTypes.length === 0 ? (
        <DesignPanel>
          <div className="py-10 text-center text-sm text-ui-subtle">
            {ar
              ? 'نوع المؤسسة الحالي لا يحتاج سجلات تشغيل إضافية.'
              : 'This business profile does not require extra operational records.'}
          </div>
        </DesignPanel>
      ) : (
        <DesignPanel>
          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            emptyMessage={ar ? 'لا توجد سجلات بعد.' : 'No records yet.'}
          />
        </DesignPanel>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={ar ? 'إضافة سجل نشاط' : 'Add business record'}
        size="lg"
      >
        <div className="space-y-4">
          <Select
            label={ar ? 'نوع السجل' : 'Record type'}
            value={form.record_type}
            onChange={(e) => setForm({ ...form, record_type: e.target.value })}
          >
            {recordTypes.map((type) => (
              <option key={type.key} value={type.key}>{ar ? type.ar : type.en}</option>
            ))}
          </Select>

          <Input
            label={ar ? 'العنوان / البيان' : 'Title'}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select label={ar ? 'الحالة' : 'Status'} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="open">{ar ? 'مفتوح' : 'Open'}</option>
              <option value="confirmed">{ar ? 'مؤكد' : 'Confirmed'}</option>
              <option value="completed">{ar ? 'مكتمل' : 'Completed'}</option>
              <option value="cancelled">{ar ? 'ملغي' : 'Cancelled'}</option>
            </Select>

            <Select label={runtime.terminology.customer[ar ? 'ar' : 'en']} value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} required={selectedType?.customerRequired}>
              <option value="">--</option>
              {customers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </Select>

            <Select label={runtime.terminology.supplier[ar ? 'ar' : 'en']} value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} required={selectedType?.supplierRequired}>
              <option value="">--</option>
              {suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </Select>

            <Select label={runtime.terminology.item[ar ? 'ar' : 'en']} value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
              <option value="">--</option>
              {products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </Select>

            {selectedType?.dateRangeEnabled && (
              <>
                <Input label={ar ? 'من' : 'From'} type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
                <Input label={ar ? 'إلى' : 'To'} type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
              </>
            )}

            {selectedType?.amountEnabled && (
              <>
                <Input label={ar ? 'القيمة' : 'Amount'} type="number" step="0.01" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) || 0 })} />
                <Input label={ar ? 'العملة' : 'Currency'} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
              </>
            )}
          </div>

          <Textarea label={ar ? 'ملاحظات' : 'Notes'} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />

          <div className="flex justify-end gap-2 border-t border-ui-border pt-4">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>{ar ? 'إلغاء' : 'Cancel'}</Button>
            <Button onClick={() => void save()}>{ar ? 'حفظ' : 'Save'}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => void remove()}
        title={ar ? 'حذف السجل' : 'Delete record'}
        message={ar ? 'هل تريد حذف هذا السجل؟' : 'Delete this record?'}
        confirmLabel={ar ? 'حذف' : 'Delete'}
        cancelLabel={ar ? 'إلغاء' : 'Cancel'}
      />
    </DesignSurface>
  );
}
