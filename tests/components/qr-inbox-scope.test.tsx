import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ inbox: vi.fn(), decide: vi.fn(), navigate: vi.fn(), can: () => true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => mocks.can }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/features/qr/service', () => ({ qrInbox: mocks.inbox, qrDecide: mocks.decide, qrError: () => 'Unavailable' }));
vi.mock('@/api/domains/qr', () => ({ qr: {handleCall: vi.fn(async()=>({error:null})), calls: vi.fn(async()=>({data:[]})), routing: vi.fn(async () => ({data:{tables:[{id:'t1',name:'Table A',busy:false},{id:'t2',name:'Table B',busy:false}],can_review:true}}))} }));
import { QrInbox } from '@/features/qr/QrInbox';
import { qr } from '@/api/domains/qr';

describe('QR inbox branch scope', () => {
  beforeEach(() => { cleanup(); mocks.inbox.mockReset(); mocks.decide.mockReset(); mocks.navigate.mockReset(); });
  it('does not navigate back to an old branch when an acceptance finishes after switching', async () => {
    mocks.inbox.mockResolvedValue([{ id: 'request', table_id: 't1', table_name: 'Table A', items: [], created_at: '2026-11-14T00:00:00Z' }]);
    let done: (value: unknown) => void = () => undefined;
    mocks.decide.mockImplementation(() => new Promise(resolve => { done = resolve; }));
    const view = render(<QrInbox key="a" branchId="a" />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1'));
    fireEvent.click(screen.getByRole('button', { name: /طلبات QR/ }));
    fireEvent.click(screen.getByRole('button', { name: 'قبول وفتح الفاتورة' }));
    expect(mocks.decide).toHaveBeenCalledWith('request', true, 't1');
    mocks.inbox.mockResolvedValue([]);
    view.rerender(<QrInbox key="b" branchId="b" />);
    done({ order_id: 'old-order', status: 'accepted' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('0'));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it('allows a follow-up on the private visit bill even when its table is occupied', async () => {
    vi.mocked(qr.routing).mockResolvedValueOnce({data:{tables:[{id:'t1',name:'Table A',busy:true},{id:'t2',name:'Table B',busy:true}],can_review:true},error:null});
    mocks.inbox.mockResolvedValue([{id:'follow-up',table_id:'t1',own_active_table_id:'t2',table_name:'Table A',items:[],created_at:'2026-11-14T00:00:00Z'}]);
    mocks.decide.mockResolvedValue({order_id:null,status:'accepted'});
    render(<QrInbox branchId="a"/>);await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('1'));
    fireEvent.click(screen.getByRole('button',{name:/طلبات QR/}));expect(screen.getByLabelText('الطاولة المعتمدة Table A')).toHaveValue('t2');
    fireEvent.click(screen.getByRole('button',{name:'قبول وفتح الفاتورة'}));expect(mocks.decide).toHaveBeenCalledWith('follow-up',true,'t2');
  });
  it('acknowledges and completes service without leaving an unsaved POS cart', async () => {
    mocks.inbox.mockResolvedValue([]);
    vi.mocked(qr.calls).mockResolvedValueOnce({data:[{id:'call',kind:'service',note:'مناديل',status:'open',table_name:'Table A',created_at:'2026-11-14T00:00:00Z'}],error:null});
    render(<QrInbox branchId="a" readOnly/>);await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('1 شيك وخدمة'));
    fireEvent.click(screen.getByRole('button',{name:/طلبات QR/}));fireEvent.click(screen.getByRole('button',{name:'استلام طلب الخدمة'}));
    await screen.findByText('تم إبلاغ العميل باستلام الطلب');expect(qr.handleCall).toHaveBeenCalledWith({p_id:'call',p_status:'acknowledged'});
    fireEvent.click(screen.getByRole('button',{name:'تم تنفيذ الطلب'}));await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('0 شيك وخدمة'));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
