import { rpc } from '../rpc';

export const qr = {
  visits(p: { p_branch: string }) { return rpc<import('@/features/qr/service').StaffVisit[]>('qr_guest_visits', p); },
  photo(p: { p_visit: string; p_verify: boolean }) { return rpc<string>('qr_guest_photo', p); },
  resetPin(p: { p_visit: string }) { return rpc<string>('qr_guest_reset_pin', p); },
  endVisit(p: { p_visit: string }) { return rpc('qr_guest_end', p); },
  saveServiceOrder(p: { p_revision: number; p_payload: object; p_details: object | null }) { return rpc<import('@/lib/types').RpcResult>('qr_save_service_order', p); },
  calls(p: { p_branch: string }) { return rpc<import('@/features/qr/service').ServiceCall[]>('qr_calls', p); },
  handleCall(p: { p_id: string; p_status: string }) { return rpc('qr_handle_call', p); },
  routing(p: { p_branch: string }) { return rpc<{ tables: import('@/features/qr/service').QrTable[]; can_review: boolean }>('qr_routing', p); },
  settings(p: { p_branch: string }) { return rpc<import('@/features/qr/service').QrSettings>('qr_settings', p); },
  saveSettings(p: { p_branch: string; p_enabled: boolean; p_appearance: import('@/features/qr/service').QrAppearance; p_roles: string[]; p_checkin: boolean }) { return rpc('qr_save_customer_settings', p); },
  review(p: { p_id: string; p_accept: boolean; p_table: string | null }) { return rpc<{ status: string; order_id: string | null }>('qr_review', p); },
  saveOrder(p: { p_revision: number; p_payload: object }) { return rpc<import('@/lib/types').RpcResult>('qr_save_order', p); },
  inbox(p: { p_branch: string }) { return rpc('qr_inbox', p); },
  decide(p: { p_id: string; p_accept: boolean }) { return rpc<{ status: string; order_id: string | null }>('qr_decide', p); },
  configure(p: { p_branch: string; p_products: string[] }) { return rpc('qr_configure', p); },
  configuration(p: { p_branch: string }) { return rpc<string[]>('qr_configuration', p); },
  rotate(p: { p_table: string; p_enabled: boolean }) { return rpc<string | null>('qr_rotate', p); },
};
