import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/features/accounting/pages/JournalPage.tsx', 'utf8');

describe('journal reversal UI contract', () => {
  it('checks reconciliation permission and a posted entry before offering the reversal action', () => {
    expect(page).toContain("can('accounting.reconciliation.manage') && viewStatus === 'POSTED'");
    expect(page).toContain("viewing.reference_type !== 'journal_reversal'");
    expect(page).toContain(".select('posting_status, reversal_of')");
  });

  it('requires an explicit reason and routes through the protected reversal RPC', () => {
    expect(page).toContain('reverseReason.trim().length < 3');
    expect(page).toContain('api.accounting.reverseJournalEntry({');
    expect(page).toContain('p_entry_id: viewing.id');
    expect(page).toContain('p_reason: reason');
    expect(page).toContain('disabled={reversing || reverseReason.trim().length < 3}');
  });

  it('refreshes journals only after a successful response', () => {
    expect(page).toContain('if (!data?.success)');
    expect(page).toContain('await load();');
  });
});
