import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
import { GuestEntryGate, TableCamera } from '@/features/qr/GuestEntryGate';
const token = 'a'.repeat(64);
const identity = { id: 'visit', order_type: 'delivery', table_id: null, has_request: false, status: 'pending', pin_set: false };
const menu = { branch_name: 'مطعم اختبار', currency: 'ج.م', tables: [], products: [{ id: 'p1', name: 'Tea', price: 25 }] };
const empty = { requests: [], bills: [], calls: [] };
describe('customer phone entry and recovery', () => {
  beforeEach(() => {
    cleanup(); localStorage.clear(); sessionStorage.clear(); mocks.rpc.mockReset();
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'qr_guest_entry' ? { enabled: true, tables: [] } : name === 'qr_guest_menu' ? menu : name === 'qr_guest_track' ? empty : name === 'qr_guest_lookup' ? { registered: false, needs_pin: false } : name === 'qr_guest_begin' ? identity : name === 'qr_guest_place' ? { id: 'request', recovery_code: '07' } : null, error: null }));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it('never asks a new customer for a PIN and shows the two digits after the first submission', async () => {
    render(<GuestEntryGate token={token} />);
    fireEvent.change(await screen.findByLabelText('رقم الهاتف'), { target: { value: '01012345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'متابعة' }));
    fireEvent.change(await screen.findByLabelText('اسمك'), { target: { value: 'عميل اختبار' } });
    fireEvent.click(screen.getByRole('button', { name: 'متابعة' }));
    fireEvent.click(await screen.findByRole('button', { name: 'توصيل' }));
    fireEvent.change(screen.getByLabelText('عنوان التوصيل'), { target: { value: 'عنوان توصيل واضح' } });
    fireEvent.click(screen.getByRole('button', { name: 'دخول المنيو' }));
    fireEvent.click(await screen.findByRole('button', { name: 'إضافة Tea' }));
    fireEvent.click(screen.getByRole('button', { name: /أضف إلى السلة/ }));
    fireEvent.click(screen.getByRole('button', { name: /فتح السلة/ }));
    expect(screen.queryByLabelText('رمز استرجاع الطلب')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'إرسال الطلب للموظف' }));
    expect(await screen.findByText('07')).toBeInTheDocument();
    expect(screen.getByText(/احتفظ به لفتح طلبك/)).toBeInTheDocument();
    expect(mocks.rpc.mock.calls.find(([name]) => name === 'qr_guest_place')?.[1]).toMatchObject({ p_table: null });
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'qr_guest_resume')).toBe(false);
  });
  it('requires a code for an active phone on a new device without revealing its bill first', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'qr_guest_entry' ? { enabled: true } : { registered: true, needs_pin: true, pin_set: true }, error: null }));
    render(<GuestEntryGate token={token} />);
    fireEvent.change(await screen.findByLabelText('رقم الهاتف'), { target: { value: '01012345678' } }); fireEvent.click(screen.getByRole('button', { name: 'متابعة' }));
    await screen.findByLabelText('رمز استرجاع الطلب'); expect(screen.queryByLabelText('اسمك')).not.toBeInTheDocument();
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'qr_guest_track')).toBe(false);
  });
  it('resumes the trusted device directly on its order and disables table changing', async () => {
    const tableVisit = { ...identity, order_type: 'dine_in', table_id: 't1', has_request: true };
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'qr_guest_entry' ? { enabled: true, visit: tableVisit } : name === 'qr_guest_menu' ? { ...menu, tables: [{ id: 't1', name: 'Table A' }] } : empty, error: null }));
    render(<GuestEntryGate token={token} />);
    await screen.findByRole('heading', { name: 'طلبي وحسابي' }); expect(screen.queryByLabelText('رقم الهاتف')).not.toBeInTheDocument();
    expect(screen.getByLabelText('طاولتك المعتمدة')).toBeDisabled();
    await waitFor(() => expect(screen.getByLabelText('طاولتك المعتمدة')).toHaveValue('t1'));
  });
  it('stops all camera tracks after capture and bounds the JPEG size', async () => {
    const stop = vi.fn(); const captured = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,/9j/AAA');
    const view = render(<TableCamera onCapture={captured} />); const video = screen.getByLabelText('كاميرا رقم الطاولة');
    Object.defineProperties(video, { videoWidth: { value: 1600 }, videoHeight: { value: 1200 } });
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()); fireEvent.loadedData(video); fireEvent.click(screen.getByRole('button', { name: 'تصوير رقم الطاولة' }));
    expect(captured).toHaveBeenCalledWith('data:image/jpeg;base64,/9j/AAA'); view.unmount(); expect(stop).toHaveBeenCalledOnce();
  });
});
