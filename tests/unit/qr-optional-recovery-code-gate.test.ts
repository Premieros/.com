import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const entry = readFileSync('src/features/qr/GuestEntryGate.tsx', 'utf8');
const settings = readFileSync('src/features/qr/CustomerOrderSettings.tsx', 'utf8');

describe('guest recovery PIN remains opt-in with branch check-in', () => {
  it('exposes branch check-in as an explicit setting that is saved server-side', () => {
    expect(settings).toContain('checked={!!settings.checkin_enabled}');
    expect(settings).toContain('checkin_enabled: e.target.checked');
    expect(settings).toContain('p_checkin: !!settings.checkin_enabled');
  });

  it('renders the public menu without a guest code when server check-in is off', () => {
    expect(entry).toContain("if (entry?.enabled === false) return <PublicQrMenu token={token} />");
  });

  it('only prompts for recovery PIN when server lookup explicitly requires it', () => {
    expect(entry).toContain("else if (data?.needs_pin) { setStep('pin')");
    expect(entry).toContain("step === 'pin' &&");
    expect(entry).toContain("qrPublic.resume({ p_token: token, p_session: session, p_phone: phone, p_pin: pin })");
    expect(entry).not.toContain("setStep('pin'); setStep('type')");
  });
});
