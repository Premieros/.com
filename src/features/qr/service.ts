import { qr } from '@/api/domains/qr';

export interface QrProduct { id: string; name: string; description?: string; price: number }
export interface QrItem { product_id: string; quantity: number; price: number; notes: string; name?: string }
export interface QrRequest { id: string; table_id: string; table_name: string; items: QrItem[]; created_at: string }

export async function qrInbox(branch: string): Promise<QrRequest[]> {
  const { data, error } = await qr.inbox({ p_branch: branch });
  if (error) throw error;
  return data as QrRequest[];
}
export async function qrDecide(id: string, accept: boolean): Promise<{ status: string; order_id: string | null }> {
  const { data, error } = await qr.decide({ p_id: id, p_accept: accept });
  if (error) throw error;
  if (!data) throw new Error('QR_EMPTY_RESPONSE');
  return data;
}
export { qrError } from './errors';
