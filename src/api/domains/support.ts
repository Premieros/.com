import { rpc } from '../rpc';
import type { ApiResult } from '../types';

export interface SupportConversation {
  id: string;
  subject: string;
  status: 'open' | 'closed';
  organization_id: string;
  organization_name?: string | null;
  branch_id: string | null;
  branch_name?: string | null;
  created_by?: string;
  customer_name?: string | null;
  customer_email?: string | null;
  last_message_at: string;
  created_at: string;
  closed_at?: string | null;
}

export interface SupportMessage {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  sender_kind: 'customer' | 'support';
  sender_name?: string | null;
  body: string;
  created_at: string;
}

type RpcEnvelope<T> = {
  success?: boolean;
  error?: string;
  rows?: T[];
  conversation_id?: string;
  message_id?: string;
  status?: string;
};

export const support = {
  openConversation(p: { p_branch_id: string | null; p_subject: string; p_message: string }): ApiResult<RpcEnvelope<SupportConversation>> {
    return rpc('support_open_conversation', p);
  },
  listMyConversations(): ApiResult<RpcEnvelope<SupportConversation>> {
    return rpc('support_list_my_conversations', {});
  },
  listAllConversations(p: { p_status: string | null }): ApiResult<RpcEnvelope<SupportConversation>> {
    return rpc('support_list_all_conversations', p);
  },
  getMessages(p: { p_conversation_id: string }): ApiResult<RpcEnvelope<SupportMessage>> {
    return rpc('support_get_messages', p);
  },
  sendMessage(p: { p_conversation_id: string; p_message: string }): ApiResult<RpcEnvelope<SupportMessage>> {
    return rpc('support_send_message', p);
  },
  setConversationStatus(p: { p_conversation_id: string; p_status: 'open' | 'closed' }): ApiResult<RpcEnvelope<SupportConversation>> {
    return rpc('support_set_conversation_status', p);
  },
};
