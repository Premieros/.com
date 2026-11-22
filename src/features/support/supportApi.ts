import { rpc } from '@/api/rpc';

export type SupportKind = 'inquiry' | 'complaint';

export interface SupportMessage {
  id: string;
  body: string;
  from_staff: boolean;
  created_at: string;
}

export interface SupportThread {
  id: string;
  kind: SupportKind;
  created_at: string;
  latest_message: string;
  answered: boolean;
}

export const supportApi = {
  qrBranch: (token: string) => rpc<string>('customer_support_qr_branch', { p_token: token }),
  start: (branch: string, kind: SupportKind, body: string, code: string) =>
    rpc<string>('customer_support_start', { p_branch: branch, p_kind: kind, p_body: body, p_code: code }),
  follow: (branch: string, code: string, body?: string) =>
    rpc<SupportMessage[]>('customer_support_follow', { p_branch: branch, p_code: code, p_body: body ?? null }),
  list: (branch: string, before?: string) =>
    rpc<SupportThread[]>('customer_support_staff_list', { p_branch: branch, p_before: before ?? null }),
  thread: (branch: string, id: string, body?: string) =>
    rpc<SupportMessage[]>('customer_support_staff_thread', { p_branch: branch, p_thread: id, p_body: body ?? null }),
};
