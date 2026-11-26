import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), create: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => { mocks.create(...args); return { rpc: mocks.rpc }; } }));
import { PublicQrMenu } from '@/features/qr/PublicQrMenu';
const token = 'a'.repeat(64);
const menu = { table_name: 'Table A', table_id: 't1', branch_name: 'Our Cafe', currency: 'ج.م', tables: [{id:'t1',name:'Table A',busy:false},{id:'t2',name:'Table B',busy:false}], products: [{ id: 'p1', name: 'Tea', price: 25 }] };

describe('public QR mobile order intake', () => {
  beforeEach(() => {
    cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); mocks.rpc.mockReset();
    mocks.rpc.mockImplementation((name: string) => Promise.resolve(name === 'qr_menu' ? { data: menu, error: null } : { data: { id: 'r1', status: 'pending' }, error: null }));
  });
  it('uses a nonpersistent anonymous client and renders the table without login', async () => {
    render(<PublicQrMenu token={token} />);
    expect(await screen.findByRole('heading', { name: 'Tea' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /فتح السلة/ }));
    expect(screen.getByText('Table A')).toBeInTheDocument();
    expect(mocks.create.mock.calls.map(call => call[2])).toContainEqual({ auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    expect(screen.queryByText('Login')).not.toBeInTheDocument();
  });
  it('restores the private visit after reload and shows its pending request', async () => {
    const tracking = { requests: [{ id: 'own-request', status: 'pending', items: [], created_at: '2026-11-14T00:00:00Z', requested_table: 'Table A' }], bills: [], calls: [] };
    mocks.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === 'qr_menu' ? menu : tracking }));
    const view = render(<PublicQrMenu token={token} />); await screen.findByRole('heading', { name: 'Tea' });
    fireEvent.click(screen.getByRole('button', { name: 'طلبي وحسابي' }));
    await screen.findByText('بانتظار اعتماد الموظف');
    const firstSecret = mocks.rpc.mock.calls.find(([name]) => name === 'qr_track')?.[1].p_session;
    expect(firstSecret).toMatch(/^[a-f0-9]{64}$/);
    view.unmount(); render(<PublicQrMenu token={token} />); await screen.findByRole('heading', { name: 'Tea' });
    fireEvent.click(screen.getByRole('button', { name: 'طلبي وحسابي' })); await screen.findByText('بانتظار اعتماد الموظف');
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'qr_track').slice(-1)[0]?.[1].p_session).toBe(firstSecret);
  });
  it('uses the catalog sprite frame instead of enlarging the entire sheet, and preserves full photos', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...menu, products: [
      { id: 'sprite', name: 'Tea', price: 25, image_url: 'https://premieros.github.io/.com/catalog-product-sprite.svg#coffee-hot-p31' },
      { id: 'photo', name: 'Cake', price: 50, image_url: 'https://example.com/cake.jpg' },
    ] } });
    render(<PublicQrMenu token={token} />);
    const sprite = await screen.findByRole('img', { name: 'Tea' });
    expect(sprite).toHaveAttribute('data-product-sprite-frame', 'true');
    expect(sprite.firstElementChild).toHaveStyle({ backgroundPosition: '100% 55.55555555555556%', backgroundSize: '800% 3700%' });
    expect(screen.getByRole('img', { name: 'Cake' })).toHaveClass('customer-full-image');
    fireEvent.click(screen.getByRole('button', { name: 'تفاصيل Tea' }));
    expect(screen.getByRole('img', { name: 'Tea' })).toHaveClass('customer-image-large');
  });
  it('filters the cafe menu through accessible category tabs', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'qr_menu' ? {
      ...menu, products: [{ ...menu.products[0], category_id: 'drinks', category_name: 'مشروبات' },
        { id: 'p2', name: 'Cake', price: 40, category_id: 'desserts', category_name: 'حلويات' }],
    } : null, error: null }));
    render(<PublicQrMenu token={token} />);
    fireEvent.click(await screen.findByRole('button', { name: 'حلويات' }));
    expect(screen.getByRole('button', { name: 'حلويات' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Cake' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tea' })).not.toBeInTheDocument();
  });
  it('prevents rapid double submission and confirms pending status', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mocks.rpc.mockImplementation((name: string) => name === 'qr_menu' ? Promise.resolve({ data: menu }) : new Promise(done => { resolve = done; }));
    render(<PublicQrMenu token={token} />); await screen.findByRole('heading', { name: 'Tea' });
    fireEvent.click(screen.getByRole('button', {name:'إضافة Tea'}));
    fireEvent.click(screen.getByRole('button', {name:'زيادة الكمية'}));
    fireEvent.click(screen.getByRole('button', {name:/أضف إلى السلة/}));
    fireEvent.click(screen.getByRole('button', {name:/فتح السلة/}));
    fireEvent.change(screen.getByLabelText('اختر طاولتك'), { target: { value: 't2' } });
    const send = screen.getByRole('button', { name: 'إرسال الطلب للموظف' });
    fireEvent.click(send); fireEvent.click(send);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'qr_place')).toHaveLength(1);
    expect(mocks.rpc.mock.calls.find(([name]) => name === 'qr_place')?.[1].p_table).toBe('t2');
    resolve({ data: { id: 'r1', status: 'pending' }, error: null });
    expect(await screen.findByText(/وصل طلبك للموظف/)).toBeInTheDocument();
  });
  it('reuses the same payload and request key after an ambiguous network failure and reload', async () => {
    mocks.rpc.mockImplementation((name: string) => Promise.resolve(name === 'qr_menu' ? { data: menu } : { error: { message: 'Network disconnected' } }));
    const rendered = render(<PublicQrMenu token={token} />); await screen.findByRole('heading', { name: 'Tea' });
    fireEvent.click(screen.getByRole('button', {name:'إضافة Tea'}));
    fireEvent.click(screen.getByRole('button', {name:'زيادة الكمية'}));
    fireEvent.click(screen.getByRole('button', {name:/أضف إلى السلة/}));
    fireEvent.click(screen.getByRole('button', {name:/فتح السلة/}));
    fireEvent.change(screen.getByLabelText('اختر طاولتك'), { target: { value: 't2' } });
    fireEvent.click(screen.getByRole('button', { name: 'إرسال الطلب للموظف' }));
    await screen.findByRole('alert');
    const first = mocks.rpc.mock.calls.find(([name]) => name === 'qr_place')?.[1];
    rendered.unmount(); render(<PublicQrMenu token={token} />); await screen.findByLabelText('كمية Tea');
    expect(screen.getByLabelText('كمية Tea')).toHaveValue(2);
    fireEvent.click(screen.getByRole('button', { name: 'إعادة إرسال نفس الطلب بأمان' }));
    await waitFor(() => expect(mocks.rpc.mock.calls.filter(([name]) => name === 'qr_place')).toHaveLength(2));
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'qr_place')[1][1]).toEqual(first);
    expect(screen.getByLabelText('كمية Tea')).toBeDisabled();
  });
});
