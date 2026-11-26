import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ProductionOrdersPage } from '@/features/manufacturing/pages/ProductionOrdersPage';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en' }) }));
vi.mock('@/lib/permissions', () => ({ useCan: () => () => true }));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => 'qa-branch' }));
vi.mock('@/hooks/useBranches', () => ({ useBranches: () => ({ branches: [] }) }));
vi.mock('@/api', () => ({
  supabase: {
    rpc,
    from: (table: string) => {
      const data = table === 'inventory_units' ? [{ id: 'unit', name: 'QA Group' }]
        : table === 'warehouses' ? [{ id: 'warehouse', name: 'QA Warehouse' }] : [];
      const query = {
        select: () => query,
        eq: () => query,
        order: () => Object.assign(Promise.resolve({ data }), { limit: () => Promise.resolve({ data }) }),
      };
      return query;
    },
  },
}));

it('confirms the selected warehouse and quantity before sending production to Premier', async () => {
  rpc.mockResolvedValue({ data: 'production-id', error: null });
  render(<ProductionOrdersPage />);
  await screen.findByRole('option', { name: 'QA Group' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Manufactured group' }), { target: { value: 'unit' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Warehouse' }), { target: { value: 'warehouse' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity' }), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Complete production' }));
  const modal = within(screen.getByRole('dialog', { name: 'Confirm production' }));
  expect(modal.getByText('QA Group · QA Warehouse · 2')).toBeInTheDocument();
  expect(rpc).not.toHaveBeenCalled();
  fireEvent.click(modal.getByRole('button', { name: 'Confirm production' }));
  expect(await screen.findByText('Production completed; raw and manufactured stock updated.')).toBeInTheDocument();
  expect(rpc).toHaveBeenCalledExactlyOnceWith('produce_inventory_unit', {
    p_branch_id: 'qa-branch', p_unit_id: 'unit', p_warehouse_id: 'warehouse', p_quantity: 2, p_notes: null,
  });
});
