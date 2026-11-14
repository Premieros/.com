import { createClient } from '@supabase/supabase-js';
import type { QrItem } from '@/features/qr/service';

// This module has no dependency on the staff client or authentication providers.
const client = createClient(import.meta.env.VITE_SUPABASE_URL || 'https://placeholder-project.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key-for-build',
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const rpc = client.rpc.bind(client);
export const qrPublic = {
  entry(p: { p_token: string; p_session: string }) { return rpc('qr_guest_entry', p); },
  lookup(p: { p_token: string; p_session: string; p_phone: string }) { return rpc('qr_guest_lookup', p); },
  begin(p: { p_token: string; p_session: string; p_phone: string; p_name: string; p_type: string; p_table: string | null; p_photo: string | null; p_address: string | null }) { return rpc('qr_guest_begin', p); },
  resume(p: { p_token: string; p_session: string; p_phone: string; p_pin: string }) { return rpc('qr_guest_resume', p); },
  guestMenu(p: { p_token: string; p_session: string }) { return rpc('qr_guest_menu', p); },
  guestTrack(p: { p_token: string; p_session: string }) { return rpc('qr_guest_track', p); },
  guestSubmit(p: { p_token: string; p_session: string; p_key: string; p_items: QrItem[]; p_table: string | null }) { return rpc('qr_guest_place', p); },
  guestCall(p: { p_token: string; p_session: string; p_key: string; p_table: string | null; p_kind: string; p_note: string }) { return rpc('qr_guest_call', p); },
  menu(p: { p_token: string }) { return rpc('qr_menu', p); },
  submit(p: { p_token: string; p_key: string; p_items: QrItem[]; p_table: string; p_session: string }) { return rpc('qr_place', p); },
  submitLegacy(p: { p_token: string; p_key: string; p_items: QrItem[]; p_table: string }) { return rpc('qr_submit_selected', p); },
  track(p: { p_token: string; p_session: string }) { return rpc('qr_track', p); },
  callService(p: { p_token: string; p_session: string; p_key: string; p_table: string | null; p_kind: string; p_note: string }) { return rpc('qr_call_service', p); },
};
