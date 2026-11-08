'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const login = $('login-form'), workspace = $('workspace');
  const orders = $('orders'), status = $('connection');
  let secret = '', role = '', station = '', lastEvent = 0, signal = null;
  let uncertainSubmission = null;
  const uncertainStatusCommands = new Map();
  const labels={new:'جديد',cooking:'قيد التحضير',ready:'جاهز',served:'تم التقديم'};
  function report(message) { status.textContent = message; }
  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Authorization':'Bearer '+secret,
        ...(options.body ? {'Content-Type':'application/json'} : {}),
      },
      cache:'no-store',
    });
    const data=await response.json();
    if (!response.ok) throw Error(data.error || 'LOCAL_REQUEST_FAILED');
    return data;
  }
  function make(tag, value, cls) {
    const element=document.createElement(tag);
    if (value!=null) element.textContent=value;
    if(cls) element.className=cls;
    return element;
  }
  async function refresh() {
    if(!secret)return;
    const [payload,syncStatus]=await Promise.all([
      api('/api/v1/lan/orders'),
      api('/api/v1/lan/sync-status'),
    ]);
    $('cloud-status').textContent = 'أحداث مطبخ محفوظة محليًا: '+
      syncStatus.pendingCloudDraftEvents+
      ' | المزامنة السحابية غير مفعّلة. ليست مبيعات أو مدفوعات معتمدة.';
    role=payload.role;
    station=payload.stationCode||'';
    $('scope').textContent=role==='waiter'?'الويتر — الطلبات المسجلة محليًا':
      'المطبخ — محطة '+station;
    $('order-form').hidden=role!=='waiter';
    if(role==='waiter') {
      const stations=(await api('/api/v1/lan/stations')).stations;
      const names=$('stations');
      names.replaceChildren();
      for(const code of stations){
        const option=document.createElement('option');
        option.value=code;
        names.appendChild(option);
      }
      if(!stations.includes($('station').value)) $('station').value=stations[0]||'';
      $('order-form').hidden=stations.length===0;
      if(stations.length===0)
        report('لا توجد محطة مطبخ مقترنة حاليًا. اطلب من مسؤول الفرع ربط جهاز المطبخ.');
    }
    orders.replaceChildren();
    if (!payload.orders.length) orders.appendChild(make('p','لا توجد طلبات محلية حاليًا'));
    for (const item of payload.orders) {
      const ticket=make('article',null,'ticket');
      ticket.appendChild(make('h3','الطاولة: '+item.tableCode));
      ticket.appendChild(make('p','الحالة: '+(labels[item.status]||item.status)));
      ticket.appendChild(make('p',item.items.map(i=>i.name+' × '+i.quantity).join('، ')));
      ticket.appendChild(make('p','محطة: '+item.stationCode+' | محلي فقط — غير مُزامن'));
      let next=null, text='';
      if(role==='kitchen'&&item.status==='new'){next='cooking';text='بدء التحضير';}
      if(role==='kitchen'&&item.status==='cooking'){next='ready';text='جاهز للتقديم';}
      if(role==='waiter'&&item.status==='ready'){next='served';text='تم التقديم';}
      if (next) {
        const btn=make('button',text,'secondary');
        btn.addEventListener('click',async()=>{
          btn.disabled=true;
          const operationId=item.id+':'+item.version+':'+next;
          // A network timeout does not prove failure. Reuse the exact key
          // for the same command, even if another tablet subsequently changed
          // the order status.
          if(!uncertainStatusCommands.has(operationId))
            uncertainStatusCommands.set(operationId,'status-'+crypto.randomUUID());
          try {
            await api('/api/v1/lan/orders/'+encodeURIComponent(item.id)+'/status',{
              method:'POST',
              body:JSON.stringify({status:next,expectedVersion:item.version,
                commandKey:uncertainStatusCommands.get(operationId)}),
            });
            uncertainStatusCommands.delete(operationId);
            await refresh();
          } catch(error) {
            report('حالة الطلب غير مؤكدة: '+error.message+
              ' — أعد المحاولة بنفس الطلب أو اضغط تحديث.');
            btn.disabled=false;
          }
        });
        ticket.appendChild(btn);
      }
      orders.appendChild(ticket);
    }
    if(role==='waiter'&&$('order-form').hidden)
      report('متصل بالخادم، لكن لا توجد محطة مطبخ مقترنة. اطلب من المسؤول ربط جهاز المطبخ.');
    else report('الشبكة المحلية متصلة. التغييرات محفوظة محليًا وليست فواتير مالية.');
  }
  async function events() {
    while(secret&&signal&&!signal.signal.aborted) {
      try {
        const response=await fetch('/api/v1/lan/events?after='+lastEvent,{
          headers:{Authorization:'Bearer '+secret},
          signal:signal.signal,
          cache:'no-store',
        });
        if(!response.ok||!response.body) throw Error('EVENT_STREAM_UNAVAILABLE');
        const reader=response.body.getReader();
        const decoder=new TextDecoder();
        let pending='';
        while(secret&&!signal.signal.aborted) {
          const next=await reader.read();
          if(next.done)break;
          pending+=decoder.decode(next.value,{stream:true});
          let sep;
          while((sep=pending.indexOf('\n\n'))>=0) {
            const frame=pending.slice(0,sep);pending=pending.slice(sep+2);
            const seq=/^id: (\d+)$/m.exec(frame);
            if(seq) lastEvent=Math.max(lastEvent,Number(seq[1]));
            if(frame.includes('event: reset-cursor')) {
              lastEvent=0;
              await refresh();
              continue;
            }
            if(frame.includes('event: revoked')) {
              report('تم إلغاء صلاحية الجهاز. أعد الإقران مع مسؤول الفرع.');
              disconnect();return;
            }
            if(seq) await refresh();
          }
          if(pending.length>65536) throw Error('EVENT_FRAME_TOO_LARGE');
        }
      } catch(error) {
        if(signal?.signal.aborted)return;
        report('انقطع الاتصال بالخادم المحلي. إعادة الاتصال...');
      }
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
  }
  function disconnect() {
    secret='';
    signal?.abort();
    signal=null;
    lastEvent=0;role='';station='';uncertainSubmission=null;
    uncertainStatusCommands.clear();
    $('credential').value='';
    orders.replaceChildren();workspace.hidden=true;login.hidden=false;
  }
  login.addEventListener('submit',async (e)=>{
    e.preventDefault();
    secret=$('credential').value.trim();
    try {
      await refresh();
      login.hidden=true;workspace.hidden=false;
      signal=new AbortController();void events();
    } catch(error) {report(error.message);alert('تعذر ربط الجهاز: '+error.message);disconnect();}
  });
  $('disconnect').addEventListener('click',disconnect);
  $('refresh').addEventListener('click',()=>refresh().catch(e=>report(e.message)));
  $('order-form').addEventListener('submit',async(e)=>{
    e.preventDefault();
    const button=$('order-form').querySelector('button');
    button.disabled=true;
    try {
      const draft={
        stationCode:$('station').value.trim(),
        tableCode:$('table').value.trim(),
        items:[{name:$('product').value.trim(),quantity:Number($('quantity').value)}],
      };
      const fingerprint=JSON.stringify(draft);
      if (uncertainSubmission && uncertainSubmission.fingerprint!==fingerprint)
        throw Error('هناك عملية حفظ غير مؤكدة. أعد إرسال نفس الطلب قبل تغييره، حتى لا يتكرر.');
      if (!uncertainSubmission)
        uncertainSubmission={fingerprint,key:'order-'+crypto.randomUUID()};
      // A network timeout is NOT proof of failure; retry with the same
      // operation key instead of silently creating a second kitchen ticket.
      const profile=await api('/api/v1/lan/profile');
      const body={
        organizationId:profile.organizationId,branchId:profile.branchId,
        ...draft,idempotencyKey:uncertainSubmission.key,
      };
      await api('/api/v1/lan/orders',{method:'POST',body:JSON.stringify(body)});
      uncertainSubmission=null;
      $('product').value='';
      await refresh();
    } catch(error){report('الحفظ غير مؤكد: '+error.message+' — حاول بنفس بيانات الطلب.');}
    finally{button.disabled=false;}
  });
})();
