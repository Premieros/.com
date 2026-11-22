import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
import { GuestVisitPanel } from '@/features/qr/GuestVisitPanel';
import type { GuestBill, GuestIdentity } from '@/features/qr/service';
import { TableCamera } from '@/features/qr/TableCamera';
import { GuestEntryGate } from '@/features/qr/GuestEntryGate';
const token = 'a'.repeat(64);
const identity = { id: 'visit', order_type: 'delivery', table_id: null, has_request: false, status: 'pending', pin_set: false };
const menu = { branch_name: 'مطعم اختبار', currency: 'ج.م', tables: [], products: [{ id: 'p1', name: 'Tea', price: 25 }] };
const empty = { requests: [], bills: [], calls: [] };
describe('customer phone entry and recovery', () => {
  beforeEach(() => {
    cleanup(); localStorage.clear(); sessionStorage.clear(); mocks.rpc.mockReset();
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'qr_guest_entry' ? { enabled: true, tables: [] } : name === 'qr_guest_menu' ? menu : name === 'qr_guest_track' ? empty : name === 'qr_guest_lookup' ? { registered: false, needs_pin: false } : name === 'qr_guest_begin' ? identity : name === 'qr_guest_place_delivery' ? { id: 'request', recovery_code: '07' } : null, error: null }));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it('never asks a new customer for a PIN and shows the two digits after the first submission', async () => {
    render(<GuestEntryGate token={token} />);
    fireEvent.click(await screen.findByRole('button', { name: /^توصيل/ }));
    fireEvent.change(await screen.findByLabelText('رقم الهاتف'), { target: { value: '01012345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'متابعة' }));
    fireEvent.change(await screen.findByLabelText('اسمك'), { target: { value: 'عميل اختبار' } });
    fireEvent.click(screen.getByRole('button', { name: 'متابعة' }));
    expect(await screen.findByRole('button', { name: 'الرئيسية' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'التصنيفات' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'إضافة Tea' }));
    fireEvent.click(screen.getByRole('button', { name: /أضف إلى السلة/ }));
    fireEvent.click(screen.getByRole('button', { name: /فتح السلة/ }));
    expect(screen.queryByLabelText('رمز استرجاع الطلب')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('المنطقة')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'متابعة إلى العنوان' }));
    fireEvent.change(screen.getByLabelText('المنطقة'), { target: { value: 'سموحة' } });
    fireEvent.change(screen.getByLabelText('الشارع'), { target: { value: 'شارع النصر' } });
    fireEvent.change(screen.getByLabelText('العمارة والدور أو الشقة'), { target: { value: 'عمارة 12' } });
    fireEvent.click(screen.getByRole('button', { name: 'إرسال الطلب للمطعم' }));
    expect(await screen.findByText('07')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'طلبي وحسابي' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/احتفظ به لفتح طلبك/)).toBeInTheDocument();
    expect(mocks.rpc.mock.calls.find(([name]) => name === 'qr_guest_place_delivery')?.[1]).toMatchObject({ p_address: 'سموحة، شارع النصر، عمارة 12' });
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'qr_guest_resume')).toBe(false);
  });
  it('switches delivery to pickup in the cart without dropping items or sending a table', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === 'qr_guest_entry' ? { enabled: true, visit: identity }
        : name === 'qr_guest_menu' ? menu
        : name === 'qr_guest_change_fulfillment' ? { ...identity, order_type: 'pickup' }
        : name === 'qr_guest_place' ? { id: 'pickup-request' } : empty,
      error: null,
    }));
    render(<GuestEntryGate token={token} />);
    fireEvent.click(await screen.findByRole('button', { name: 'إضافة Tea' }));
    fireEvent.click(screen.getByRole('button', { name: /أضف إلى السلة/ }));
    fireEvent.click(screen.getByRole('button', { name: /فتح السلة/ }));
    fireEvent.click(screen.getByRole('button', { name: 'تغيير نوع الطلب' }));
    fireEvent.change(screen.getByLabelText('كيف تستلم طلبك؟'), { target: { value: 'pickup' } });
    fireEvent.click(screen.getByRole('button', { name: 'اعتماد نوع الطلب' }));
    await waitFor(() => expect(screen.queryByLabelText('كيف تستلم طلبك؟')).not.toBeInTheDocument());
    expect(screen.getByText('استلام من المطعم')).toBeInTheDocument();
    expect(screen.getByLabelText('كمية Tea')).toHaveValue(1);
    expect(screen.queryByRole('button', { name: 'متابعة إلى العنوان' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'إرسال الطلب للموظف' }));
    expect(mocks.rpc.mock.calls.find(([name]) => name === 'qr_guest_place')?.[1]).toMatchObject({ p_table: null, p_items: [{ product_id: 'p1', quantity: 1 }] });
  });

  it('requires a code for an active phone on a new device without revealing its bill first', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'qr_guest_entry' ? { enabled: true } : { registered: true, needs_pin: true, pin_set: true }, error: null }));
    render(<GuestEntryGate token={token} />);
    fireEvent.click(await screen.findByRole('button', { name: /^توصيل/ }));
    fireEvent.change(await screen.findByLabelText('رقم الهاتف'), { target: { value: '01012345678' } }); fireEvent.click(screen.getByRole('button', { name: 'متابعة' }));
    await screen.findByLabelText('رمز استرجاع الطلب'); expect(screen.queryByLabelText('اسمك')).not.toBeInTheDocument();
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'qr_guest_track')).toBe(false);
  });
  it('resumes the trusted device directly on its order and disables table changing', async () => {
    const tableVisit = { ...identity, order_type: 'dine_in', table_id: 't1', has_request: true };
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'qr_guest_entry' ? { enabled: true, visit: tableVisit } : name === 'qr_guest_menu' ? { ...menu, tables: [{ id: 't1', name: 'Table A' }] } : empty, error: null }));
    render(<GuestEntryGate token={token} />);
    await screen.findByRole('heading', { name: 'طلبي وحسابي' }); expect(screen.queryByLabelText('رقم الهاتف')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /فتح السلة/ }));
    await screen.findByText('داخل المطعم · Table A');
    expect(screen.queryByRole('button', { name: 'تغيير نوع الطلب' })).not.toBeInTheDocument();
  });
  it('keeps paid deliveries current until dispatch confirms delivery, then remembers the order on this device', async () => {
    const visit: GuestIdentity = { ...identity, order_type: 'delivery', table_name: '' };
    const bill: GuestBill = {
      id: 'bill', order_number: 'POS-42', status: 'completed', kitchen_status: 'ready',
      dispatch_status: 'on_the_way', payment_status: 'paid', table_id: '', table_name: '',
      subtotal: 50, discount_amount: 0, discount_type: 'amount', tax_amount: 0,
      total: 50, paid_amount: 50, refunded_amount: 0, balance: 0, items: [],
    };
    const props = { token, session: 'private-session', table: '', currency: 'ج.م', error: '', secure: true, refresh: async () => {}, newVisit: () => {} };
    const view = render(<GuestVisitPanel {...props} tracking={{ ...empty, visit, bills: [bill] }} />);
    expect(screen.getByText('توصيل · في الطريق إليك')).toBeInTheDocument();
    view.rerender(<GuestVisitPanel {...props} tracking={{ ...empty, visit, bills: [{ ...bill, dispatch_status: 'delivered' }] }} />);
    expect(screen.getByText('لا توجد طلبات حالية.')).toBeInTheDocument();
    view.unmount();

    render(<GuestEntryGate token={token} />);
    fireEvent.click(await screen.findByRole('button', { name: 'الطلبات السابقة على هذا الجهاز' }));
    expect(screen.getByText('POS-42')).toBeInTheDocument();
    expect(screen.getByText('تم التوصيل')).toBeInTheDocument();
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
