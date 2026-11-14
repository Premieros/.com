import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), create: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => { mocks.create(...args); return { rpc: mocks.rpc }; } }));
import { PublicQrMenu } from '@/features/qr/PublicQrMenu';
const token = 'a'.repeat(64);
const menu = { table_name: 'Table A', table_id: 't1', branch_name: 'Our Cafe', currency: 'ج.م', tables: [{id:'t1',name:'Table A',busy:false},{id:'t2',name:'Table B',busy:false}], products: [{ id: 'p1', name: 'Tea', price: 25 }] };

describe('public QR mobile order intake', () => {
  beforeEach(() => {
    cleanup(); window.sessionStorage.clear(); mocks.rpc.mockReset();
    mocks.rpc.mockImplementation((name: string) => Promise.resolve(name === 'qr_menu' ? { data: menu, error: null } : { data: { id: 'r1', status: 'pending' }, error: null }));
  });
  it('uses a nonpersistent anonymous client and renders the table without login', async () => {
    render(<PublicQrMenu token={token} />);
    expect(await screen.findByText('Table A')).toBeInTheDocument();
    expect(mocks.create.mock.calls[0][2]).toEqual({ auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    expect(screen.queryByText('Login')).not.toBeInTheDocument();
  });
  it('uses the catalog sprite frame instead of enlarging the entire sheet, and preserves full photos', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...menu, products: [
      { id: 'sprite', name: 'Tea', price: 25, image_url: 'https://premieros.github.io/johna-s/catalog-product-sprite.svg#coffee-hot-p31' },
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
  it('scrolls category navigation in both RTL directions without selecting another category', async () => {
    render(<PublicQrMenu token={token} />); await screen.findByText('Table A');
    const categories = screen.getByLabelText('أقسام المنيو');
    Object.defineProperties(categories, { scrollWidth: { value: 900 }, clientWidth: { value: 300 } });
    categories.scrollBy = vi.fn();
    fireEvent.scroll(categories);
    fireEvent.click(screen.getByRole('button', { name: 'الأقسام التالية' }));
    expect(categories.scrollBy).toHaveBeenCalledWith({ left: -250, behavior: 'smooth' });
    categories.scrollLeft = -200; fireEvent.scroll(categories);
    fireEvent.click(screen.getByRole('button', { name: 'الأقسام السابقة' }));
    expect(categories.scrollBy).toHaveBeenCalledWith({ left: 250, behavior: 'smooth' });
  });
  it('prevents rapid double submission and confirms pending status', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mocks.rpc.mockImplementation((name: string) => name === 'qr_menu' ? Promise.resolve({ data: menu }) : new Promise(done => { resolve = done; }));
    render(<PublicQrMenu token={token} />); await screen.findByText('Table A');
    fireEvent.change(screen.getByLabelText('اختر طاولتك'), { target: { value: 't2' } });
    fireEvent.click(screen.getByRole('button', {name:'إضافة Tea'}));
    fireEvent.click(screen.getByRole('button', {name:'زيادة الكمية'}));
    fireEvent.click(screen.getByRole('button', {name:/أضف إلى السلة/}));
    fireEvent.click(screen.getByRole('button', {name:/فتح السلة/}));
    const send = screen.getByRole('button', { name: 'إرسال الطلب للموظف' });
    fireEvent.click(send); fireEvent.click(send);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'qr_submit_selected')).toHaveLength(1);
    expect(mocks.rpc.mock.calls.find(([name]) => name === 'qr_submit_selected')?.[1].p_table).toBe('t2');
    resolve({ data: { id: 'r1', status: 'pending' }, error: null });
    expect(await screen.findByText(/بانتظار موافقة الموظف/)).toBeInTheDocument();
  });
  it('reuses the same payload and request key after an ambiguous network failure and reload', async () => {
    mocks.rpc.mockImplementation((name: string) => Promise.resolve(name === 'qr_menu' ? { data: menu } : { error: { message: 'Network disconnected' } }));
    const rendered = render(<PublicQrMenu token={token} />); await screen.findByText('Table A');
    fireEvent.change(screen.getByLabelText('اختر طاولتك'), { target: { value: 't2' } });
    fireEvent.click(screen.getByRole('button', {name:'إضافة Tea'}));
    fireEvent.click(screen.getByRole('button', {name:'زيادة الكمية'}));
    fireEvent.click(screen.getByRole('button', {name:/أضف إلى السلة/}));
    fireEvent.click(screen.getByRole('button', {name:/فتح السلة/}));
    fireEvent.click(screen.getByRole('button', { name: 'إرسال الطلب للموظف' }));
    await screen.findByRole('alert');
    const first = mocks.rpc.mock.calls.find(([name]) => name === 'qr_submit_selected')?.[1];
    rendered.unmount(); render(<PublicQrMenu token={token} />); await screen.findByText('Table A');
    expect(screen.getByLabelText('كمية Tea')).toHaveValue(2);
    fireEvent.click(screen.getByRole('button', { name: 'إعادة إرسال نفس الطلب بأمان' }));
    await waitFor(() => expect(mocks.rpc.mock.calls.filter(([name]) => name === 'qr_submit_selected')).toHaveLength(2));
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'qr_submit_selected')[1][1]).toEqual(first);
    expect(screen.getByLabelText('كمية Tea')).toBeDisabled();
  });
});
