import { describe, expect, it } from 'vitest';
import { listTaxIntegrationsForBranch, TAX_INTEGRATION_CATALOG } from '@/features/invoicing/taxIntegrationCatalog';

describe('super admin branch-scoped tax authority catalog', () => {
  it('does not expose a branch catalog before explicit branch selection', () => {
    expect(listTaxIntegrationsForBranch('', ['branch-eg'])).toEqual([]);
  });

  it('does not show catalog for a branch absent from authorized branch list', () => {
    expect(listTaxIntegrationsForBranch('other-tenant-branch', ['branch-eg'])).toEqual([]);
  });

  it('shows all currently implemented foundation workflows after a valid branch selection', () => {
    const systems = listTaxIntegrationsForBranch('branch-eg', ['branch-eg', 'branch-sa']);
    expect(systems.map((item) => item.id)).toEqual([
      'eta-einvoice', 'eta-ereceipt', 'zatca-standard', 'zatca-simplified',
    ]);
    expect(systems.map((item) => item.authority)).toEqual(['ETA', 'ETA', 'ZATCA', 'ZATCA']);
  });

  it('does not infer legal jurisdiction from branch ID or currency', () => {
    expect(listTaxIntegrationsForBranch('branch-sa', ['branch-eg', 'branch-sa']))
      .toEqual(TAX_INTEGRATION_CATALOG);
    expect(TAX_INTEGRATION_CATALOG.every((item) => item.countryCode === 'EG' || item.countryCode === 'SA'))
      .toBe(true);
  });
});
