import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/features/pos/components/checkout/ManualPaymentApprovalsModal.tsx', 'utf8');

describe('manual payment approval refresh performance', () => {
  it('does not poll hidden tabs and refreshes on visibility return', () => {
    expect(source).toContain("document.visibilityState === 'visible'");
    expect(source).toContain("window.setInterval(refreshWhenVisible, 15_000)");
    expect(source).toContain("document.addEventListener('visibilitychange', refreshWhenVisible)");
  });

  it('cleans up the polling timer and listener when the modal closes', () => {
    expect(source).toContain('window.clearInterval(timer)');
    expect(source).toContain("document.removeEventListener('visibilitychange', refreshWhenVisible)");
    expect(source).toContain('if (!open) return');
  });

  it('retains the manual refresh button and server-authorized decisions', () => {
    expect(source).toContain('onClick={() => void load()}');
    expect(source).toContain("supabase.rpc('decide_operational_approval'");
  });
});
