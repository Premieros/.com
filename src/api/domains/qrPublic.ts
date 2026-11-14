import { createClient } from '@supabase/supabase-js';
import type { QrItem } from '@/features/qr/service';

// This module has no dependency on the staff client or authentication providers.
const client = createClient(import.meta.env.VITE_SUPABASE_URL || 'https://placeholder-project.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key-for-build',
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const rpc = client.rpc.bind(client);
export const qrPublic = {
  menu(p: { p_token: string }) { return rpc('qr_menu', p); },
  submit(p: { p_token: string; p_key: string; p_items: QrItem[]; p_table: string; p_session: string }) { return rpc('qr_place', p); },
  submitLegacy(p: { p_token: string; p_key: string; p_items: QrItem[]; p_table: string }) { return rpc('qr_submit_selected', p); },
  track(p: { p_token: string; p_session: string }) { return rpc('qr_track', p); },
  callService(p: { p_token: string; p_session: string; p_key: string; p_table: string | null; p_kind: string; p_note: string }) { return rpc('qr_call_service', p); },
};
