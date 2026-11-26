import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PageHeader } from '@/components/PageHeader';
import { WorkspaceScrollRow, WorkspaceToolbarTarget } from '@/components/WorkspaceToolbar';

vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'ar' }) }));

it('places page actions in the toolbar and keeps title and description visually hidden', () => {
  const toolbar = document.createElement('div');
  const action = vi.fn();
  const view = render(<WorkspaceToolbarTarget.Provider value={toolbar}>
    <PageHeader title="المطبخ" subtitle="الطلبات" actions={<button onClick={action}>تحديث</button>} />
  </WorkspaceToolbarTarget.Provider>);
  expect(view.getByRole('heading', { name: 'المطبخ' }).parentElement).toHaveClass('sr-only');
  fireEvent.click(within(toolbar).getByRole('button', { name: 'تحديث' }));
  expect(action).toHaveBeenCalledOnce();
  view.unmount();
  expect(toolbar).toBeEmptyDOMElement();
});

it('shows both overflow arrows and scrolls toward the logical RTL end', () => {
  render(<WorkspaceScrollRow><span>المخزون</span></WorkspaceScrollRow>);
  const viewport = screen.getByText('المخزون').parentElement!.parentElement!;
  Object.defineProperties(viewport, {
    clientWidth: { value: 200 },
    scrollWidth: { value: 500 },
    scrollBy: { value: vi.fn() },
  });
  fireEvent.scroll(viewport);
  expect(screen.getByRole('button', { name: 'تمرير نحو البداية' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'تمرير نحو النهاية' }));
  expect(viewport.scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: -160 }));
  viewport.scrollLeft = -300;
  fireEvent.scroll(viewport);
  expect(screen.getByRole('button', { name: 'تمرير نحو النهاية' })).toBeDisabled();
});
