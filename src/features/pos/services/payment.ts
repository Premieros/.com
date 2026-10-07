import { pos as posApi, supabase, type SplitTenderInput } from '@/api';
import { enqueueOfflineSale, type OfflineSaleQueueItem } from '@/core/offline/offlineStorage';
import { SettingsRepository, InventoryRepository } from '@/core/repositories';
import type { RpcResult, OrderType } from '@/lib/types';
import type { ItemPayload } from '../utils/cart';

export interface ProcessSalePayload {
  p_client_operation_key?: string;
  p_invoice_number: string;
  p_branch_id: string;
  p_shift_id: string | null;
  p_warehouse_id: string | null;
  p_customer_id: string | null;
  p_salesperson_id: string | null;
  p_subtotal: number;
  p_discount_amount: number;
  p_discount_type: 'percent' | 'amount';
  p_tax_amount: number;
  p_bonus_amount: number;
  p_total: number;
  p_paid_amount: number;
  p_payment_method: string;
  p_status: string;
  p_items: ItemPayload[];
  p_order_type: OrderType;
  p_table_id: string | null;
  p_order_id: string | null;
  p_guest_count: number | null;
}

export interface ProcessSplitSalePayload extends Omit<ProcessSalePayload, 'p_paid_amount' | 'p_payment_method'> {
  p_payments: SplitTenderInput[];
}

export interface ReceiptTender {
  payment_method: string;
  amount: number;
}

export type ManualPaymentMethod = 'instapay' | 'bank_transfer';

export interface ManualPaymentApproval {
  requestId: string;
  method: ManualPaymentMethod;
  amount: number;
  reference: string;
}

export type ManualPaymentApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'consumed';

export type ProcessSaleResult = RpcResult & {
  offline?: boolean;
  pending_sync?: boolean;
  payments?: ReceiptTender[];
  invoice_number?: string;
  idempotent_replay?: boolean;
  client_operation_key?: string;
};

type OwnedOfflineSaleQueueItem = Omit<OfflineSaleQueueItem, 'status' | 'retry_count'> & {
  created_by_user_id: string;
};

let armedSplitTender: SplitTenderInput[] | null = null;
let armedSplitTenderAt = 0;
const SPLIT_TENDER_ARM_TTL_MS = 15_000;

let armedManualPayment: ManualPaymentApproval | null = null;
let armedManualPaymentAt = 0;
const MANUAL_PAYMENT_ARM_TTL_MS = 60_000;

export function armSplitTender(payments: SplitTenderInput[]): void {
  armedSplitTender = payments
    .filter((payment) => Number(payment.amount) > 0)
    .map((payment) => ({ payment_method: payment.payment_method, amount: Number(payment.amount) }));
  armedSplitTenderAt = Date.now();
}

export function clearArmedSplitTender(): void {
  armedSplitTender = null;
  armedSplitTenderAt = 0;
}

export function armManualPaymentApproval(approval: ManualPaymentApproval): void {
  armedManualPayment = { ...approval, amount: Number(approval.amount) };
  armedManualPaymentAt = Date.now();
}

export function clearArmedManualPaymentApproval(): void {
  armedManualPayment = null;
  armedManualPaymentAt = 0;
}

function consumeArmedManualPayment(): ManualPaymentApproval | null {
  if (!armedManualPayment || Date.now() - armedManualPaymentAt > MANUAL_PAYMENT_ARM_TTL_MS) {
    clearArmedManualPaymentApproval();
    return null;
  }
  const approval = armedManualPayment;
  clearArmedManualPaymentApproval();
  return approval;
}

function consumeArmedSplitTender(): SplitTenderInput[] | null {
  if (!armedSplitTender || Date.now() - armedSplitTenderAt > SPLIT_TENDER_ARM_TTL_MS) {
    clearArmedSplitTender();
    return null;
  }
  const payments = armedSplitTender;
  clearArmedSplitTender();
  return payments;
}

function createOfflineToken(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createSaleOperationKey(): string {
  return `sale:${createOfflineToken()}`;
}

async function queueOfflineSale(p: ProcessSalePayload): Promise<string> {
  if (!p.p_shift_id) throw new Error('SHIFT_REQUIRED_OFFLINE');

  // getSession() reads the persisted local Supabase session and therefore works
  // while offline. Never accept a financially relevant outbox row without a
  // durable originating user identity: a later login on the same device must not
  // be able to sync this sale under a different cashier.
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const originatingUserId = sessionData.session?.user?.id || null;
  if (sessionError || !originatingUserId) throw new Error('AUTH_REQUIRED_OFFLINE');

  const id = `offline_sale_${createOfflineToken()}`;
  const operationKey = p.p_client_operation_key?.trim() || id;
  const queuedSale: OwnedOfflineSaleQueueItem = {
    id,
    client_id: id,
    created_by_user_id: originatingUserId,
    invoice_number: p.p_invoice_number,
    created_at: new Date().toISOString(),
    payload: {
      ...p,
      p_client_operation_key: operationKey,
    } as unknown as Record<string, unknown>,
  };
  await enqueueOfflineSale(queuedSale);

  // Record local stock movements in the authoritative local ledger
  if (Array.isArray(p.p_items)) {
    for (const item of p.p_items) {
      if (item.product_id) {
        await InventoryRepository.recordLocalMovement({
          id: `mov_${createOfflineToken()}`,
          productId: item.product_id,
          branchId: p.p_branch_id,
          quantityDelta: -Number(item.quantity || 0),
          reason: 'sale',
          referenceId: p.p_invoice_number,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  return id;
}

async function resolveSharedBranchShift(p: ProcessSalePayload): Promise<{ payload: ProcessSalePayload | null; error: string | null }> {
  if (p.p_shift_id) return { payload: p, error: null };

  try {
    const { data, error } = await posApi.getActiveShift({ p_branch_id: p.p_branch_id });
    if (error) return { payload: null, error: error.message || 'Could not verify active shift' };

    const result = data as unknown as { open?: boolean; shift?: { id?: string | null } | null } | null;
    const shiftId = result?.open ? result.shift?.id || null : null;
    if (!shiftId) return { payload: null, error: 'SHIFT_REQUIRED' };

    return { payload: { ...p, p_shift_id: shiftId }, error: null };
  } catch (err) {
    return { payload: null, error: err instanceof Error ? err.message : 'Could not verify active shift' };
  }
}

export async function requestManualPaymentApproval(input: {
  branchId: string;
  method: ManualPaymentMethod;
  amount: number;
  reference: string;
  senderName?: string | null;
  note?: string | null;
}): Promise<{ requestId: string | null; status: ManualPaymentApprovalStatus | null; error: string | null }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { requestId: null, status: null, error: 'Manual transfer confirmation requires an online connection.' };
  }

  try {
    const { data, error } = await posApi.requestManualPaymentApproval({
      p_branch_id: input.branchId,
      p_method: input.method,
      p_amount: Number(input.amount),
      p_reference: input.reference.trim(),
      p_sender_name: input.senderName?.trim() || null,
      p_note: input.note?.trim() || null,
    });
    const result = data as { success?: boolean; request_id?: string; status?: string; error?: string; detail?: string } | null;
    if (error || !result?.success || !result.request_id) {
      return {
        requestId: null,
        status: null,
        error: error?.message || result?.detail || result?.error || 'Could not request payment confirmation.',
      };
    }
    return {
      requestId: result.request_id,
      status: (result.status || 'pending') as ManualPaymentApprovalStatus,
      error: null,
    };
  } catch (err) {
    return { requestId: null, status: null, error: err instanceof Error ? err.message : 'Could not request payment confirmation.' };
  }
}

export async function getManualPaymentApprovalStatus(requestId: string): Promise<{
  status: ManualPaymentApprovalStatus | null;
  error: string | null;
}> {
  try {
    const { data, error } = await posApi.manualPaymentApprovalStatus({ p_request_id: requestId });
    const result = data as { success?: boolean; status?: string; error?: string; detail?: string } | null;
    if (error || !result?.success) {
      return { status: null, error: error?.message || result?.detail || result?.error || 'Could not check payment confirmation.' };
    }
    return { status: (result.status || null) as ManualPaymentApprovalStatus | null, error: null };
  } catch (err) {
    return { status: null, error: err instanceof Error ? err.message : 'Could not check payment confirmation.' };
  }
}

export async function processSaleForOrder(p: ProcessSalePayload): Promise<{ result: ProcessSaleResult | null; error: string | null }> {
  // Authoritative Business Logic Check: Negative Stock Policy
  // If negative stock is disabled, check effective available stock (accounting for unsynced local outbox sales)
  const branchSettings = await SettingsRepository.getBranchSettings(p.p_branch_id);
  const globalSettings = await SettingsRepository.getGlobalSettings();
  const allowNegative = branchSettings?.allow_negative_stock ?? globalSettings?.allow_negative_stock ?? false;

  if (!allowNegative && Array.isArray(p.p_items) && p.p_items.length > 0) {
    const productQuantities: Record<string, number> = {};
    for (const item of p.p_items) {
      if (!item.product_id) continue;
      productQuantities[item.product_id] = (productQuantities[item.product_id] || 0) + (Number(item.quantity) || 0);
    }
    for (const [productId, requestedQty] of Object.entries(productQuantities)) {
      const available = await InventoryRepository.getEffectiveAvailableStock(productId, p.p_branch_id);
      if (requestedQty > available) {
        return {
          result: null,
          error: `INSUFFICIENT_STOCK: Required ${requestedQty}, but only ${available} is available. Negative stock is disabled.`,
        };
      }
    }
  }

  const splitPayments = consumeArmedSplitTender();

  // Split tender is intentionally online-only. It must never degrade into an
  // offline queue because that could produce partial financial truth.
  if (splitPayments && typeof navigator !== 'undefined' && !navigator.onLine) {
    return { result: null, error: 'Split payment requires an online connection.' };
  }

  // Explicit offline sales are accepted only into the authoritative IndexedDB
  // outbox. They are pending reconciliation, not a server-confirmed payment.
  if (!splitPayments && typeof navigator !== 'undefined' && !navigator.onLine) {
    try {
      const queuedId = await queueOfflineSale(p);
      return {
        result: {
          success: true,
          offline: true,
          pending_sync: true,
          sale_id: queuedId,
          order_id: p.p_order_id || undefined,
        },
        error: null,
      };
    } catch (err) {
      // If the durable local outbox cannot persist the sale, fail closed. A
      // volatile/in-memory success would be indistinguishable from data loss.
      return {
        result: null,
        error: err instanceof Error ? err.message : 'Could not save the offline sale safely.',
      };
    }
  }

  // Shared shifts are branch-level operational state, not cashier-only state.
  // Older callers may omit p_shift_id for non-cashier users, so resolve the
  // authoritative open branch shift before either normal or split settlement.
  const resolvedShift = await resolveSharedBranchShift(p);
  if (!resolvedShift.payload) return { result: null, error: resolvedShift.error || 'SHIFT_REQUIRED' };
  const settlementPayloadBase = resolvedShift.payload;

  const isManualPayment = settlementPayloadBase.p_payment_method === 'instapay'
    || settlementPayloadBase.p_payment_method === 'bank_transfer';

  if (isManualPayment) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { result: null, error: 'Manual transfer confirmation requires an online connection.' };
    }

    const approval = consumeArmedManualPayment();
    if (!approval) {
      return { result: null, error: 'PAYMENT_APPROVAL_REQUIRED' };
    }

    if (
      approval.method !== settlementPayloadBase.p_payment_method
      || Math.abs(Number(approval.amount) - Number(settlementPayloadBase.p_paid_amount || settlementPayloadBase.p_total)) > 0.01
    ) {
      return { result: null, error: 'PAYMENT_APPROVAL_SCOPE_MISMATCH' };
    }

    try {
      const { p_paid_amount: _paidAmount, p_client_operation_key: _operationKey, ...manualPayload } = settlementPayloadBase;
      void _operationKey;
      void _paidAmount;
      const { data, error } = await posApi.processSaleManualPayment({
        ...manualPayload,
        p_approval_request_id: approval.requestId,
        p_manual_reference: approval.reference,
        p_payment_method: approval.method,
      });
      const result = data as RpcResult | null;
      if (error || !result?.success) {
        return { result, error: error?.message || result?.detail || result?.error || 'Manual payment sale failed' };
      }

      if (Array.isArray(p.p_items)) {
        for (const item of p.p_items) {
          if (item.product_id) {
            await InventoryRepository.recordLocalMovement({
              id: `mov_${createOfflineToken()}`,
              productId: item.product_id,
              branchId: p.p_branch_id,
              quantityDelta: -Number(item.quantity || 0),
              reason: 'sale',
              referenceId: p.p_invoice_number,
              createdAt: new Date().toISOString(),
              synced: true,
            });
          }
        }
      }

      return {
        result: {
          ...result,
          payments: [{
            payment_method: approval.method,
            amount: Number(approval.amount),
          }],
        },
        error: null,
      };
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : 'Network error while processing manual payment sale' };
    }
  }

  const settlementPayload = {
    ...settlementPayloadBase,
    p_client_operation_key: settlementPayloadBase.p_client_operation_key?.trim() || createSaleOperationKey(),
  };

  if (splitPayments) {
    const { p_paid_amount: _paidAmount, p_payment_method: _paymentMethod, ...splitBase } = settlementPayload;
    void _paidAmount;
    void _paymentMethod;
    const splitResult = await processSplitSaleForOrder({ ...splitBase, p_payments: splitPayments });
    return {
      ...splitResult,
      result: splitResult.result?.success
        ? { ...splitResult.result, payments: splitPayments }
        : splitResult.result,
    };
  }

  try {
    const { data, error } = await posApi.processSaleIdempotent(settlementPayload);
    if (!error && (data as { success?: boolean })?.success) {
      if (Array.isArray(p.p_items)) {
        for (const item of p.p_items) {
          if (item.product_id) {
            await InventoryRepository.recordLocalMovement({
              id: `mov_${createOfflineToken()}`,
              productId: item.product_id,
              branchId: p.p_branch_id,
              quantityDelta: -Number(item.quantity || 0),
              reason: 'sale',
              referenceId: p.p_invoice_number,
              createdAt: new Date().toISOString(),
              synced: true,
            });
          }
        }
      }

      return {
        result: {
          ...(data as RpcResult),
          payments: [{
            payment_method: settlementPayloadBase.p_payment_method,
            amount: Number(settlementPayloadBase.p_paid_amount || 0),
          }],
        },
        error: null,
      };
    }

    // A server rejection (approval, stock, subscription, validation, etc.) is
    // authoritative and must never be converted into a successful offline sale.
    const result = data as RpcResult | null;
    return { result, error: error?.message || result?.detail || result?.error || 'Sale processing failed' };
  } catch (err) {
    // Do not enqueue after an ambiguous online failure: the server may have
    // committed before the response was lost, which would create a duplicate.
    return { result: null, error: err instanceof Error ? err.message : 'Network error while processing sale' };
  }
}

export async function processSplitSaleForOrder(p: ProcessSplitSalePayload): Promise<{ result: (RpcResult & { split?: boolean; payment_count?: number }) | null; error: string | null }> {
  // Do not queue split tender offline until the offline outbox has a dedicated
  // idempotent split contract. A partial local recreation would be financially unsafe.
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { result: null, error: 'Split payment requires an online connection.' };
  }

  try {
    const payload = {
      ...p,
      p_client_operation_key: p.p_client_operation_key?.trim() || createSaleOperationKey(),
    };
    const { data, error } = await posApi.processSaleSplitIdempotent(payload);
    const result = data as (RpcResult & { split?: boolean; payment_count?: number }) | null;
    if (!error && result?.success) return { result, error: null };

    // A server rejection from process_sale_split is authoritative too; never
    // degrade it into the normal offline queue or a second financial attempt.
    return { result, error: error?.message || result?.detail || result?.error || 'Split sale processing failed' };
  } catch (err) {
    // The server may have committed before the network response disappeared.
    return { result: null, error: err instanceof Error ? err.message : 'Network error while processing split sale' };
  }
}

export async function nextInvoiceNumber(): Promise<string> {
  const makeOffInvoice = () => {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `INV-OFF-${dateStr}-${createOfflineToken()}`;
  };

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return makeOffInvoice();
  }

  try {
    const { data, error } = await posApi.nextDocumentNumber({ p_type: 'sale' });
    const number = !error && data?.success ? (data as { number?: string }).number : null;
    if (number) return number;
    return makeOffInvoice();
  } catch {
    return makeOffInvoice();
  }
}

export async function fetchBranchWarehouseId(branchId: string, orderId?: string | null): Promise<string | null> {
  try {
    if (orderId) {
      const { data: order } = await supabase
        .from('orders')
        .select('inventory_warehouse_id')
        .eq('id', orderId)
        .eq('branch_id', branchId)
        .maybeSingle();
      const orderWarehouseId = (order as { inventory_warehouse_id?: string | null } | null)?.inventory_warehouse_id;
      if (orderWarehouseId) return orderWarehouseId;
    }

    const { data } = await supabase
      .from('warehouses')
      .select('id,is_default,created_at')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    const rows = (data as { id: string }[] | null) || [];
    return rows.length > 0 ? rows[0].id : null;
  } catch {
    return null;
  }
}
