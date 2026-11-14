import { qr } from '@/api/domains/qr';

export interface QrProduct { id: string; name: string; description?: string; price: number; image_url?: string; category_id?: string; category_name?: string }
export interface QrTable { id: string; name: string; busy: boolean }
export interface QrAppearance { brand_name?: string; subtitle?: string; logo_url?: string; banner_image_url?: string; banner_text?: string }
export interface QrSettings { enabled: boolean; checkin_enabled?: boolean; appearance: QrAppearance; reviewer_roles: string[] }
export interface QrItem { product_id: string; quantity: number; price: number; notes: string; name?: string }
export interface GuestIdentity { id: string; order_type: 'dine_in' | 'delivery'; table_id: string | null; table_name: string; has_request: boolean; status: string; pin_set: boolean }
export interface StaffVisit { id: string; order_type: string; status: string; order_id?: string; name: string; phone: string; table_name: string; pin_locked: boolean }
export interface QrRequest { visit_id?: string; order_type?: string; customer_name?: string; customer_phone?: string; delivery_address?: string; has_photo?: boolean; photo_verified?: boolean; own_active_order_id?: string; own_active_table_id?: string; id: string; table_id: string | null; table_name: string; items: QrItem[]; created_at: string }
export interface GuestRequest { id: string; status: string; items: QrItem[]; created_at: string; requested_table: string; assigned_table?: string }
export interface GuestBill { has_unsent?: boolean; id: string; order_number: string; status: string; kitchen_status: string; payment_status: string; table_id: string; table_name: string; subtotal: number; discount_amount: number; discount_type: string; tax_amount: number; total: number; paid_amount: number; refunded_amount: number; balance: number; items: { name: string; quantity: number; unit_price: number; total: number }[] }
export interface ServiceCall { order_id?: string; id: string; kind: 'service' | 'check'; note: string; status: 'open' | 'acknowledged' | 'done'; table_name: string; created_at: string }
export interface GuestTracking { visit?: GuestIdentity & { closed?: boolean }; requests: GuestRequest[]; bills: GuestBill[]; calls: ServiceCall[] }

export async function qrInbox(branch: string): Promise<QrRequest[]> {
  const { data, error } = await qr.inbox({ p_branch: branch });
  if (error) throw error;
  return data as QrRequest[];
}
export async function qrDecide(id: string, accept: boolean, table?: string): Promise<{ status: string; order_id: string | null }> {
  const { data, error } = await qr.review({ p_id: id, p_accept: accept, p_table: table || null });
  if (error) throw error;
  if (!data) throw new Error('QR_EMPTY_RESPONSE');
  return data;
}
export { qrError } from './errors';
