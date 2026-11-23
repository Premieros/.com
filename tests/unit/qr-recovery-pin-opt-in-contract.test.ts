import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/20261123150000_guest_recovery_pin_explicit_opt_in.sql', 'utf8');
const settings = readFileSync('src/features/qr/CustomerOrderSettings.tsx', 'utf8');
const entry = readFileSync('src/features/qr/GuestEntryGate.tsx', 'utf8');

describe('guest recovery PIN is separate and explicitly opt-in', () => {
  it('defaults off without changing guest check-in functionality', () => {
    expect(sql).toContain('recovery_pin_enabled boolean NOT NULL DEFAULT false');
    expect(settings).toContain('checked={!!settings.recovery_pin_enabled}');
    expect(settings).toContain('checked={!!settings.checkin_enabled}');
    expect(settings).toContain('qr.saveSettingsWithRecovery(');
  });
  it('does not prompt when disabled and does not transfer order to phone-only claimant', () => {
    expect(sql).toContain("'needs_pin',v_has_request AND COALESCE(v_recovery_enabled,false)");
    expect(sql).toContain("'recovery_unavailable',v_has_request AND NOT COALESCE(v_recovery_enabled,false)");
    expect(entry).toContain("else if (data?.recovery_unavailable)");
    expect(entry).toContain("else if (data?.needs_pin) { setStep('pin')");
    expect(sql).toContain("'QR_RECOVERY_DISABLED'");
    expect(sql).toContain('qr_private.resume_visit_if_enabled(p_token,p_session,p_phone,p_pin)');
    expect(sql).toContain('qr_private.resume_visit(p_token,p_session,p_phone,p_pin)');
  });
  it('only lets branch settings managers change the policy', () => {
    expect(sql).toContain('PERFORM qr_private.save_customer_settings(');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.qr_save_customer_settings_with_recovery(');
    expect(sql).toContain('TO authenticated, service_role');
  });
});
