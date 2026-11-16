import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Trash2, FileText, Edit2, RotateCcw, Eye, Printer, RefreshCw, CalendarDays, Filter } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { BranchBadge } from '@/components/BranchBadge';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranchScope } from '@/lib/branchScope';
import { useCan } from '@/lib/permissions';
import { mergeEffectiveSettings, useSettings } from '@/context/SettingsContext';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import { useBranches } from '@/hooks/useBranches';
import type { BranchSettings, Customer, Settings } from '@/lib/types';
import {
  APPROVED_FIXED_THERMAL_WIDTH_MM,
  ReceiptPrintApprovalError,
  buildReceiptHtml,
  openPrintWindow,
  type ReceiptData,
} from '@/features/pos/utils/printing';

interface SaleRow {
  id: string;
  invoice_number: string;
  source_order_id: string | null;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
  paid_amount: number;
  refunded_amount: number;
  payment_method: string;
  status: string;
  notes: string | null;
  created_at: string;
  customer_id: string | null;
  branch_id: string;
  order_type: string;
  guest_count: number | null;
  is_archived: boolean;
  customer?: { name: string } | null;
  source_order?: { order_number: string } | null;
  sale_items?: { id: string; product_id: string | null; unit_name: string; quantity: number; unit_price: number; discount_amount: number; refunded_quantity: number; refunded_amount: number; total: number; product?: { name: string } | null }[];
}

export function SalesPage() {
  const { t, lang } = useLanguage();
  const [searchParams] = useSearchParams();
  const requestedSaleId = searchParams.get('saleId');
  const [sourceLookup, setSourceLookup] = useState<'idle' | 'loading' | 'found' | 'unavailable'>('idle');
  const { show } = useToast();
  const branchFilter = useBranchFilter();
  const branchScope = useBranchScope();
  const can = useCan();
  const canViewSales = can('sales.view');
  const { rows: items, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadSales } = usePaginatedRows<SaleRow>({
    table: 'sales',
    select: 'id, invoice_number, source_order_id, subtotal, discount_amount, tax_amount, total, paid_amount, refunded_amount, payment_method, status, notes, created_at, customer_id, branch_id, order_type, guest_count, is_archived, customer:customers(name), source_order:orders!sales_source_order_id_fkey(order_number), sale_items(id, product_id, unit_name, quantity, unit_price, discount_amount, refunded_quantity, refunded_amount, total, product:products(name))',
    order: { column: 'created_at', ascending: false },
    branch_ids: branchScope.selectedBranchIds,
    filters: [{ column: 'is_archived', value: false }],
    pageSize: 100,
  });
  const [search, setSearch] = useState('');
  const [displayStatus, setDisplayStatus] = useState<'all' | 'today' | 'completed' | 'returned' | 'other'>('all');
  const [displayDate, setDisplayDate] = useState('');
  const [showViewFilters, setShowViewFilters] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteSelectedConfirm, setDeleteSelectedConfirm] = useState(false);
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';
  const [viewSale, setViewSale] = useState<SaleRow | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersBranchId, setCustomersBranchId] = useState('');
  const [editForm, setEditForm] = useState({ customer_id: '', payment_method: '', status: '', notes: '' });
  const [refundSale, setRefundSale] = useState<SaleRow | null>(null);
  const [refundQty, setRefundQty] = useState<Record<string, string>>({});
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);
  const [receiptPreviewHtml, setReceiptPreviewHtml] = useState('');
  const [receiptPreviewTitle, setReceiptPreviewTitle] = useState('');
  const [receiptPreviewOpen, setReceiptPreviewOpen] = useState(false);
  const [receiptBusyId, setReceiptBusyId] = useState<string | null>(null);
  const isAr = lang === 'ar';
  const canRequestRefundApproval = can('sales.refund.create') && !can('refunds.approve');
  const canOpenRefund = can('sales.refund.create') || can('refunds.approve');
  const canRequestPaymentApproval = can('sales.payment.receive') && !can('refunds.approve');
  const canEditSaleMetadata = can('refunds.approve');
  const canEditPaymentMethod = can('sales.payment.receive') || can('refunds.approve');
  const canEditSale = canEditSaleMetadata || canEditPaymentMethod;
  const canArchiveReturnedSale = can('refunds.approve');
  const canPreviewReceipt = can('sales.view');
  const canPrintReceipt = can('pos.receipt.print') || can('pos.reprint');

  async function loadCustomersForBranch(branchId: string) {
    if (!canEditSaleMetadata || !branchId || customersBranchId === branchId) return;
    const { data: customersRes, error: customersError } = await supabase
      .from('customers')
      .select('*')
      .eq('branch_id', branchId)
      .order('name');
    if (customersError) {
      show(customersError.message, 'error');
      return;
    }
    setCustomers((customersRes as Customer[]) || []);
    setCustomersBranchId(branchId);
  }

  const localSaleDay = (value: string) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')].join('-');
  };
  const today = localSaleDay(new Date().toISOString());
  // Presentation filters apply to the currently loaded, permission-scoped page.
  // The repository query, financial actions and branch authorization remain unchanged.
  const filtered = items.filter((i) => {
    if (displayStatus === 'today' && localSaleDay(i.created_at) !== today) return false;
    if (displayStatus === 'completed' && i.status !== 'completed') return false;
    if (displayStatus === 'returned' && i.status !== 'returned') return false;
    if (displayStatus === 'other' && ['completed', 'returned'].includes(i.status)) return false;
    if (displayDate && localSaleDay(i.created_at) !== displayDate) return false;
    if (!search.trim()) return true;
    const s = search.trim().toLowerCase();
    return (
      i.invoice_number?.toLowerCase().includes(s) ||
      i.source_order?.order_number?.toLowerCase().includes(s) ||
      i.customer?.name?.toLowerCase().includes(s) ||
      i.status?.toLowerCase().includes(s)
    );
  });

  const branchNameForSale = (sale: SaleRow) =>
    branches.find((branch) => branch.id === sale.branch_id)?.name || (isAr ? 'الفرع' : 'Branch');

  const orderTypeLabelForSale = (orderType: string) => {
    const labels: Record<string, [string, string]> = {
      dine_in: ['صالة', 'Dine-in'],
      takeaway: ['سفري', 'Takeaway'],
      delivery: ['توصيل', 'Delivery'],
      drive_thru: ['سيارات', 'Drive-thru'],
      quick: ['سريع', 'Quick'],
    };
    const label = labels[String(orderType || '').toLowerCase()];
    return label ? (isAr ? label[0] : label[1]) : orderType;
  };

  const loadReceiptPayments = async (sale: SaleRow): Promise<Array<{ method: string; amount: number }>> => {
    const { data, error: paymentError } = await supabase
      .from('sale_payments')
      .select('payment_method, amount, refunded_amount, created_at')
      .eq('sale_id', sale.id)
      .order('created_at', { ascending: true });

    if (!paymentError && Array.isArray(data) && data.length > 0) {
      const payments = data
        .map((row) => ({
          method: String(row.payment_method || 'other'),
          amount: Math.max(0, Number(row.amount || 0) - Number(row.refunded_amount || 0)),
        }))
        .filter((row) => row.amount > 0);
      if (payments.length > 0) return payments;
    }

    const fallbackAmount = Math.max(0, Number(sale.paid_amount || 0) - Number(sale.refunded_amount || 0));
    return fallbackAmount > 0
      ? [{ method: sale.payment_method || 'cash', amount: fallbackAmount }]
      : [];
  };

  const resolveReceiptSettings = async (branchId: string): Promise<Settings | null> => {
    const cached = effectiveSettings(branchId);
    if (cached) return cached;

    // Receipt actions normally use the shared settings cache. Only when that
    // cache is missing do a single read-only branch-scoped recovery read.
    const [globalResult, branchResult] = await Promise.all([
      supabase.from('settings').select('*').maybeSingle(),
      supabase.from('branch_settings').select('*').eq('branch_id', branchId).maybeSingle(),
    ]);
    if (globalResult.error) throw new Error(`SETTINGS_LOAD_FAILED: ${globalResult.error.message}`);
    if (branchResult.error) throw new Error(`BRANCH_SETTINGS_LOAD_FAILED: ${branchResult.error.message}`);
    if (!globalResult.data) return null;

    return mergeEffectiveSettings(
      globalResult.data as Settings,
      (branchResult.data as BranchSettings | null) || null,
    );
  };

  const buildSaleReceipt = async (sale: SaleRow): Promise<ReceiptData> => {
    const payments = await loadReceiptPayments(sale);
    return {
      invoice: sale.invoice_number,
      branchName: branchNameForSale(sale),
      items: (sale.sale_items || []).map((item) => ({
        name: item.product?.name || item.unit_name || '-',
        qty: Number(item.quantity || 0),
        price: Number(item.unit_price || 0),
        total: Number(item.total || 0),
      })),
      subtotal: Number(sale.subtotal || 0),
      discount: Number(sale.discount_amount || 0),
      tax: Number(sale.tax_amount || 0),
      total: Number(sale.total || 0),
      paid: Number(sale.paid_amount || 0),
      change: Math.max(0, Number(sale.paid_amount || 0) - Number(sale.total || 0)),
      date: sale.created_at,
      customerName: sale.customer?.name || '',
      orderTypeLabel: orderTypeLabelForSale(sale.order_type),
      guestCount: sale.guest_count,
      payments,
    };
  };

  const previewSaleReceipt = async (sale: SaleRow) => {
    if (!canPreviewReceipt || receiptBusyId) return;
    setReceiptBusyId(sale.id);
    try {
      const receiptSettings = await resolveReceiptSettings(sale.branch_id);
      if (!receiptSettings) {
        show(isAr ? 'إعدادات الفرع غير متاحة لإنشاء المعاينة' : 'Branch receipt settings are unavailable', 'error');
        return;
      }
      const receipt = await buildSaleReceipt(sale);
      const html = await buildReceiptHtml(
        receipt,
        receiptSettings,
        lang,
        isAr,
        { authorize: false },
      );
      setReceiptPreviewTitle(isAr ? `معاينة شيك العميل — ${sale.invoice_number}` : `Customer Receipt Preview — ${sale.invoice_number}`);
      setReceiptPreviewHtml(html);
      setReceiptPreviewOpen(true);
    } catch (err) {
      show(err instanceof Error ? err.message : (isAr ? 'تعذر إنشاء المعاينة' : 'Could not build receipt preview'), 'error');
    } finally {
      setReceiptBusyId(null);
    }
  };

  const printSaleReceipt = async (sale: SaleRow) => {
    if (!canPrintReceipt || receiptBusyId) return;
    setReceiptBusyId(sale.id);
    try {
      const receiptSettings = await resolveReceiptSettings(sale.branch_id);
      if (!receiptSettings) {
        show(isAr ? 'إعدادات الفرع غير متاحة للطباعة' : 'Branch receipt settings are unavailable', 'error');
        return;
      }
      const receipt = await buildSaleReceipt(sale);
      const html = await buildReceiptHtml(receipt, receiptSettings, lang, isAr);
      const accepted = openPrintWindow(html, APPROVED_FIXED_THERMAL_WIDTH_MM);
      if (!accepted) {
        show(isAr ? 'تعذر فتح مسار الطباعة' : 'Could not open the receipt print path', 'error');
        return;
      }
      show(isAr ? 'تم إرسال الشيك إلى مسار طباعة الكاشير.' : 'Receipt sent to the cashier print path.', 'success');
    } catch (err) {
      if (err instanceof ReceiptPrintApprovalError && err.code === 'REPRINT_APPROVAL_PENDING') {
        show(
          isAr
            ? 'إعادة الطباعة تحتاج موافقة. تم إرسال الطلب للمدير أو ما زال قيد المراجعة.'
            : 'Reprint requires approval. The request was sent or is still pending.',
          'success',
        );
        return;
      }
      show(err instanceof Error ? err.message : (isAr ? 'تعذر إعادة طباعة الشيك' : 'Could not reprint receipt'), 'error');
    } finally {
      setReceiptBusyId(null);
    }
  };

  const openViewSale = (sale: SaleRow) => {
    setViewSale(sale);
    if (canEditSaleMetadata) void loadCustomersForBranch(sale.branch_id);
    setEditForm({
      customer_id: sale.customer_id || '',
      payment_method: sale.payment_method,
      status: sale.status,
      notes: sale.notes || '',
    });
  };

  // Follow only exact sale IDs from report rows. The same sale detail projection,
  // RLS and permitted branch scope used by this page apply to direct URLs.
  // Do not allow an arbitrary URL to override a tenant's branch selection.
  useEffect(() => {
    if (!requestedSaleId) {
      setSourceLookup('idle');
      return;
    }
    setViewSale(null);
    if (branchScope.loading) return;
    if (!/^[\\da-f]{8}-[\\da-f]{4}-[1-8][\\da-f]{3}-[89ab][\\da-f]{3}-[\\da-f]{12}$/i.test(requestedSaleId)
        || !canViewSales || branchScope.selectedBranchIds.length === 0) {
      setSourceLookup('unavailable');
      return;
    }
    let cancelled = false;
    setSourceLookup('loading');
    (async () => {
      const { data, error: lookupError } = await supabase.from('sales')
        .select('id, invoice_number, source_order_id, subtotal, discount_amount, tax_amount, total, paid_amount, refunded_amount, payment_method, status, notes, created_at, customer_id, branch_id, order_type, guest_count, is_archived, customer:customers(name), source_order:orders!sales_source_order_id_fkey(order_number), sale_items(id, product_id, unit_name, quantity, unit_price, discount_amount, refunded_quantity, refunded_amount, total, product:products(name))')
        .eq('id', requestedSaleId)
        .in('branch_id', branchScope.selectedBranchIds)
        .eq('is_archived', false)
        .maybeSingle();
      if (cancelled) return;
      if (lookupError || !data) {
        setSourceLookup('unavailable');
        return;
      }
      // PostgREST runtime resolves these many-to-one joins to objects.
      // Generated relationship typing may describe arrays; normalize both forms.
      const mapped = data as unknown as SaleRow;
      const sale: SaleRow = {
        ...mapped,
        customer: Array.isArray(mapped.customer) ? (mapped.customer[0] ?? null) : mapped.customer,
        source_order: Array.isArray(mapped.source_order) ? (mapped.source_order[0] ?? null) : mapped.source_order,
      };
      setViewSale(sale);
      setEditForm({
        customer_id: sale.customer_id || '',
        payment_method: sale.payment_method,
        status: sale.status,
        notes: sale.notes || '',
      });
      setSourceLookup('found');
    })();
    return () => { cancelled = true; };
    // Branch scope identity and permission control source resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedSaleId, branchScope.scopeKey, branchScope.loading, canViewSales]);

  const openRefund = (sale: SaleRow) => {
    setRefundSale(sale);
    setRefundReason('');
    const qty: Record<string, string> = {};
    for (const item of sale.sale_items || []) {
      qty[item.id] = '0';
    }
    setRefundQty(qty);
  };

  const refundLineTotal = (item: NonNullable<SaleRow['sale_items']>[number]): number => {
    const q = Math.max(0, Math.min(parseFloat(refundQty[item.id] || '0') || 0, item.quantity - (item.refunded_quantity || 0)));
    return Math.round((item.total || 0) * q / (item.quantity || 1) * 100) / 100;
  };

  const refundTotal = () => {
    let sum = 0;
    for (const item of refundSale?.sale_items || []) sum += refundLineTotal(item);
    return Math.round(sum * 100) / 100;
  };

  const fillFullRefund = () => {
    if (!refundSale) return;
    const qty: Record<string, string> = {};
    for (const item of refundSale.sale_items || []) {
      qty[item.id] = String(Math.max(0, item.quantity - (item.refunded_quantity || 0)));
    }
    setRefundQty(qty);
  };

  const clearRefundSelection = () => {
    if (!refundSale) return;
    const qty: Record<string, string> = {};
    for (const item of refundSale.sale_items || []) qty[item.id] = '0';
    setRefundQty(qty);
  };

  const previewRefundReceipt = async () => {
    if (!refundSale || receiptBusyId) return;
    const selected = (refundSale.sale_items || [])
      .map((item) => {
        const remaining = Math.max(0, item.quantity - (item.refunded_quantity || 0));
        const qty = Math.max(0, Math.min(parseFloat(refundQty[item.id] || '0') || 0, remaining));
        return { item, qty };
      })
      .filter((row) => row.qty > 0);
    if (selected.length === 0) {
      show(isAr ? 'اختر صنفًا أو كمية للمرتجع أولًا' : 'Choose an item or quantity to refund first', 'error');
      return;
    }

    const totalRefund = refundTotal();
    const receipt: ReceiptData = {
      invoice: refundSale.invoice_number,
      branchName: branchNameForSale(refundSale),
      items: selected.map(({ item, qty }) => ({
        name: item.product?.name || item.unit_name || '-',
        qty,
        price: Number(item.unit_price || 0),
        total: refundLineTotal(item),
      })),
      subtotal: totalRefund,
      discount: 0,
      tax: 0,
      total: totalRefund,
      paid: 0,
      change: 0,
      date: refundSale.created_at,
      customerName: refundSale.customer?.name || '',
      orderTypeLabel: orderTypeLabelForSale(refundSale.order_type),
      guestCount: refundSale.guest_count,
      documentTitle: isAr ? 'معاينة المرتجع' : 'REFUND PREVIEW',
      hidePaymentSummary: true,
    };

    setReceiptBusyId(refundSale.id);
    try {
      const receiptSettings = await resolveReceiptSettings(refundSale.branch_id);
      if (!receiptSettings) {
        show(isAr ? 'إعدادات الفرع غير متاحة لإنشاء المعاينة' : 'Branch receipt settings are unavailable', 'error');
        return;
      }
      const html = await buildReceiptHtml(
        receipt,
        receiptSettings,
        lang,
        isAr,
        { authorize: false },
      );
      setReceiptPreviewTitle(isAr ? `معاينة المرتجع — ${refundSale.invoice_number}` : `Refund Preview — ${refundSale.invoice_number}`);
      setReceiptPreviewHtml(html);
      setReceiptPreviewOpen(true);
    } catch (err) {
      show(err instanceof Error ? err.message : (isAr ? 'تعذر إنشاء معاينة المرتجع' : 'Could not build refund preview'), 'error');
    } finally {
      setReceiptBusyId(null);
    }
  };

  const submitRefund = async () => {
    if (!refundSale) return;
    const p_items: { sale_item_id: string; quantity: number }[] = [];
    for (const item of refundSale.sale_items || []) {
      const q = Math.max(0, Math.min(parseFloat(refundQty[item.id] || '0') || 0, item.quantity - (item.refunded_quantity || 0)));
      if (q > 0) p_items.push({ sale_item_id: item.id, quantity: q });
    }
    if (p_items.length === 0) { show(isAr ? 'اختر كمية للمرتجع' : 'Choose a quantity to refund', 'error'); return; }
    setRefunding(true);
    const { data, error } = await api.trade.processRefund({
      p_sale_id: refundSale.id,
      p_items,
      p_reason: refundReason.trim() || null,
    });
    setRefunding(false);
    if (error) { show(error.message, 'error'); return; }
    const result = data as { success: boolean; error?: string; detail?: string; refunded_amount?: number } | null;
    if (!result?.success) {
      if (result?.error === 'APPROVAL_REQUIRED' && canRequestRefundApproval) {
        const { data: approvalData, error: approvalError } = await supabase.rpc('request_manager_approval', {
          p_action_type: 'refund',
          p_entity_type: 'sale',
          p_entity_id: refundSale.id,
          p_payload: {
            items: p_items,
            reason: refundReason.trim() || null,
            refund_total: refundTotal(),
            invoice_number: refundSale.invoice_number,
          },
          p_reason: refundReason.trim() || (isAr ? 'طلب مرتجع من الكاشير' : 'Cashier refund request'),
        });
        if (approvalError) {
          show(approvalError.message, 'error');
          return;
        }
        const approvalResult = approvalData as { success?: boolean; error?: string; request_id?: string } | null;
        if (!approvalResult?.success) {
          show(approvalResult?.error || (isAr ? 'تعذر إرسال طلب الموافقة' : 'Could not request approval'), 'error');
          return;
        }
        show(isAr ? 'تم إرسال طلب المرتجع للمدير. بعد الموافقة اضغط تنفيذ المرتجع مرة أخرى.' : 'Refund approval requested. After manager approval, submit the refund again.', 'success');
        return;
      }
      show(`${isAr ? 'فشل المرتجع' : 'Refund failed'}: ${result?.detail || result?.error || 'unknown'}`, 'error');
      return;
    }
    await logAudit('update', 'sales', refundSale.id, { refunded_amount: result.refunded_amount, reason: refundReason });
    show(`${isAr ? 'تمت المعاملة' : 'Refunded'} ${formatCurrency(result.refunded_amount || 0, currency, lang)}`, 'success');
    setRefundSale(null);
    reloadSales();
  };

  const saveSaleEdit = async () => {
    if (!viewSale) return;

    const paymentChanged = editForm.payment_method !== viewSale.payment_method;
    if (paymentChanged && !canEditPaymentMethod) {
      show(isAr ? 'لا تملك صلاحية تعديل طريقة الدفع' : 'You do not have permission to edit the payment method', 'error');
      return;
    }
    if (paymentChanged) {
      if (editForm.payment_method === 'credit') {
        show(isAr ? 'التحويل إلى آجل يحتاج مسار ذمم مدينة مستقل' : 'Changing to credit requires the receivables workflow', 'error');
        return;
      }

      const { data, error } = await supabase.rpc('change_sale_payment_method', {
        p_sale_id: viewSale.id,
        p_new_method: editForm.payment_method,
        p_reason: null,
      });
      if (error) { show(error.message, 'error'); return; }

      const result = data as { success?: boolean; error?: string; detail?: string } | null;
      if (!result?.success) {
        if (result?.error === 'APPROVAL_REQUIRED' && canRequestPaymentApproval) {
          const { data: approvalData, error: approvalError } = await supabase.rpc('request_manager_approval', {
            p_action_type: 'change_payment_method',
            p_entity_type: 'sale',
            p_entity_id: viewSale.id,
            p_payload: {
              old_method: viewSale.payment_method,
              new_method: editForm.payment_method,
              invoice_number: viewSale.invoice_number,
            },
            p_reason: isAr ? 'طلب تغيير طريقة دفع من الكاشير' : 'Cashier payment-method correction request',
          });
          if (approvalError) { show(approvalError.message, 'error'); return; }
          const approvalResult = approvalData as { success?: boolean; error?: string } | null;
          if (!approvalResult?.success) {
            show(approvalResult?.error || (isAr ? 'تعذر إرسال طلب الموافقة' : 'Could not request approval'), 'error');
            return;
          }
          show(isAr ? 'تم إرسال طلب تغيير طريقة الدفع للمدير. بعد الموافقة اضغط حفظ مرة أخرى.' : 'Payment change approval requested. After approval, save again.', 'success');
          return;
        }
        show(result?.detail || result?.error || (isAr ? 'فشل تغيير طريقة الدفع' : 'Payment change failed'), 'error');
        return;
      }
    }

    if (canEditSaleMetadata) {
      const { error } = await supabase.from('sales').update({
        customer_id: editForm.customer_id || null,
        status: editForm.status,
        notes: editForm.notes || null,
      }).eq('id', viewSale.id);
      if (error) { show(error.message, 'error'); return; }
    }

    await logAudit('update', 'sales', viewSale.id, paymentChanged ? { payment_method: editForm.payment_method } : undefined);
    show(t('saveSuccess'), 'success');
    setViewSale(null);
    reloadSales();
  };

  const remove = async () => {
    if (!deleteId) return;
    const sale = items.find((i) => i.id === deleteId);
    if (!sale || sale.status !== 'returned') {
      show(isAr ? 'لا يمكن إخفاء إلا الفاتورة المرتجعة بالكامل' : 'Only fully returned sales can be archived', 'error');
      setDeleteId(null);
      return;
    }
    try {
      const { data, error } = await api.trade.archiveReturnedSale({ p_sale_id: deleteId });
      if (error) { show(error.message, 'error'); return; }
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        show(result?.error || (isAr ? 'تعذر إخفاء الفاتورة المرتجعة' : 'Could not archive returned sale'), 'error');
        return;
      }
      await logAudit('archive', 'sales', deleteId, { status: 'returned' });
      show(isAr ? 'تم إخفاء الفاتورة المرتجعة مع الاحتفاظ بأثرها المالي' : 'Returned sale archived; financial history was preserved', 'success');
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : 'Error', 'error');
    }
    setDeleteId(null);
    reloadSales();
  };

  const removeSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const archivable = items.filter((i) => ids.includes(i.id) && i.status === 'returned').map((i) => i.id);
    const blocked = ids.length - archivable.length;
    let archived = 0;
    for (const id of archivable) {
      const { data, error } = await api.trade.archiveReturnedSale({ p_sale_id: id });
      const result = data as { success?: boolean } | null;
      if (!error && result?.success) {
        archived += 1;
        await logAudit('archive', 'sales', id, { status: 'returned' });
      }
    }
    if (blocked > 0) show(isAr ? `تم إخفاء ${archived} فاتورة مرتجعة، و${blocked} فاتورة غير مؤهلة` : `Archived ${archived} returned sales; ${blocked} were not eligible`, 'error');
    else show(isAr ? 'تم إخفاء الفواتير المرتجعة مع الاحتفاظ بأثرها المالي' : 'Returned sales archived; financial history was preserved', 'success');
    setSelectedIds(new Set());
    setDeleteSelectedConfirm(false);
    reloadSales();
  };

  const PAYMENT_LABELS: Record<string, string> = { cash: t('cash'), card: t('card'), transfer: t('transfer'), credit: t('credit') };

  const columns: Column<SaleRow>[] = [
    { key: 'invoice_number', header: t('invoiceNumber'), className: 'min-w-44', mobilePriority: true, render: (r) => (
      <div className="flex items-center gap-3 min-w-0">
        <FileText className="h-4 w-4 shrink-0 text-brand-500" />
        <div className="min-w-0">
          <div className="font-bold text-ui-text whitespace-nowrap" dir="auto">{r.invoice_number}</div>
          {r.source_order?.order_number && (
            <div className="text-xs font-medium text-ui-subtle whitespace-nowrap">
              {isAr ? 'طلب' : 'Order'}: {r.source_order.order_number}
            </div>
          )}
        </div>
      </div>
    )},
    { key: 'branch', header: t('branch'), className: 'min-w-36', render: (r) => <BranchBadge name={branches.find((b) => b.id === r.branch_id)?.name || '-'} /> },
    { key: 'customer', header: t('customer'), className: 'min-w-40', render: (r) => <span className="block max-w-60 truncate font-medium" title={r.customer?.name || ''}>{r.customer?.name || '-'}</span> },
    { key: 'status', header: t('status'), className: 'min-w-28', render: (r) => (
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
          r.status === 'completed' ? 'bg-ui-success-soft text-ui-success' :
          r.status === 'returned' ? 'bg-ui-danger-soft text-ui-danger' :
          'bg-ui-warning-soft text-ui-warning'
        }`}>
          {r.status}
        </span>
        {r.refunded_amount > 0 && r.status !== 'returned' && (
          <span className="rounded-full bg-ui-warning-soft px-2 py-1 text-xs font-medium text-ui-warning">
            {isAr ? 'مرتجع جزئي' : 'Partial refund'}
          </span>
        )}
      </div>
    )},
    { key: 'order_type', header: isAr ? 'المصدر' : 'Source', className: 'min-w-28', render: (r) => <span className="text-ui-muted">{orderTypeLabelForSale(r.order_type) || '-'}</span> },
    { key: 'total', header: t('total'), className: 'min-w-32 whitespace-nowrap text-end tabular-nums', mobilePriority: true, render: (r) => <span className="font-bold text-ui-text">{formatCurrency(r.total, currency, lang)}</span> },
    { key: 'paid_amount', header: isAr ? 'المدفوع' : 'Paid', className: 'min-w-28 whitespace-nowrap text-end tabular-nums', render: (r) => formatCurrency(r.paid_amount, currency, lang) },
    { key: 'payment_method', header: isAr ? 'طريقة الدفع' : 'Payment', className: 'min-w-28', render: (r) => (
      <span className="whitespace-nowrap rounded-full bg-ui-page-alt px-2.5 py-1 text-xs font-medium text-ui-muted">
        {PAYMENT_LABELS[r.payment_method] || r.payment_method}
      </span>
    )},
    { key: 'created_at', header: isAr ? 'تاريخ ووقت الإنشاء' : 'Created at', className: 'min-w-44 whitespace-nowrap', render: (r) => <span className="text-sm text-ui-subtle tabular-nums">{formatDateTime(r.created_at, lang)}</span> },
    { key: 'actions', header: t('actions'), render: (r) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        {canPreviewReceipt && (
          <button
            onClick={() => void previewSaleReceipt(r)}
            className="ui-icon-action ui-icon-action-info"
            title={isAr ? 'معاينة شيك العميل' : 'Preview customer receipt'}
            disabled={receiptBusyId === r.id}
          >
            <Eye className="w-4 h-4" />
          </button>
        )}
        {canPrintReceipt && (
          <button
            onClick={() => void printSaleReceipt(r)}
            className="ui-icon-action ui-icon-action-info"
            title={isAr ? 'إعادة طباعة الشيك' : 'Reprint receipt'}
            disabled={receiptBusyId === r.id}
          >
            <Printer className="w-4 h-4" />
          </button>
        )}
        {canEditSale && (
          <button onClick={() => openViewSale(r)} className="ui-icon-action ui-icon-action-info" title={t('edit')}>
            <Edit2 className="w-4 h-4" />
          </button>
        )}
        {canOpenRefund && r.status !== 'returned' && (r.refunded_amount || 0) < r.total && (
          <button onClick={() => openRefund(r)} className="p-1.5 rounded-md hover:bg-ui-warning-soft text-ui-warning" title={isAr ? 'مرتجع صنف أو فاتورة' : 'Refund item or invoice'}>
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
        {canArchiveReturnedSale && r.status === 'returned' && (
          <button onClick={() => setDeleteId(r.id)} className="ui-icon-action ui-icon-action-danger" title={isAr ? 'إخفاء الفاتورة المرتجعة' : 'Archive returned sale'}>
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    )},
  ];

  return (
    <DesignSurface testId="sales-page">
      <DesignPageHeader title={t('salesInvoices')} actions={
        <>
          <input
            data-testid="sales-search"
            aria-label={isAr ? 'بحث في الفواتير المحمّلة' : 'Search loaded invoices'}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={isAr ? 'بحث في الفواتير...' : 'Search invoices...'}
            className="h-9 w-32 min-w-0 rounded-lg border border-ui-border bg-ui-surface px-3 text-xs text-ui-text outline-none focus:border-ui-primary sm:w-52"
          />
          <Button variant="outline" size="sm"
            onClick={() => setShowViewFilters((value) => !value)}
            data-testid="sales-toggle-filters"
            aria-expanded={showViewFilters}
          >
            <Filter className="h-4 w-4" />
            {isAr ? 'تصفية' : 'Filters'}
            {displayDate ? ' •' : ''}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void reloadSales()} data-testid="sales-view-refresh">
            <RefreshCw className="h-4 w-4" /> <span className="hidden sm:inline">{isAr ? 'تحديث' : 'Refresh'}</span>
          </Button>
          {selectedIds.size > 0 && (
            <Button variant="danger" size="sm" onClick={() => setDeleteSelectedConfirm(true)} data-testid="sales-delete-selected">
              <Trash2 className="w-4 h-4" /> {t('deleteSelected')} ({selectedIds.size})
            </Button>
          )}
        </>
      } />

      {requestedSaleId && (
        <div role={sourceLookup === 'unavailable' ? 'alert' : 'status'}
          className="mb-3 rounded-xl border border-ui-border bg-ui-page-alt px-4 py-3 text-xs text-ui-muted"
          data-testid="source-sale-lookup">
          {sourceLookup === 'loading'
            ? (isAr ? 'جارٍ فتح الفاتورة الأصلية من الفرع المصرح به...' : 'Opening original sale from your authorized branch...')
            : sourceLookup === 'unavailable'
              ? (isAr ? 'الفاتورة غير متاحة في نطاق فروعك أو صلاحياتك الحالية.' : 'This sale is unavailable within your current permissions and branch scope.')
              : sourceLookup === 'found'
                ? (isAr ? 'تم تحميل الفاتورة الأصلية وفق الصلاحيات الحالية.' : 'Original sale loaded within your current permissions.')
                : null}
        </div>
      )}
      {showViewFilters && (
        <DesignPanel testId="sales-search-panel" bodyClassName="px-3 py-2">
          <div className="flex flex-wrap items-end gap-2" data-testid="sales-expanded-filters">
            <label className="flex flex-col gap-1 text-xs font-semibold text-ui-muted" htmlFor="sales-view-date">
              <span>{isAr ? 'تاريخ الإنشاء' : 'Creation date'}</span>
              <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-ui-border bg-ui-surface px-3">
                <CalendarDays className="h-4 w-4 text-ui-subtle" />
                <input id="sales-view-date" data-testid="sales-view-date" type="date"
                  className="min-w-0 bg-transparent text-sm text-ui-text outline-none"
                  value={displayDate} onChange={(event) => setDisplayDate(event.target.value)} />
              </span>
            </label>
            {(displayDate || search || displayStatus !== 'all') && (
              <Button variant="outline" size="sm" onClick={() => { setDisplayDate(''); setSearch(''); setDisplayStatus('all'); }}>
                {isAr ? 'مسح التصفية' : 'Clear filters'}
              </Button>
            )}
          </div>
        </DesignPanel>
      )}

      <DesignPanel testId="sales-table-panel" bodyClassName="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ui-border px-4 py-3 sm:px-5">
          <div className="flex max-w-full items-center gap-1 overflow-x-auto" role="group" aria-label={isAr ? 'عرض الفواتير حسب الحالة' : 'Invoice display filter'}>
            {([
              ['all', isAr ? 'الكل' : 'All'],
              ['today', isAr ? 'اليوم' : 'Today'],
              ['completed', isAr ? 'مكتملة' : 'Completed'],
              ['returned', isAr ? 'مرتجعة' : 'Returned'],
              ['other', isAr ? 'أخرى' : 'Other'],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" data-testid={`sales-view-tab-${key}`}
                aria-pressed={displayStatus === key}
                onClick={() => setDisplayStatus(key)}
                className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  displayStatus === key
                    ? 'bg-brand-600/10 text-brand-600 dark:text-brand-400'
                    : 'text-ui-muted hover:bg-ui-page-alt hover:text-ui-text'
                }`}>
                {label}
              </button>
            ))}
          </div>
          <span className="shrink-0 text-xs font-medium text-ui-subtle" data-testid="sales-view-count">
            {isAr ? `المعروض: ${filtered.length} من ${items.length} محمّلة` : `Showing ${filtered.length} of ${items.length} loaded`}
          </span>
        </div>
        <div className="min-w-0 px-3 py-3 sm:px-4 sales-invoices-layout [&_table]:w-full [&_thead_tr]:bg-ui-page-alt/60 [&_th]:px-4 [&_th]:py-4 [&_tbody_tr]:h-[68px] [&_tbody_tr]:hover:bg-ui-page-alt/60 [&_td]:px-4 [&_td]:py-4">
          <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')}
            onRowClick={openViewSale} showCheckbox selectedIds={selectedIds} onSelectionChange={setSelectedIds}
            tableId="sales-invoices-layout" />
        </div>
        <div className="border-t border-ui-border px-4 py-3">
          <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
        </div>
      </DesignPanel>

      {/* Sale Detail / Edit Modal */}
      <Modal open={!!viewSale} onClose={() => setViewSale(null)} title={isAr ? 'تفاصيل الفاتورة' : 'Invoice Details'} size="lg">
        {viewSale && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-ui-page-alt rounded-lg">
              <div className="flex items-center gap-3">
                <FileText className="w-8 h-8 text-brand-500" />
                <div>
                  <p className="font-bold text-lg text-ui-text">{viewSale.invoice_number}</p>
                  {viewSale.source_order?.order_number && (
                    <p className="text-xs font-bold text-ui-accent">
                      {isAr ? 'رقم الطلب الأصلي' : 'Original order'}: {viewSale.source_order.order_number}
                    </p>
                  )}
                  <p className="text-sm text-ui-subtle">{formatDateTime(viewSale.created_at, lang)}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {canPreviewReceipt && (
                  <Button variant="secondary" size="sm" onClick={() => void previewSaleReceipt(viewSale)} disabled={receiptBusyId === viewSale.id}>
                    <Eye className="w-4 h-4" /> {isAr ? 'معاينة الشيك' : 'Receipt preview'}
                  </Button>
                )}
                {canPrintReceipt && (
                  <Button variant="secondary" size="sm" onClick={() => void printSaleReceipt(viewSale)} disabled={receiptBusyId === viewSale.id}>
                    <Printer className="w-4 h-4" /> {isAr ? 'إعادة الطباعة' : 'Reprint'}
                  </Button>
                )}
                {canOpenRefund && viewSale.status !== 'returned' && (viewSale.refunded_amount || 0) < viewSale.total && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      openRefund(viewSale);
                      setViewSale(null);
                    }}
                  >
                    <RotateCcw className="w-4 h-4" /> {isAr ? 'مرتجع' : 'Refund'}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Select label={t('customer')} value={editForm.customer_id} disabled={!canEditSaleMetadata} onChange={(e) => setEditForm({ ...editForm, customer_id: e.target.value })}>
                <option value="">--</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Select label={isAr ? 'طريقة الدفع' : 'Payment Method'} value={editForm.payment_method} disabled={!canEditPaymentMethod} onChange={(e) => setEditForm({ ...editForm, payment_method: e.target.value })}>
                <option value="cash">{t('cash')}</option>
                <option value="card">{t('card')}</option>
                <option value="transfer">{t('transfer')}</option>
                <option value="credit" disabled>{t('credit')}</option>
              </Select>
              <Select label={t('status')} value={editForm.status} disabled={!canEditSaleMetadata} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                <option value="completed">{isAr ? 'مكتملة' : 'Completed'}</option>
                <option value="pending">{isAr ? 'قيد الانتظار' : 'Pending'}</option>
                <option value="returned">{isAr ? 'مرتجعة' : 'Returned'}</option>
              </Select>
              <div />
            </div>
            <Textarea label={t('notes')} value={editForm.notes} disabled={!canEditSaleMetadata} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} />

            {viewSale.sale_items && viewSale.sale_items.length > 0 && (
              <div>
                <h4 className="font-semibold text-ui-muted mb-2">{isAr ? 'أصناف الفاتورة' : 'Invoice Items'}</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-ui-border">
                        <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{t('productName')}</th>
                        <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{isAr ? 'الكمية' : 'Qty'}</th>
                        <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{isAr ? 'السعر' : 'Price'}</th>
                        <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{t('total')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewSale.sale_items.map((item) => (
                        <tr key={item.id} className="border-b border-ui-border">
                          <td className="px-3 py-2 text-ui-text">{item.product?.name || '-'}</td>
                          <td className="px-3 py-2 text-ui-muted">{item.quantity}</td>
                          <td className="px-3 py-2 text-ui-muted">{formatCurrency(item.unit_price, currency, lang)}</td>
                          <td className="px-3 py-2 font-medium text-ui-text">{formatCurrency(item.total, currency, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="bg-ui-page-alt rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm"><span>{t('total')}</span><span className="font-bold text-brand-600">{formatCurrency(viewSale.total, currency, lang)}</span></div>
              <div className="flex justify-between text-sm"><span>{isAr ? 'المدفوع' : 'Paid'}</span><span>{formatCurrency(viewSale.paid_amount, currency, lang)}</span></div>
              {viewSale.total - viewSale.paid_amount > 0 && (
                <div className="flex justify-between text-sm text-ui-danger"><span>{isAr ? 'المتبقي' : 'Remaining'}</span><span>{formatCurrency(viewSale.total - viewSale.paid_amount, currency, lang)}</span></div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setViewSale(null)}>{t('cancel')}</Button>
              {canEditSale && <Button onClick={saveSaleEdit}>{t('save')}</Button>}
            </div>
          </div>
        )}
      </Modal>

      {/* Refund Modal */}
      <Modal open={!!refundSale} onClose={() => setRefundSale(null)} title={isAr ? 'مرتجع الفاتورة' : 'Invoice Refund'} size="lg">
        {refundSale && (
          <div className="space-y-4">
            <div className="space-y-3 rounded-lg bg-ui-page-alt p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-lg text-ui-text">{refundSale.invoice_number}</p>
                  <p className="text-sm text-ui-subtle">{formatDateTime(refundSale.created_at, lang)}</p>
                </div>
                <span className="text-sm text-ui-subtle">{isAr ? 'إجمالي الفاتورة' : 'Invoice total'}: <b>{formatCurrency(refundSale.total, currency, lang)}</b></span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={fillFullRefund}>
                  <RotateCcw className="w-4 h-4" /> {isAr ? 'إرجاع الفاتورة بالكامل' : 'Refund full invoice'}
                </Button>
                <Button variant="secondary" size="sm" onClick={clearRefundSelection}>
                  {isAr ? 'مسح الاختيار' : 'Clear selection'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void previewRefundReceipt()} disabled={receiptBusyId === refundSale.id || refundTotal() <= 0}>
                  <Eye className="w-4 h-4" /> {isAr ? 'معاينة المرتجع' : 'Refund preview'}
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto border border-ui-border rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ui-border bg-ui-page-alt/60">
                    <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{t('productName')}</th>
                    <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{isAr ? 'كمية المرتجع' : 'Refund Qty'}</th>
                    <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{isAr ? 'قيمة المرتجع' : 'Refund Value'}</th>
                  </tr>
                </thead>
                <tbody>
                  {refundSale.sale_items?.map((item) => {
                    const remaining = item.quantity - (item.refunded_quantity || 0);
                    return (
                      <tr key={item.id} className="border-b border-ui-border">
                        <td className="px-3 py-2">
                          <p className="text-ui-text">{item.product?.name || '-'}</p>
                          <p className="text-xs text-ui-subtle">{isAr ? 'الكمية المبيعة' : 'Sold'}: {item.quantity}{item.refunded_quantity > 0 ? ` · ${isAr ? 'مرتجع' : 'refunded'}: ${item.refunded_quantity}` : ''}</p>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              max={remaining}
                              step="any"
                              value={refundQty[item.id] ?? ''}
                              onChange={(e) => setRefundQty({ ...refundQty, [item.id]: e.target.value })}
                              className="w-24 px-2 py-1.5 rounded-lg border border-ui-border bg-ui-surface text-sm text-ui-text focus:outline-none focus:ring-2 focus:ring-ui-primary"
                            />
                            <button
                              type="button"
                              disabled={remaining <= 0}
                              onClick={() => setRefundQty({ ...refundQty, [item.id]: String(Math.max(0, remaining)) })}
                              className="rounded-lg border border-ui-border bg-ui-surface px-2 py-1.5 text-xs font-bold text-ui-accent disabled:opacity-40"
                            >
                              {isAr ? 'الكل' : 'All'}
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2 font-medium text-ui-text">{formatCurrency(refundLineTotal(item), currency, lang)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Textarea label={isAr ? 'سبب المرتجع (اختياري)' : 'Refund reason (optional)'} value={refundReason} onChange={(e) => setRefundReason(e.target.value)} rows={2} />

            <div className="flex justify-between items-center bg-ui-danger-soft rounded-lg px-4 py-3">
              <span className="font-semibold text-ui-danger">{isAr ? 'قيمة المرتجع الإجمالية' : 'Total refund'}</span>
              <span className="font-bold text-lg text-ui-danger">{formatCurrency(refundTotal(), currency, lang)}</span>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setRefundSale(null)}>{t('cancel')}</Button>
              <Button variant="secondary" onClick={() => void previewRefundReceipt()} disabled={receiptBusyId === refundSale.id || refundTotal() <= 0}>
                <Eye className="w-4 h-4" /> {isAr ? 'معاينة قبل التنفيذ' : 'Preview before refund'}
              </Button>
              <Button onClick={submitRefund} disabled={refunding || refundTotal() <= 0}>
                <RotateCcw className="w-4 h-4" /> {refunding ? '...' : (isAr ? 'تأكيد المرتجع' : 'Confirm Refund')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={receiptPreviewOpen}
        onClose={() => setReceiptPreviewOpen(false)}
        title={receiptPreviewTitle || (isAr ? 'معاينة الشيك' : 'Receipt Preview')}
        size="lg"
      >
        <div className="rounded-xl border border-ui-border bg-ui-page-alt p-3">
          <iframe
            title={receiptPreviewTitle || 'receipt-preview'}
            srcDoc={receiptPreviewHtml}
            sandbox=""
            className="h-[70vh] w-full rounded-lg bg-white"
          />
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={remove}
        title={isAr ? 'إخفاء الفاتورة المرتجعة' : 'Archive returned sale'}
        message={isAr ? 'ستختفي الفاتورة من شاشة المبيعات مع الاحتفاظ بأثر المرتجع والمخزون والقيود والطباعة.' : 'The sale will be hidden from the sales list while preserving refund, inventory, accounting and print history.'}
        confirmLabel={isAr ? 'إخفاء' : 'Archive'} cancelLabel={t('cancel')} />
      <ConfirmDialog open={deleteSelectedConfirm} onClose={() => setDeleteSelectedConfirm(false)} onConfirm={removeSelected}
        title={isAr ? 'إخفاء الفواتير المرتجعة' : 'Archive returned sales'}
        message={isAr ? 'سيتم إخفاء الفواتير المرتجعة بالكامل فقط مع الاحتفاظ بأثرها المالي.' : 'Only fully returned sales will be archived; financial history is preserved.'}
        confirmLabel={isAr ? 'إخفاء' : 'Archive'} cancelLabel={t('cancel')} />
    </DesignSurface>
  );
}
