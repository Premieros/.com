import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  'src/features/pos/components/checkout/CashierDiscountApprovalCard.tsx',
  'utf8',
);

describe('discount approval UI must not change or replay an approved action', () => {
  it('binds Realtime approval to the exact submitted discount rather than live input values', () => {
    expect(source).toContain('submittedRequest.current = { type, value: normalizedInput }');
    expect(source).toContain('onApprovedRef.current(submitted.type, submitted.value)');
    expect(source).not.toContain('onApproved(type, type ===');
  });

  it('consumes each approved request at most once', () => {
    expect(source).toContain('approvedRequest.current === requestId');
    expect(source).toContain('approvedRequest.current = requestId');
    expect(source).toContain('approvedRequest.current = null');
  });

  it('locks the request inputs while approval is pending', () => {
    expect(source.match(/disabled={busy \|\| status === 'pending'}/g)).toHaveLength(3);
    expect(source).toContain("if (busy || status === 'pending' || amount <= 0");
  });

  it('checks authoritative request status after subscribing and on visibility return', () => {
    expect(source).toContain(".from('approval_requests')");
    expect(source).toContain("state === 'SUBSCRIBED'");
    expect(source).toContain('submittedSubtotal.current !== subtotalRef.current');
    expect(source).toContain("role=\"alert\"");
  });
  it('retains server-side manager-approval requests, rather than direct client authorization', () => {
    expect(source).toContain("supabase.rpc('request_manager_approval'");
    expect(source).toContain("p_action_type: 'discount'");
    expect(source).toContain('if (res?.success && res.request_id)');
  });
});
