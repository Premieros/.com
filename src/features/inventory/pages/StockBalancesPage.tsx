import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranches } from '@/hooks/useBranches';
import { DesignSurface, DesignPageHeader } from '@/components/design';

type Balance = { key: string; kind: 'product' | 'raw' | 'manufactured'; name: string; branch: string; warehouse: string; quantity: number };


const PAGE_SIZE = 1000;
async function allRows(table: string, columns: string, branchIds: string[]): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase.from(table).select(columns).in('branch_id', branchIds).range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}
export function StockBalancesPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const fixedBranch = useBranchFilter();
  const { branches, loading: branchesLoading } = useBranches();
  const [branch, setBranch] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Balance[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: string; branch_id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (branchesLoading) return;
    const ids = fixedBranch ? [fixedBranch] : branch ? [branch] : branches.map(b => b.id);
    if (!ids.length) { setRows([]); return; }
    let cancelled = false;
    setBusy(true); setError('');
    (async () => {
      try {
        const [balanceRows, warehouseRows] = await Promise.all([
          allRows('v_stock_balances_unified', 'item_type,item_id,item_name,branch_id,warehouse_id,quantity', ids),
          allRows('warehouses', 'id,branch_id,name', ids),
        ]);
        if (cancelled) return;
        const whs = warehouseRows as { id: string; branch_id: string; name: string }[];
        setWarehouses(whs);
        setRows(balanceRows.map(row => ({
          key: [row.item_type,row.branch_id,row.warehouse_id,row.item_id].join(':'),
          kind: row.item_type as Balance['kind'],
          name: String(row.item_name),
          branch: String(row.branch_id),
          warehouse: String(row.warehouse_id),
          quantity: Number(row.quantity),
        })));
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; };
  }, [branch, fixedBranch, branches, branchesLoading, revision]);
  const result = useMemo(() => rows.filter(r =>
    (!warehouse || r.warehouse === warehouse) &&
    (kind === 'all' || r.kind === kind) &&
    (status === 'all' || (status === 'negative' ? r.quantity < 0 : status === 'positive' ? r.quantity > 0 : r.quantity === 0)) &&
    r.name.toLowerCase().includes(search.trim().toLowerCase())
  ).sort((a, b) => a.name.localeCompare(b.name, ar ? 'ar' : 'en')), [rows, warehouse, kind, status, search, ar]);
  const warehouseName = new Map(warehouses.map(w => [w.id, w.name]));
  const branchName = new Map(branches.map(b => [b.id, b.name]));
  const label = (k: Balance['kind']) => k === 'raw' ? (ar ? 'خام' : 'Raw') : k === 'manufactured' ? (ar ? 'مصنّع' : 'Manufactured') : (ar ? 'منتج' : 'Product');
  return <DesignSurface testId="stock-balances-page">
    <DesignPageHeader title={ar ? 'الأرصدة المتاحة' : 'Available stock balances'} subtitle={ar ? 'المنتجات والخامات والمصنّعات — بما فيها الأرصدة الموجبة والسالبة والصفرية' : 'Products, raw materials and manufactured units — including positive, negative and zero balances'} />
    <div className="rounded-2xl border border-ui-border bg-ui-surface p-4 space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        {!fixedBranch && <select aria-label={ar ? 'الفرع' : 'Branch'} className="rounded-lg border border-ui-border bg-ui-surface p-2" value={branch} onChange={e => {setBranch(e.target.value);setWarehouse('');}}><option value="">{ar ? 'كل الفروع' : 'All branches'}</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
        <select aria-label={ar ? 'المخزن' : 'Warehouse'} className="rounded-lg border border-ui-border bg-ui-surface p-2" value={warehouse} onChange={e => setWarehouse(e.target.value)}><option value="">{ar ? 'كل المخازن' : 'All warehouses'}</option>{warehouses.filter(w => !branch || w.branch_id === branch).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select aria-label={ar ? 'النوع' : 'Type'} className="rounded-lg border border-ui-border bg-ui-surface p-2" value={kind} onChange={e=>setKind(e.target.value)}><option value="all">{ar ? 'كل الأنواع' : 'All types'}</option><option value="product">{ar ? 'المنتجات' : 'Products'}</option><option value="raw">{ar ? 'الخامات' : 'Raw materials'}</option><option value="manufactured">{ar ? 'المصنّعات' : 'Manufactured'}</option></select>
        <select aria-label={ar ? 'حالة الرصيد' : 'Balance status'} className="rounded-lg border border-ui-border bg-ui-surface p-2" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">{ar ? 'كل الأرصدة' : 'All balances'}</option><option value="positive">{ar ? 'موجب' : 'Positive'}</option><option value="negative">{ar ? 'سالب' : 'Negative'}</option><option value="zero">{ar ? 'صفر' : 'Zero'}</option></select>
        <div className="flex items-center gap-2 border border-ui-border rounded-lg px-3"><Search size={16}/><input aria-label={ar ? 'بحث' : 'Search'} placeholder={ar ? 'بحث بالاسم' : 'Search by name'} value={search} onChange={e=>setSearch(e.target.value)} className="bg-transparent p-2 outline-none"/></div>
        <button type="button" onClick={()=>setRevision(n=>n+1)} className="rounded-lg border border-ui-border p-2 flex items-center gap-2"><RefreshCw size={16}/>{ar ? 'تحديث' : 'Refresh'}</button>
      </div>
      <div className="text-sm text-ui-muted">{ar ? 'عدد الأرصدة المعروضة:' : 'Shown balances:'} {result.length} · {ar ? 'السالبة:' : 'Negative:'} {result.filter(r=>r.quantity<0).length} · {ar ? 'الموجبة:' : 'Positive:'} {result.filter(r=>r.quantity>0).length}</div>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {busy ? <p>{ar ? 'جاري تحميل الأرصدة...' : 'Loading balances...'}</p> : <div className="overflow-x-auto"><table className="w-full text-sm text-start"><thead><tr className="border-b border-ui-border"><th className="p-3 text-start">{ar ? 'الصنف' : 'Item'}</th><th className="p-3 text-start">{ar ? 'النوع' : 'Type'}</th><th className="p-3 text-start">{ar ? 'الفرع' : 'Branch'}</th><th className="p-3 text-start">{ar ? 'المخزن' : 'Warehouse'}</th><th className="p-3 text-end">{ar ? 'الرصيد' : 'Balance'}</th></tr></thead><tbody>{result.map(r=><tr key={r.key} className="border-b border-ui-border"><td className="p-3">{r.name}</td><td className="p-3">{label(r.kind)}</td><td className="p-3">{branchName.get(r.branch) || r.branch}</td><td className="p-3">{warehouseName.get(r.warehouse) || r.warehouse}</td><td dir="ltr" className={`p-3 text-end font-semibold tabular-nums ${r.quantity < 0 ? 'text-red-600' : r.quantity > 0 ? 'text-green-600' : 'text-ui-muted'}`}>{r.quantity.toLocaleString(undefined,{ maximumFractionDigits:4 })}</td></tr>)}</tbody></table>{!result.length && <p className="p-6 text-center text-ui-muted">{ar ? 'لا توجد أرصدة مطابقة' : 'No matching balances'}</p>}</div>}
      <p className="text-xs text-ui-muted">{ar ? 'يتم عرض الأرصدة المسجلة حسب المخزن. العناصر التي لم تُسجل لها أي حركة مخزنية بعد لا تظهر.' : 'Shows recorded warehouse balances. Items without any warehouse movement are not shown.'}</p>
    </div>
  </DesignSurface>;
}
