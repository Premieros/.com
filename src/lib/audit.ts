import { supabase } from './supabase';

export async function logAudit(action: string, entity: string, entityId?: string, details?: Record<string, unknown>): Promise<void> {
  try {
    // Audit metadata does not make authorization decisions. Reuse the locally
    // persisted session instead of making a network auth round-trip for every
    // business event; RLS still authorizes the insert on the server.
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    await supabase.from('audit_log').insert({
      user_id: user?.id || null,
      user_email: user?.email || null,
      action,
      entity,
      entity_id: entityId || null,
      details: details || null,
    });
  } catch {
    // audit logging should never block the operation
  }
}
