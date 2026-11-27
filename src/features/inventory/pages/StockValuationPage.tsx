import { useEffect, useState } from 'react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranches } from '@/hooks/useBranches';
import { requireStockValuationRows } from '../services/requireStockValuationRows';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import { formatNumber } from '@/lib/format';
import { exportToExcel } from '@/lib/excel';
import type { StockValuationRow, Warehouse } from '@/lib/types';

export function StockValuationPage() {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const branchFilter = useBranchFilter();
  const { branches } = useBranches();

  const [rows, setRows] = useState<StockValuationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loadedScopeKey, setLoadedScopeKey] = useState('');

  useEffect(() => {
    setWarehouseId('');
    setWarehouses([]);
    setRows([]);
    setLoadedScopeKey('');
    setError(null);
  }, [branchFilter]);

  useEffect(() => {
    let cancelled = false;
    const key = `${branchFilter || ''}|${warehouseId}`;
    setLoading(true);
    setError(null);
    setRows([]);
    setLoadedScopeKey('');
    const load = async () => {
      if (!branchFilter) {
        if (!cancelled) {
          setError(isAr ? 'اختر فرعًا متاحًا لعرض تقييم المخزون.' : 'Select an accessible branch to view valuation.');
          setLoading(false);
        }
        return;
      }
      try {
        const wh = await supabase.from('warehouses').select('*')
          .eq('branch_id', branchFilter).eq('is_active', true).order('name');
        if (wh.error || !Array.isArray(wh.data)) throw wh.error || new Error('WAREHOUSES_UNAVAILABLE');
        const allowed = wh.data as Warehouse[];
        if (warehouseId && !allowed.some((w) => w.id === warehouseId)) throw new Error('WAREHOUSE_SCOPE_CHANGED');
        const result = await supabase.rpc('get_stock_valuation', {
          p_branch_id: branchFilter, p_warehouse_id: warehouseId || null,
        });
        if (result.error) throw result.error;
        const validated = requireStockValuationRows(
          result.data as StockValuationRow[] | null, branchFilter, warehouseId || null,
        );
        if (cancelled) return;
        setWarehouses(allowed);
        setRows(validated);
        setLoadedScopeKey(key);
      } catch {
        if (cancelled) return;
        setRows([]);
        setLoadedScopeKey('');
        setError(isAr
          ? 'تعذر تحميل تقييم المخزون الكامل. لن تُعرض أو تُصدَّر قيم قديمة. أعد المحاولة.'
          : 'Complete valuation unavailable. Stale values are hidden and cannot be exported. Retry.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [branchFilter, warehouseId, isAr]);

  const scopedRows = !loading && !error && loadedScopeKey === `${branchFilter || ''}|${warehouseId}`
    ? rows : [];

  const filtered = scopedRows.map((r) => ({
    ...r,
    id: `${r.product_id}-${r.warehouse_id}`,
  })).filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.product_name.toLowerCase().includes(q)
      || (r.barcode || '').toLowerCase().includes(q)
      || (r.warehouse_name || '').toLowerCase().includes(q);
  });

  const summary = Object.values(scopedRows.reduce<Record<string, { branch_id: string; branch_name: string; total_quantity: number; total_value: number }>>((acc, r) => {
    const id = r.branch_id;
    const item = acc[id] ?? (acc[id] = { branch_id: id, branch_name: branches.find(b => b.id === id)?.name || '', total_quantity: 0, total_value: 0 });
    item.total_quantity += Number(r.quantity);
    item.total_value += Number(r.total_value);
    return acc;
  }, {}));

  const grandTotal = scopedRows.reduce((s, r) => s + Number(r.total_value), 0);
  const grandQty = scopedRows.reduce((s, r) => s + Number(r.quantity), 0);

  const handleExport = () => {
    if (loading || error || !branchFilter || !loadedScopeKey) return;
    exportToExcel(filtered.map((r) => ({
      Product: r.product_name, Barcode: r.barcode || '', SKU: r.sku || '',
      Warehouse: r.warehouse_name || '', Branch: r.branch_id, Quantity: r.quantity,
      UnitCost: r.unit_cost, TotalValue: r.total_value,
    })), 'stock-valuation');
  };

  const columns: Column<StockValuationRow & { id: string }>[] = [
    { key: 'product', header: t('product'), render: (r) => (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-ui-page-alt flex items-center justify-center text-xs font-bold text-ui-subtle">
          {r.product_name[0]}
        </div>
        <div>
          <p className="font-medium text-ui-text">{r.product_name}</p>
          <p className="text-xs text-ui-subtle">{r.barcode || r.sku || ''}</p>
        </div>
      </div>
    )},
    { key: 'warehouse', header: t('warehouse'), render: (r) => r.warehouse_name || '-' },
    { key: 'quantity', header: t('quantity'), render: (r) => formatNumber(Number(r.quantity)) },
    { key: 'unit_cost', header: t('unitCost'), render: (r) => formatNumber(Number(r.unit_cost), 2) },
    { key: 'total_value', header: t('totalValue'), render: (r) => (
      <span className="font-semibold text-ui-text">{formatNumber(Number(r.total_value), 2)}</span>
    )},
  ];

  return (
    <DesignSurface testId="stock-valuation-page">
      <DesignPageHeader title={t('stockValuation')} subtitle={isAr ? 'تقييم المخزون بالتكلفة الحالية للعرض، وليس تكلفة قيود البيع التاريخية' : 'Current display cost — not historical sale COGS or journal valuation'} actions={
        <Button variant="outline" size="sm" disabled={loading || !!error || !branchFilter || !loadedScopeKey} onClick={handleExport}>{t('exportExcel')}</Button>
      } />

      {error && <div role="alert" data-testid="valuation-error" className="mb-3 rounded-xl border border-ui-danger/30 bg-ui-danger-soft p-3 text-sm text-ui-danger">{error}</div>}
      <DesignPanel testId="valuation-summary-panel">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-ui-lg border border-ui-border bg-ui-page p-4">
            <p className="text-xs font-medium text-ui-subtle uppercase tracking-wide">{t('grandTotal')}</p>
            <p className="mt-1 text-2xl font-bold text-ui-text">{formatNumber(grandTotal, 2)}</p>
          </div>
          <div className="rounded-ui-lg border border-ui-border bg-ui-page p-4">
            <p className="text-xs font-medium text-ui-subtle uppercase tracking-wide">{t('quantity')}</p>
            <p className="mt-1 text-2xl font-bold text-ui-text">{formatNumber(grandQty)}</p>
          </div>
        </div>
        {summary.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-medium text-ui-muted mb-2">{t('valuationByBranch')}</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {summary.map((s) => (
                <div key={s.branch_id} className="rounded-ui-lg border border-ui-border bg-ui-page-alt p-3">
                  <p className="text-sm font-medium text-ui-muted">{s.branch_name || '-'}</p>
                  <p className="text-xs text-ui-subtle">{formatNumber(Number(s.total_quantity))} {t('quantity')}</p>
                  <p className="text-base font-bold text-ui-text">{formatNumber(Number(s.total_value), 2)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </DesignPanel>

      <DesignPanel testId="valuation-search-panel">
        <div className="flex flex-col sm:flex-row gap-3">
          <DesignSearch value={search} onChange={setSearch} className="flex-1" label={t('search')} placeholder={t('search')} testId="valuation-search" />
          <span className="text-sm text-ui-muted">{branches.find((b) => b.id === branchFilter)?.name || (isAr ? 'الفرع النشط' : 'Active branch')}</span>
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="sm:w-44">
            <option value="">{t('all')} - {t('warehouses')}</option>
            {warehouses.filter((w) => w.branch_id === branchFilter).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </div>
      </DesignPanel>

      <DesignPanel testId="valuation-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} />
      </DesignPanel>
    </DesignSurface>
  );
}
