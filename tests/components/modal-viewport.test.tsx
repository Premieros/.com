import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Modal } from '@/components/Modal';

it('renders dialogs outside a glass header so their fixed positioning uses the viewport', () => {
  const { container } = render(
    <header style={{ backdropFilter: 'blur(14px)', position: 'fixed' }}>
      <Modal open onClose={() => undefined} title="Sync center">Sync status</Modal>
    </header>,
  );

  const dialog = screen.getByRole('dialog', { name: 'Sync center' });
  expect(dialog).toBeVisible();
  expect(container.querySelector('header')).not.toContainElement(dialog);
  expect(screen.getByTestId('modal-root').parentElement).toBe(document.body);
});
