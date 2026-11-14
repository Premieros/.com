import { rpc } from '../rpc';

export const qr = {
  saveOrder(p: { p_revision: number; p_payload: object }) { return rpc<import('@/lib/types').RpcResult>('qr_save_order', p); },
  inbox(p: { p_branch: string }) { return rpc('qr_inbox', p); },
  decide(p: { p_id: string; p_accept: boolean }) { return rpc<{ status: string; order_id: string | null }>('qr_decide', p); },
  configure(p: { p_branch: string; p_products: string[] }) { return rpc('qr_configure', p); },
  configuration(p: { p_branch: string }) { return rpc<string[]>('qr_configuration', p); },
  rotate(p: { p_table: string; p_enabled: boolean }) { return rpc<string | null>('qr_rotate', p); },
};
