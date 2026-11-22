import { useEffect, useRef, useState } from 'react';
import { BellRing, ReceiptText, RefreshCw } from 'lucide-react';
import { qrPublic } from '@/api/domains/qrPublic';
import type { GuestBill, GuestOrderType, GuestTracking } from './service';
import { qrError, qrErrorEnglish } from './errors';
import { rememberGuestOrders, useGuestOrderHistory } from './guestOrderHistory';
import { GuestRatingPanel } from './GuestRatingPanel';

const requestLabels: Record<string,string> = { pending: 'بانتظار اعتماد الموظف', accepted: 'تم اعتماد الطلب', rejected: 'لم يُعتمد الطلب' };
const kitchenLabels: Record<string,string> = { pending: 'بانتظار الإرسال للمطبخ', sent: 'أُرسل للمطبخ', cooking: 'قيد التحضير', ready: 'جاهز للتقديم', served: 'تم التقديم', cancelled: 'أُلغي التحضير' };
const requestLabelsEn: Record<string,string> = { pending:'Awaiting approval', accepted:'Order approved', rejected:'Order declined' };
const kitchenLabelsEn: Record<string,string> = { pending:'Awaiting kitchen', sent:'Sent to kitchen', cooking:'Preparing', ready:'Ready', served:'Served', cancelled:'Cancelled' };
const callLabelsEn: Record<string,string> = { open:'Sent to staff', acknowledged:'Staff received your request', done:'Completed' };
const callLabels: Record<string,string> = { open: 'أُرسل للموظف', acknowledged: 'الموظف استلم طلبك', done: 'تم التنفيذ' };
function fulfillmentLabel(bill: GuestBill, type: GuestOrderType, english: boolean) {
  const label = (ar: string, en: string) => english ? en : ar;
  if (bill.status === 'cancelled') return label('أُلغي الطلب', 'Order cancelled');
  if (type === 'delivery') {
    if (bill.dispatch_status === 'delivered') return label('تم التوصيل', 'Delivered');
    if (bill.dispatch_status === 'on_the_way') return label('في الطريق إليك', 'On the way');
    if (bill.dispatch_status === 'failed') return label('تعذر التوصيل', 'Delivery could not be completed');
  }
  if (bill.kitchen_status === 'served' && type === 'dine_in') return label('تم التقديم', 'Served');
  if (bill.kitchen_status === 'served' && type === 'pickup') return label('تم الاستلام', 'Picked up');
  if (!bill.has_unsent && ['ready', 'served'].includes(bill.kitchen_status)) {
    if (type === 'pickup') return label('جاهز للاستلام', 'Ready for pickup');
    if (type === 'delivery') return label('جاهز للتوصيل', 'Ready for delivery');
    return label('جاهز للتقديم', 'Ready to serve');
  }
  if (bill.has_unsent) return label('بانتظار بدء التحضير', 'Waiting for preparation');
  return (english ? kitchenLabelsEn : kitchenLabels)[bill.kitchen_status] || label('تم تأكيد الطلب', 'Order confirmed');
}

const fulfillmentNames = {
  dine_in: ['داخل المطعم', 'Dine in'],
  pickup: ['استلام من المطعم', 'Pickup'],
  delivery: ['توصيل', 'Delivery'],
} as const;

function isPastBill(bill: GuestBill, type: GuestOrderType) {
  if (bill.status === 'cancelled') return true;
  if (type === 'delivery') return bill.dispatch_status === 'delivered';
  return bill.status === 'completed' || bill.kitchen_status === 'served';
}

export function GuestPreviousOrders({ token, english, visibleIds = [] }: { token: string; english: boolean; visibleIds?: string[] }) {
  const history = useGuestOrderHistory(token).filter(order => !visibleIds.includes(order.id));
  if (!history.length && visibleIds.length) return null;
  return <section className="customer-order-history" aria-label={english ? 'Previous orders' : 'الطلبات السابقة'}>
    <h3>{english ? 'Previous orders' : 'الطلبات السابقة'}</h3>
    {history.length ? <ul>{history.map(order => <li key={order.id}>
      <div><strong>{fulfillmentNames[order.type]?.[english ? 1 : 0]}</strong><bdi>{order.number}</bdi></div>
      <div><span>{order.status}</span><time>{new Date(order.recordedAt).toLocaleDateString(english ? 'en-GB' : 'ar-EG')}</time></div>
    </li>)}</ul> : <p>{english ? 'Completed orders on this device will appear here.' : 'ستظهر هنا الطلبات المكتملة من هذا الجهاز.'}</p>}
  </section>;
}

interface CallDraft { key: string; table: string | null; kind: string; note: string }
export function GuestVisitPanel({ token, session, table, currency, tracking, error, refresh, newVisit, secure = false }: {
 secure?:boolean;token:string;session:string;table:string;currency:string;tracking:GuestTracking;error:string;refresh:()=>Promise<void>;newVisit:()=>void;
}) {
 const isBunker=token==='3236a6be44494d89ba2b2a4e7c55fb140564f5a6ae5f4db7bcd7ace6eadeaf62';
 const customerError=isBunker?qrErrorEnglish:qrError;
 const [note,setNote]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [failure,setFailure]=useState('');
 const lock=useRef(false);const pending=useRef<CallDraft|null>(null);
 const type = tracking.visit?.order_type ?? 'dine_in';
 const [showPrevious, setShowPrevious] = useState(false);
 const bills = tracking.bills.filter(bill => showPrevious === isPastBill(bill, type));
 const requests = tracking.requests.filter(request => showPrevious ? request.status === 'rejected' : request.status === 'pending' || (!tracking.bills.length && request.status === 'accepted'));
 useEffect(() => {
   if (!secure) return;
   rememberGuestOrders(token, tracking.bills.filter(bill => isPastBill(bill, type)).map(bill => ({
     id: bill.id, number: bill.order_number, type, status: fulfillmentLabel(bill, type, isBunker), recordedAt: Date.now(),
   })));
 }, [secure, token, tracking.bills, type, isBunker]);
 const atTable = type === 'dine_in';
 const active=[...tracking.bills].reverse().find(b=>['open','held'].includes(b.status));
 const money=(n:number)=>`${Number(n||0).toFixed(2)} ${currency}`;
 async function requestService(kind:'service'|'check') {
  if(lock.current)return;lock.current=true;setBusy(true);setFailure('');setMessage('');
  const storageKey=`premier_qr_call_v1_${token}_${session}`;
  if(!pending.current){try{pending.current=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{/* No storage. */}}
  const draft=pending.current||{key:crypto.randomUUID(),table:tracking.visit?.order_type==='delivery'?null:active?.table_id||table||null,kind,note};pending.current=draft;
  try{
   try{sessionStorage.setItem(storageKey,JSON.stringify(draft));}catch{/* In-memory retry. */}
   const {error:err}=await (secure ? qrPublic.guestCall : qrPublic.callService)({p_token:token,p_session:session,p_key:draft.key,p_table:draft.table,p_kind:draft.kind,p_note:draft.note});
   if(err)throw err;
   pending.current=null;try{sessionStorage.removeItem(storageKey);}catch{/* No storage. */}
   setMessage(draft.kind==='check'?(isBunker?'Your check request was sent to our team.':'وصل طلب الشيك إلى الموظف.'):(isBunker?'Your service request was sent to our team.':'وصل طلب الخدمة إلى الموظف.'));setNote('');await refresh();
  }catch(err){setFailure(customerError(err));const msg=err&&typeof err==='object'&&'message'in err?String(err.message):'';if(/QR_(NO_ACTIVE_BILL|TABLE_INVALID|DISABLED|RATE_LIMITED|INVALID_ITEMS|SESSION_EXPIRED|LINK_INVALID)/.test(msg)){pending.current=null;try{sessionStorage.removeItem(storageKey);}catch{/* No storage. */}}}
  finally{lock.current=false;setBusy(false);}
 }
 const outstanding=tracking.requests.some(r=>r.status==='pending')||tracking.bills.some(b=>['open','held'].includes(b.status))||tracking.calls.some(c=>c.status!=='done');
 return <section className="customer-visit" aria-label={isBunker?'My order and bill':'طلبي وحسابي'}>
  <div className="customer-section-title"><h2>{isBunker?'My order & bill':'طلبي وحسابي'}</h2><button aria-label={isBunker?'Refresh order status':'تحديث حالة الطلب والحساب'} onClick={()=>void refresh()}><RefreshCw size={18}/></button></div>
  <p className="customer-table-hint">{isBunker?'Status updates automatically. Only orders from this visit appear here. To continue on another device, use your phone number and recovery code.':'تتحدث الحالة تلقائيًا. هذه الصفحة تعرض طلبات زيارتك فقط. للاسترجاع من جهاز آخر استخدم رقم هاتفك ورمز الاسترجاع.'}</p>
  {(error||failure)&&<p role="alert" className="customer-alert">{failure||error}</p>}{failure&&pending.current&&<button className="customer-primary" disabled={busy} onClick={()=>void requestService(pending.current!.kind as 'service'|'check')}>{isBunker?'Retry service request':'إعادة إرسال طلب الخدمة السابق بأمان'}</button>}{message&&<p role="status" className="customer-receipt">{message}</p>}
  <div className="customer-order-filters" role="group" aria-label={isBunker ? 'Orders' : 'الطلبات'}>
    <button type="button" aria-pressed={!showPrevious} onClick={() => setShowPrevious(false)}>{isBunker ? 'Current orders' : 'الطلبات الحالية'}</button>
    <button type="button" aria-pressed={showPrevious} onClick={() => setShowPrevious(true)}>{isBunker ? 'Previous orders' : 'الطلبات السابقة'}</button>
  </div>
  {!showPrevious && !requests.length && !bills.length && <p className="customer-empty">{isBunker ? 'No current orders.' : 'لا توجد طلبات حالية.'}</p>}
  {showPrevious && <GuestPreviousOrders token={token} english={isBunker} visibleIds={bills.map(bill => bill.id)} />}
  {requests.map(r=><article className={`customer-request-state is-${r.status}`} key={r.id}><div><strong><span>{fulfillmentNames[type][isBunker ? 1 : 0]}</span> · <span>{(isBunker?requestLabelsEn:requestLabels)[r.status]||r.status}</span></strong><time>{new Date(r.created_at).toLocaleTimeString(isBunker?'en-US':'ar-EG',{hour:'2-digit',minute:'2-digit'})}</time></div>{atTable && <p>{r.assigned_table?(isBunker?`Assigned table: ${r.assigned_table}`:`الطاولة المعتمدة: ${r.assigned_table}`):(isBunker?`Requested table: ${r.requested_table}`:`الطاولة المطلوبة: ${r.requested_table}`)}</p>}<ul>{r.items.map(i=><li key={i.product_id}>{i.quantity} × {i.name}</li>)}</ul></article>)}
  {bills.map(b=><article className="customer-bill" key={b.id}><h3>{atTable ? `${isBunker ? 'Bill for' : 'حساب'} ${b.table_name || ''}` : (isBunker ? 'Order summary' : 'ملخص الطلب')}</h3><p className="customer-fulfillment-status" role="status"><span>{fulfillmentNames[type][isBunker ? 1 : 0]} · {fulfillmentLabel(b, type, isBunker)}</span><bdi>{b.order_number}</bdi></p>
   {type === 'delivery' && b.bill_confirmed === false
     ? <p className="customer-table-hint">{isBunker ? 'The restaurant will confirm your total after adding the delivery fee and sending the order to the kitchen.' : 'يظهر الحساب بعد إضافة رسوم التوصيل وإرسال الطلب للمطبخ.'}</p>
     : <>   <div className="customer-bill-lines">{b.items.map((i,index)=><div key={`${i.name}-${index}`}><span>{i.quantity} × {i.name}</span><strong>{money(i.total)}</strong></div>)}</div>
   <dl><div><dt>{isBunker?'Subtotal':'قيمة الأصناف'}</dt><dd>{money(b.subtotal)}</dd></div><div><dt>{isBunker?'Discount':'الخصم'}{b.discount_type==='percent'?` (${b.discount_amount}%)`:''}</dt><dd>{b.discount_type==='percent'?money(b.subtotal*b.discount_amount/100):money(b.discount_amount)}</dd></div><div><dt>{isBunker?'Tax':'الضريبة'}</dt><dd>{money(b.tax_amount)}</dd></div>{type === 'delivery' && b.delivery_fee_amount != null && <div><dt>{isBunker ? 'Delivery fee' : 'رسوم التوصيل'}</dt><dd>{money(b.delivery_fee_amount)}</dd></div>}<div><dt>{isBunker?'Total':'الإجمالي'}</dt><dd>{money(b.total)}</dd></div><div><dt>{isBunker?'Paid':'المدفوع'}</dt><dd>{money(b.paid_amount)}</dd></div>{b.refunded_amount>0&&<div><dt>{isBunker?'Refunded':'المرتجع'}</dt><dd>{money(b.refunded_amount)}</dd></div>}<div className="customer-balance"><dt>{isBunker?'Balance':'المتبقي'}</dt><dd>{money(b.balance)}</dd></div></dl><p className="customer-table-hint">{isBunker?'Payments are handled and confirmed by our team.':'الحساب من فاتورة الفرع الحالية. الدفع وتأكيده لدى الموظف.'}</p></>}

  </article>)}
  {!showPrevious && atTable && !tracking.visit?.closed && <div className="customer-service"><h3>{isBunker?'Service & check requests':'طلب خدمة أو شيك'}</h3><label>{isBunker?'Notes for our team':'ملاحظتك للموظف'}<textarea maxLength={300} value={note} disabled={busy} onChange={e=>setNote(e.target.value)} placeholder={isBunker?'E.g. Could we have extra napkins?':'مثال: نحتاج مناديل'}/></label><div>
   <button disabled={busy||!!pending.current||(secure ? !active : (!active&&!table))||tracking.calls.some(c=>c.kind==='service'&&c.status!=='done')} onClick={()=>void requestService('service')}><BellRing size={20}/>{isBunker?'Call staff':'طلب خدمة'}</button>
   <button disabled={busy||!!pending.current||!active||tracking.calls.some(c=>c.kind==='check'&&c.status!=='done')} onClick={()=>void requestService('check')}><ReceiptText size={20}/>{isBunker?'Request check':'طلب الشيك'}</button>
  </div>{!active&&<p className="customer-table-hint">{isBunker?'You can request the check once your order is approved.':'طلب الشيك يتاح بعد اعتماد طلبك وفتح حسابك.'}</p>}{tracking.calls.map(c=><p className="customer-call-state" key={c.id}><strong>{c.kind==='check'?(isBunker?'Check request':'طلب الشيك'):(isBunker?'Service request':'طلب خدمة')} · {c.table_name}</strong><span>{(isBunker?callLabelsEn:callLabels)[c.status]}</span>{c.note&&<small>{c.note}</small>}</p>)}</div>}
  {!showPrevious && secure && tracking.requests.some(request => request.status === 'accepted') &&
    <GuestRatingPanel token={token} session={session} />}
  {!secure&&!outstanding&&(tracking.requests.length>0||error.includes('انتهت'))&&<button className="customer-refresh" disabled={busy} onClick={newVisit}>{isBunker?'Start a new visit':'بدء زيارة جديدة على هذا الجهاز'}</button>}
 </section>;
}
