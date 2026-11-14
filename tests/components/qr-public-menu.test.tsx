import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), create: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => { mocks.create(...args); return { rpc: mocks.rpc }; } }));
import { PublicQrMenu } from '@/features/qr/PublicQrMenu';
const token = 'a'.repeat(64);
const menu = { table_name: 'Table A', products: [{ id: 'p1', name: 'Tea', price: 25 }] };

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
  it('prevents rapid double submission and confirms pending status', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mocks.rpc.mockImplementation((name: string) => name === 'qr_menu' ? Promise.resolve({ data: menu }) : new Promise(done => { resolve = done; }));
    render(<PublicQrMenu token={token} />); await screen.findByText('Table A');
    fireEvent.change(screen.getByLabelText('كمية Tea'), { target: { value: '2' } });
    const send = screen.getByRole('button', { name: 'إرسال الطلب للموظف' });
    fireEvent.click(send); fireEvent.click(send);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'qr_submit')).toHaveLength(1);
    resolve({ data: { id: 'r1', status: 'pending' }, error: null });
    expect(await screen.findByText(/بانتظار موافقة الموظف/)).toBeInTheDocument();
  });
  it('reuses the same payload and request key after an ambiguous network failure and reload', async () => {
    mocks.rpc.mockImplementation((name: string) => Promise.resolve(name === 'qr_menu' ? { data: menu } : { error: { message: 'Network disconnected' } }));
    const rendered = render(<PublicQrMenu token={token} />); await screen.findByText('Table A');
    fireEvent.change(screen.getByLabelText('كمية Tea'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'إرسال الطلب للموظف' }));
    await screen.findByRole('alert');
    const first = mocks.rpc.mock.calls.find(([name]) => name === 'qr_submit')?.[1];
    rendered.unmount(); render(<PublicQrMenu token={token} />); await screen.findByText('Table A');
    fireEvent.click(screen.getByRole('button', { name: 'إعادة إرسال نفس الطلب بأمان' }));
    await waitFor(() => expect(mocks.rpc.mock.calls.filter(([name]) => name === 'qr_submit')).toHaveLength(2));
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'qr_submit')[1][1]).toEqual(first);
    expect(screen.getByLabelText('كمية Tea')).toBeDisabled();
  });
});
