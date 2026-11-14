import { useRef, useState } from 'react';
import { BellRing, ReceiptText, RefreshCw } from 'lucide-react';
import { qrPublic } from '@/api/domains/qrPublic';
import type { GuestTracking } from './service';
import { qrError } from './errors';

const requestLabels: Record<string,string> = { pending: 'بانتظار اعتماد الموظف', accepted: 'تم اعتماد الطلب', rejected: 'لم يُعتمد الطلب' };
const kitchenLabels: Record<string,string> = { pending: 'بانتظار الإرسال للمطبخ', sent: 'أُرسل للمطبخ', cooking: 'قيد التحضير', ready: 'جاهز للتقديم', served: 'تم التقديم', cancelled: 'أُلغي التحضير' };
const callLabels: Record<string,string> = { open: 'أُرسل للموظف', acknowledged: 'الموظف استلم طلبك', done: 'تم التنفيذ' };
interface CallDraft { key: string; table: string | null; kind: string; note: string }
export function GuestVisitPanel({ token, session, table, currency, tracking, error, refresh, newVisit }: {
 token:string;session:string;table:string;currency:string;tracking:GuestTracking;error:string;refresh:()=>Promise<void>;newVisit:()=>void;
}) {
 const [note,setNote]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [failure,setFailure]=useState('');
 const lock=useRef(false);const pending=useRef<CallDraft|null>(null);
 const active=tracking.bills.find(b=>['open','held'].includes(b.status));
 const money=(n:number)=>`${Number(n||0).toFixed(2)} ${currency}`;
 async function requestService(kind:'service'|'check') {
  if(lock.current)return;lock.current=true;setBusy(true);setFailure('');setMessage('');
  const storageKey=`premier_qr_call_v1_${token}_${session}`;
  if(!pending.current){try{pending.current=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{/* No storage. */}}
  const draft=pending.current||{key:crypto.randomUUID(),table:active?.table_id||table||null,kind,note};pending.current=draft;
  try{
   try{sessionStorage.setItem(storageKey,JSON.stringify(draft));}catch{/* In-memory retry. */}
   const {error:err}=await qrPublic.callService({p_token:token,p_session:session,p_key:draft.key,p_table:draft.table,p_kind:draft.kind,p_note:draft.note});
   if(err)throw err;
   pending.current=null;try{sessionStorage.removeItem(storageKey);}catch{/* No storage. */}
   setMessage(draft.kind==='check'?'وصل طلب الشيك إلى الموظف.':'وصل طلب الخدمة إلى الموظف.');setNote('');await refresh();
  }catch(err){setFailure(qrError(err));const msg=err&&typeof err==='object'&&'message'in err?String(err.message):'';if(/QR_(NO_ACTIVE_BILL|TABLE_INVALID|DISABLED|RATE_LIMITED|INVALID_ITEMS|SESSION_EXPIRED|LINK_INVALID)/.test(msg)){pending.current=null;try{sessionStorage.removeItem(storageKey);}catch{/* No storage. */}}}
  finally{lock.current=false;setBusy(false);}
 }
 const outstanding=tracking.requests.some(r=>r.status==='pending')||tracking.bills.some(b=>['open','held'].includes(b.status))||tracking.calls.some(c=>c.status!=='done');
 return <section className="customer-visit" aria-label="طلبي وحسابي">
  <div className="customer-section-title"><h2>طلبي وحسابي</h2><button aria-label="تحديث حالة الطلب والحساب" onClick={()=>void refresh()}><RefreshCw size={18}/></button></div>
  <p className="customer-table-hint">تتحدث الحالة تلقائيًا. هذه الصفحة تعرض طلبات زيارتك على هذا الجهاز فقط.</p>
  {(error||failure)&&<p role="alert" className="customer-alert">{failure||error}</p>}{failure&&pending.current&&<button className="customer-primary" disabled={busy} onClick={()=>void requestService(pending.current!.kind as 'service'|'check')}>إعادة إرسال طلب الخدمة السابق بأمان</button>}{message&&<p role="status" className="customer-receipt">{message}</p>}
  {!tracking.requests.length&&<p className="customer-empty">بعد إرسال طلبك ستظهر هنا حالته وحسابه. يمكنك طلب خدمة بعد اختيار الطاولة.</p>}
  {tracking.requests.map(r=><article className={`customer-request-state is-${r.status}`} key={r.id}><div><strong>{requestLabels[r.status]||r.status}</strong><time>{new Date(r.created_at).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})}</time></div><p>{r.assigned_table?`الطاولة المعتمدة: ${r.assigned_table}`:`الطاولة المطلوبة: ${r.requested_table}`}</p><ul>{r.items.map(i=><li key={i.product_id}>{i.quantity} × {i.name}</li>)}</ul></article>)}
  {tracking.bills.map(b=><article className="customer-bill" key={b.id}><h3>حساب {b.table_name}</h3><p className="customer-table-hint">{b.order_number} · {b.status==='completed'?'تم إغلاق الطلب':b.status==='cancelled'?'طلب ملغي':b.has_unsent?'أصناف جديدة بانتظار الإرسال للمطبخ':kitchenLabels[b.kitchen_status]||'الطلب مفتوح'}</p>
   <div className="customer-bill-lines">{b.items.map((i,index)=><div key={`${i.name}-${index}`}><span>{i.quantity} × {i.name}</span><strong>{money(i.total)}</strong></div>)}</div>
   <dl><div><dt>قيمة الأصناف</dt><dd>{money(b.subtotal)}</dd></div><div><dt>الخصم{b.discount_type==='percent'?` (${b.discount_amount}%)`:''}</dt><dd>{b.discount_type==='percent'?money(b.subtotal*b.discount_amount/100):money(b.discount_amount)}</dd></div><div><dt>الضريبة</dt><dd>{money(b.tax_amount)}</dd></div><div><dt>الإجمالي</dt><dd>{money(b.total)}</dd></div><div><dt>المدفوع</dt><dd>{money(b.paid_amount)}</dd></div>{b.refunded_amount>0&&<div><dt>المرتجع</dt><dd>{money(b.refunded_amount)}</dd></div>}<div className="customer-balance"><dt>المتبقي</dt><dd>{money(b.balance)}</dd></div></dl><p className="customer-table-hint">الحساب من فاتورة الفرع الحالية. الدفع وتأكيده لدى الموظف.</p>
  </article>)}
  <div className="customer-service"><h3>خدمة الطاولة</h3><label>ملاحظتك للموظف<textarea maxLength={300} value={note} disabled={busy} onChange={e=>setNote(e.target.value)} placeholder="مثال: نحتاج مناديل"/></label><div>
   <button disabled={busy||!!pending.current||(!active&&!table)||tracking.calls.some(c=>c.kind==='service'&&c.status!=='done')} onClick={()=>void requestService('service')}><BellRing size={20}/>طلب خدمة</button>
   <button disabled={busy||!!pending.current||!active||tracking.calls.some(c=>c.kind==='check'&&c.status!=='done')} onClick={()=>void requestService('check')}><ReceiptText size={20}/>طلب الشيك</button>
  </div>{!active&&<p className="customer-table-hint">طلب الشيك يتاح بعد اعتماد طلبك وفتح حسابك.</p>}{tracking.calls.map(c=><p className="customer-call-state" key={c.id}><strong>{c.kind==='check'?'طلب الشيك':'طلب خدمة'} · {c.table_name}</strong><span>{callLabels[c.status]}</span>{c.note&&<small>{c.note}</small>}</p>)}</div>
  {!outstanding&&(tracking.requests.length>0||error.includes('انتهت'))&&<button className="customer-refresh" disabled={busy} onClick={newVisit}>بدء زيارة جديدة على هذا الجهاز</button>}
 </section>;
}
