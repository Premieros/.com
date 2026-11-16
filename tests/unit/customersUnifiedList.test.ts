import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/features/parties/pages/CustomersPage.tsx', 'utf8');

describe('Customers page unified single table', () => {
  it('shows exactly one table for registered and QR visitors', () => {
    expect(source).not.toContain('<QrCustomerHistoryPanel');
    expect(source).toContain("tableId=\"customers\"");
    expect(source).toContain('...items,');
    expect(source).toContain('...qrGuests.filter(');
    expect(source).toContain('map(toQrCustomerRow)');
    expect(source).toContain("key: 'source'");
    expect(source).toContain('testId="customers-search"');
    expect(source).toContain('testId="customers-table-panel"');
    expect(source).not.toContain('testId="customers-search-panel"');
  });

  it('keeps branch scoping, customer identity and financial records separate', () => {
    expect(source).toContain('branchScope.selectedBranchIds.map(');
    expect(source).toContain('guest.branch_id === id');
    expect(source).toContain('branchScope.selectedBranchSet.has(guest.branch_id)');
    expect(source).toContain('qrHistory?: QrCustomerHistory');
    expect(source).toContain("if (isQrGuest(c)) return");
    expect(source).toContain("!isQrGuest(c) && can('customers.manage')");
    expect(source).toContain('setSelectedQrGuest(row.qrHistory)');
    expect(source).toContain('data-testid="qr-customer-details"');
    expect(source).toContain('qrLoadError &&');
  });
});
