import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranches } from '@/hooks/useBranches';
import { useCan } from '@/lib/permissions';
import { DesignSurface, DesignPageHeader } from '@/components/design';

type Item = { id: string; name: string; branch_id: string };
type Production = { id: string; unit_id: string; branch_id: string; warehouse_id: string; quantity: number; status: string; total_cost: number | null; completed_at: string | null; created_at: string };
export function ProductionOrdersPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const can = useCan();
  const fixedBranch = useBranchFilter();
  const { branches } = useBranches();
  const [branch, setBranch] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [unit, setUnit] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [units, setUnits] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Item[]>([]);
  const [productions, setProductions] = useState<Production[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const effectiveBranch = fixedBranch || branch;
  const load = useCallback(async () => {
    if (!effectiveBranch) { setProductions([]); setUnits([]); setWarehouses([]); return; }
    const [u,w,p] = await Promise.all([
      supabase.from('inventory_units').select('id,name,branch_id').eq('branch_id',effectiveBranch).eq('unit_type','manufactured').eq('is_active',true).order('name'),
      supabase.from('warehouses').select('id,name,branch_id').eq('branch_id',effectiveBranch).eq('is_active',true).order('name'),
      supabase.from('inventory_unit_productions').select('id,unit_id,branch_id,warehouse_id,quantity,status,total_cost,completed_at,created_at').eq('branch_id',effectiveBranch).order('created_at',{ascending:false}).limit(300),
    ]);
    const failure=u.error||w.error||p.error;
    if (failure) { setError(failure.message); return; }
    setUnits((u.data||[]) as Item[]);
    setWarehouses((w.data||[]) as Item[]);
    setProductions((p.data||[]) as Production[]);
    setError('');
  },[effectiveBranch]);
  useEffect(()=>{void load();},[load]);
  const produce = async () => {
    const qty=Number(quantity);
    if (!effectiveBranch||!warehouse||!unit||!Number.isFinite(qty)||qty<=0) {
      setError(ar?'اختر المجموعة والمخزن وكمية صحيحة':'Select a manufactured group, warehouse and valid quantity');
      return;
    }
    if (!window.confirm(ar?'تأكيد الإنتاج؟ سيتم خصم الخامات وإضافة رصيد المجموعة المصنّعة الآن.':'Confirm production? Raw materials will be consumed and manufactured stock added now.')) return;
    setBusy(true);setError('');setNotice('');
    try {
      const { data, error:rpcError }=await supabase.rpc('produce_inventory_unit',{
        p_unit_id:unit,p_quantity:qty,p_warehouse_id:warehouse,p_branch_id:effectiveBranch,p_notes:notes||null,
      });
      if (rpcError) throw rpcError;
      if (!data) throw new Error('Production did not return a production ID');
      setNotice(ar?'تم تنفيذ الإنتاج وتحديث أرصدة الخامات والمصنّعات.':'Production completed; raw and manufactured stock updated.');
      setNotes('');
      await load();
    } catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  const unitNames=new Map(units.map(i=>[i.id,i.name]));
  const warehouseNames=new Map(warehouses.map(i=>[i.id,i.name]));
  return <DesignSurface testId="production-orders-page">
    <DesignPageHeader title={ar?'إنتاج مجموعات المكونات':'Manufactured component production'} subtitle={ar?'تنفيذ إنتاج المصنّعات من خاماتها وعرض سجل العمليات — يُخصم الخام ويزيد رصيد المصنّع عند التأكيد':'Produce manufactured component groups from raw materials and view production history'}/>
    <div className="space-y-4 rounded-2xl border border-ui-border bg-ui-surface p-4">
      {!fixedBranch && <select aria-label={ar?'الفرع':'Branch'} className="rounded-lg border border-ui-border p-2 bg-ui-surface" value={branch} onChange={e=>{setBranch(e.target.value);setWarehouse('');setUnit('');}}><option value="">{ar?'اختر الفرع':'Select branch'}</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>}
      {can('production.manage') && <div className="flex flex-wrap items-center gap-2">
        <select aria-label={ar?'المجموعة المصنّعة':'Manufactured group'} className="rounded-lg border border-ui-border p-2 bg-ui-surface" value={unit} onChange={e=>setUnit(e.target.value)}><option value="">{ar?'اختر مجموعة المكونات':'Select component group'}</option>{units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <select aria-label={ar?'المخزن':'Warehouse'} className="rounded-lg border border-ui-border p-2 bg-ui-surface" value={warehouse} onChange={e=>setWarehouse(e.target.value)}><option value="">{ar?'اختر المخزن':'Select warehouse'}</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <input aria-label={ar?'الكمية':'Quantity'} className="w-28 rounded-lg border border-ui-border p-2 bg-ui-surface" type="number" min="0.0001" step="any" value={quantity} onChange={e=>setQuantity(e.target.value)}/>
        <input aria-label={ar?'ملاحظات':'Notes'} className="rounded-lg border border-ui-border p-2 bg-ui-surface" value={notes} onChange={e=>setNotes(e.target.value)} placeholder={ar?'ملاحظات':'Notes'}/>
        <button type="button" className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50" disabled={busy||!effectiveBranch||!warehouse||!unit} onClick={()=>void produce()}>{busy?(ar?'جارٍ التنفيذ...':'Producing...'):(ar?'تنفيذ الإنتاج':'Complete production')}</button>
      </div>}
      {error&&<p role="alert" className="text-red-600">{error}</p>}
      {notice&&<p role="status" className="text-green-600">{notice}</p>}
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-ui-border">{[ar?'رقم العملية':'Production ID',ar?'المجموعة المصنّعة':'Manufactured group',ar?'المخزن':'Warehouse',ar?'الكمية':'Quantity',ar?'الحالة':'Status',ar?'تاريخ الإنتاج':'Completed at'].map(h=><th key={h} className="p-2 text-start">{h}</th>)}</tr></thead><tbody>{productions.map(p=><tr key={p.id} className="border-b border-ui-border"><td className="p-2">{p.id.slice(0,8)}</td><td className="p-2">{unitNames.get(p.unit_id)||p.unit_id}</td><td className="p-2">{warehouseNames.get(p.warehouse_id)||p.warehouse_id}</td><td className="p-2">{p.quantity}</td><td className="p-2">{p.status}</td><td className="p-2">{p.completed_at?new Date(p.completed_at).toLocaleString(ar?'ar-EG':'en-US'):'—'}</td></tr>)}</tbody></table>{!productions.length&&<p className="p-5 text-center text-ui-muted">{ar?'لا توجد عمليات إنتاج مسجلة للفرع':'No production records for this branch'}</p>}</div>
    </div>
  </DesignSurface>;
}
