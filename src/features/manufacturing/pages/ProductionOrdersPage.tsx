import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranches } from '@/hooks/useBranches';
import { useCan } from '@/lib/permissions';
import { DesignSurface, DesignPageHeader } from '@/components/design';

type Order = { id: string; order_number: string | null; product_id: string; branch_id: string; warehouse_id: string; quantity: number; status: string; planned_at: string | null; total_cost: number | null };
type Item = { id: string; name: string; branch_id: string };
export function ProductionOrdersPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const can = useCan();
  const fixedBranch = useBranchFilter();
  const { branches } = useBranches();
  const [branch, setBranch] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [product, setProduct] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [products, setProducts] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Item[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const effectiveBranch = fixedBranch || branch;
  const load = useCallback(async () => {
    if (!effectiveBranch) { setOrders([]); setProducts([]); setWarehouses([]); return; }
    const [p,w,o] = await Promise.all([
      supabase.from('products').select('id,name,branch_id').eq('branch_id',effectiveBranch).eq('is_active',true).order('name'),
      supabase.from('warehouses').select('id,name,branch_id').eq('branch_id',effectiveBranch).eq('is_active',true),
      supabase.from('production_orders').select('id,order_number,product_id,branch_id,warehouse_id,quantity,status,planned_at,total_cost').eq('branch_id',effectiveBranch).order('created_at',{ascending:false}).limit(300)
    ]);
    const failure = p.error || w.error || o.error;
    if (failure) { setError(failure.message); return; }
    setProducts((p.data || []) as Item[]);
    setWarehouses((w.data || []) as Item[]);
    setOrders((o.data || []) as Order[]);
    setError('');
  },[effectiveBranch]);
  useEffect(()=>{void load();},[load]);
  const perform = async (op: 'create'|'start'|'complete'|'cancel', id?: string) => {
    setBusy(true); setError('');
    try {
      if (op==='create' && (!effectiveBranch || !warehouse || !product || !(Number(quantity)>0))) throw new Error(ar?'حدد المنتج والمخزن وكمية صحيحة':'Select product, warehouse and valid quantity');
      if (op==='cancel' && !window.confirm(ar?'هل تريد إلغاء أمر الإنتاج؟':'Cancel this production order?')) return;
      const { error: rpcError } = op==='create'
        ? await supabase.rpc('create_production_order',{p_product_id:product,p_branch_id:effectiveBranch,p_warehouse_id:warehouse,p_quantity:Number(quantity),p_notes:notes||null})
        : op==='start'
        ? await supabase.rpc('start_production_order',{p_order_id:id})
        : op==='complete'
        ? await supabase.rpc('complete_production_order',{p_order_id:id})
        : await supabase.rpc('cancel_production_order',{p_order_id:id});
      if (rpcError) throw rpcError;
      await load();
    } catch(e) {setError(e instanceof Error?e.message:String(e));}
    finally {setBusy(false);}
  };
  const names = new Map(products.map(x=>[x.id,x.name]));
  const warehouseNames = new Map(warehouses.map(x=>[x.id,x.name]));
  return <DesignSurface testId="production-orders-page">
    <DesignPageHeader title={ar?'أوامر الإنتاج':'Production orders'} subtitle={ar?'إنشاء ومتابعة وإتمام أوامر الإنتاج — الرصيد يزيد عند الإتمام فقط':'Create, track and complete production orders — inventory increases on completion only'}/>
    <div className="space-y-4 rounded-2xl border border-ui-border bg-ui-surface p-4">
      {!fixedBranch && <select aria-label={ar?'الفرع':'Branch'} className="rounded-lg border border-ui-border p-2 bg-ui-surface" value={branch} onChange={e=>{setBranch(e.target.value);setWarehouse('');setProduct('');}}><option value="">{ar?'اختر الفرع':'Select branch'}</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>}
      {can('raw_materials.manage') && <div className="flex flex-wrap items-center gap-2">
        <select aria-label={ar?'المنتج':'Product'} className="rounded-lg border border-ui-border p-2 bg-ui-surface" value={product} onChange={e=>setProduct(e.target.value)}><option value="">{ar?'اختر المنتج':'Select product'}</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select aria-label={ar?'المخزن':'Warehouse'} className="rounded-lg border border-ui-border p-2 bg-ui-surface" value={warehouse} onChange={e=>setWarehouse(e.target.value)}><option value="">{ar?'اختر المخزن':'Select warehouse'}</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <input aria-label={ar?'الكمية':'Quantity'} className="w-28 rounded-lg border border-ui-border p-2 bg-ui-surface" type="number" min="0.0001" step="any" value={quantity} onChange={e=>setQuantity(e.target.value)}/>
        <input aria-label={ar?'ملاحظات':'Notes'} className="rounded-lg border border-ui-border p-2 bg-ui-surface" value={notes} onChange={e=>setNotes(e.target.value)} placeholder={ar?'ملاحظات':'Notes'}/>
        <button className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50" disabled={busy||!effectiveBranch} onClick={()=>void perform('create')}>{ar?'إنشاء أمر إنتاج':'Create production order'}</button>
      </div>}
      {error && <p role="alert" className="text-red-600">{error}</p>}
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-ui-border">{[ar?'الأمر':'Order',ar?'المنتج':'Product',ar?'المخزن':'Warehouse',ar?'الكمية':'Quantity',ar?'الحالة':'Status',ar?'الإجراءات':'Actions'].map(h=><th key={h} className="p-2 text-start">{h}</th>)}</tr></thead><tbody>{orders.map(o=><tr key={o.id} className="border-b border-ui-border"><td className="p-2">{o.order_number||o.id.slice(0,8)}</td><td className="p-2">{names.get(o.product_id)||o.product_id}</td><td className="p-2">{warehouseNames.get(o.warehouse_id)||o.warehouse_id}</td><td className="p-2">{o.quantity}</td><td className="p-2">{o.status}</td><td className="p-2 space-x-2">{can('raw_materials.manage') && <>{o.status==='planned' && <button disabled={busy} className="underline" onClick={()=>void perform('start',o.id)}>{ar?'بدء':'Start'}</button>}{['planned','in_progress','started'].includes(o.status) && <button disabled={busy} className="underline" onClick={()=>void perform('complete',o.id)}>{ar?'إتمام':'Complete'}</button>}{['planned','in_progress','started'].includes(o.status) && <button disabled={busy} className="underline text-red-600" onClick={()=>void perform('cancel',o.id)}>{ar?'إلغاء':'Cancel'}</button>}</>}</td></tr>)}</tbody></table>{!orders.length && <p className="p-5 text-center text-ui-muted">{ar?'لا توجد أوامر إنتاج في الفرع المحدد':'No production orders for the selected branch'}</p>}</div>
    </div>
  </DesignSurface>;
}
