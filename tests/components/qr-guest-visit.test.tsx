import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GuestTracking } from '@/features/qr/service';
const mocks=vi.hoisted(()=>({call:vi.fn()}));
vi.mock('@/api/domains/qrPublic',()=>({qrPublic:{callService:mocks.call}}));
import { GuestVisitPanel } from '@/features/qr/GuestVisitPanel';
const empty:GuestTracking={requests:[],bills:[],calls:[]};
const props={token:'a'.repeat(64),session:'b'.repeat(64),table:'table-a',currency:'ج.م',tracking:empty,error:'',refresh:vi.fn(async()=>{}),newVisit:vi.fn()};
describe('guest bill and service experience',()=>{
 beforeEach(()=>{cleanup();sessionStorage.clear();mocks.call.mockReset();props.refresh.mockClear();});
 it('shows authoritative bill figures, actual kitchen state and staff confirmation',()=>{
  render(<GuestVisitPanel {...props} tracking={{requests:[{id:'r',status:'accepted',items:[],created_at:'2026-11-14T00:00:00Z',requested_table:'A',assigned_table:'B'}],bills:[{id:'o',order_number:'POS-1',status:'open',kitchen_status:'cooking',payment_status:'partial',table_id:'B',table_name:'B',subtotal:100,discount_type:'amount',discount_amount:10,tax_amount:12.6,total:102.6,paid_amount:40,refunded_amount:0,balance:62.6,items:[{name:'Tea',quantity:2,unit_price:50,total:100}]}],calls:[{id:'c',kind:'check',note:'',status:'acknowledged',table_name:'B',created_at:'2026-11-14T00:00:00Z'}]}}/>);
  expect(screen.getByText(/قيد التحضير/)).toBeInTheDocument();expect(screen.getByText('المتبقي').nextElementSibling).toHaveTextContent('62.60 ج.م');
  expect(screen.getByText('المدفوع').nextElementSibling).toHaveTextContent('40.00 ج.م');expect(screen.getByText('الموظف استلم طلبك')).toBeInTheDocument();expect(screen.getByRole('button',{name:'طلب الشيك'})).toBeDisabled();
 });
 it('keeps ambiguous service retries bound to the same key, secret, table and note across reload',async()=>{
  mocks.call.mockResolvedValue({error:{message:'Network disconnected'}});
  const view=render(<GuestVisitPanel {...props}/>);expect(screen.getByRole('button',{name:'طلب الشيك'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('ملاحظتك للموظف'),{target:{value:'مناديل'}});fireEvent.click(screen.getByRole('button',{name:'طلب خدمة'}));await screen.findByRole('alert');const original=mocks.call.mock.calls[0][0];
  view.unmount();render(<GuestVisitPanel {...props}/>);fireEvent.click(screen.getByRole('button',{name:'طلب خدمة'}));await screen.findByRole('alert');expect(mocks.call.mock.calls[1][0]).toEqual(original);expect(original).toMatchObject({p_session:props.session,p_table:'table-a',p_note:'مناديل'});
 });
 it('sends the check to the approved table and refreshes the visible confirmation',async()=>{
  mocks.call.mockResolvedValue({data:{id:'c',status:'open'}});
  render(<GuestVisitPanel {...props} tracking={{...empty,bills:[{id:'o',order_number:'1',status:'open',kitchen_status:'ready',payment_status:'unpaid',table_id:'approved',table_name:'B',subtotal:25,discount_amount:0,discount_type:'amount',tax_amount:0,total:25,paid_amount:0,refunded_amount:0,balance:25,items:[]}]}}/>);
  fireEvent.click(screen.getByRole('button',{name:'طلب الشيك'}));await screen.findByText('وصل طلب الشيك إلى الموظف.');expect(mocks.call.mock.calls[0][0]).toMatchObject({p_table:'approved',p_kind:'check'});expect(props.refresh).toHaveBeenCalled();
 });
});
