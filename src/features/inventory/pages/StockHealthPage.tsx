import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { rpc } from '@/api/rpc';
import { Button } from '@/components/Button';
import { DataTable, type Column } from '@/components/DataTable';
import { DesignPageHeader, DesignPagination, DesignPanel, DesignSurface } from '@/components/design';
import { useLanguage } from '@/context/LanguageContext';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';
import { APP_ROUTES } from '@/core/navigation/routes';
import { useBranchScope } from '@/lib/branchScope';
import { formatDate, formatNumber } from '@/lib/format';
import { useCan } from '@/lib/permissions';

const pageSize = 50;
type Mode = 'cover' | 'idle' | 'expiry';
type StockHealthRow = {
  id: string;
  item_type: 'raw' | 'product' | 'manufactured';
  item_id: string;
  item_name: string;
  quantity: number;
  usage_quantity: number | null;
  cover_days: number | null;
  batch_id: string | null;
  batch_number: string | null;
  expiry_date: string | null;
};

export function StockHealthPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const can = useCan();
  const { canAccessPath } = useOrganizationModules();
  const { selectedBranchIds } = useBranchScope();
  const [params, setParams] = useSearchParams();
  const history = can('inventory.ledger.view') && can('history.unlimited');
  const requested = params.get('view');
  const mode: Mode = !history || requested === 'expiry' ? 'expiry' : requested === 'idle' ? 'idle' : 'cover';
  const branch = selectedBranchIds.length === 1 ? selectedBranchIds[0] : '';
  const requestedPage = Number(params.get('page'));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 1000 ? requestedPage : 0;
  const setPage = (value: number) => setParams({ view: mode, ...(value ? { page: String(value) } : {}) });
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: StockHealthRow[]; error: boolean }>();
  const key = `${branch}:${mode}:${page}:${revision}`;

  useEffect(() => {
    if (!branch) return;
    let active = true;
    void rpc<Omit<StockHealthRow, 'id'>[]>('get_workspace_stock_health', {
      p_branch: branch, p_view: mode, p_offset: page * pageSize,
    }).then(({ data, error }) => {
      if (active) setResult({ key, error: !!error, rows: (data ?? []).map((row) => ({
        ...row, id: row.batch_id || `${row.item_type}:${row.item_id}`,
      })) });
    }).catch(() => { if (active) setResult({ key, error: true, rows: [] }); });
    return () => { active = false; };
  }, [branch, key, mode, page]);

  const visible = result?.key === key ? result : undefined;
  const rows = visible?.rows.slice(0, pageSize) ?? [];
  const modeLabels = {
    cover: ar ? 'أيام التغطية' : 'Days of cover',
    idle: ar ? 'أرصدة بلا صرف خلال 30 يومًا' : 'Stock with no issues in 30 days',
    expiry: ar ? 'الصلاحية' : 'Expiry',
  };
  const itemLabels = {
    raw: ar ? 'خامة' : 'Raw material',
    product: ar ? 'منتج' : 'Product',
    manufactured: ar ? 'مصنّع' : 'Manufactured unit',
  };
  const canTransfer = can('inventory.transfer.create') && canAccessPath(APP_ROUTES.transfers);
  const canPurchase = (can('procurement.request.create') || can('purchases.manage')) && canAccessPath(APP_ROUTES.lowStockAlerts);
  const columns: Column<StockHealthRow>[] = [
    { key: 'item_name', header: ar ? 'الصنف' : 'Item', mobilePriority: true, render: (row) => (
      <div>
        {canAccessPath(APP_ROUTES.stockBalances)
          ? <Link className="font-semibold text-ui-primary" to={`${APP_ROUTES.stockBalances}?record=${row.item_id}`}>{row.item_name}</Link>
          : <p className="font-semibold">{row.item_name}</p>}
        <p className="text-xs text-ui-muted">{itemLabels[row.item_type]}</p>
      </div>
    ) },
    { key: 'quantity', header: ar ? 'الرصيد' : 'Balance', render: (row) => formatNumber(Number(row.quantity), 3) },
    ...(mode === 'cover' ? [
      { key: 'usage_quantity', header: ar ? 'صافي الصرف في 30 يومًا' : 'Net issues in 30 days', render: (row: StockHealthRow) => formatNumber(Number(row.usage_quantity), 3) },
      { key: 'cover_days', header: ar ? 'أيام التغطية التقديرية' : 'Estimated days of cover', render: (row: StockHealthRow) => formatNumber(Number(row.cover_days), 1) },
    ] : []),
    ...(mode === 'expiry' ? [
      { key: 'batch_number', header: ar ? 'رقم التشغيلة' : 'Batch number', render: (row: StockHealthRow) => row.item_type === 'raw' && row.batch_id && canAccessPath(APP_ROUTES.inventoryBatches)
        ? <Link className="font-bold text-ui-primary" to={`${APP_ROUTES.inventoryBatches}?record=${row.batch_id}`}>{row.batch_number || '—'}</Link>
        : row.batch_number || '—' },
      { key: 'expiry_date', header: ar ? 'تاريخ الصلاحية' : 'Expiry date', render: (row: StockHealthRow) => row.expiry_date ? formatDate(row.expiry_date, lang) : '—' },
    ] : []),
    { key: 'actions', header: ar ? 'الإجراءات' : 'Actions', render: (row) => (
      <div className="flex flex-wrap gap-3 text-xs font-bold text-ui-primary">
        {row.item_type === 'raw' && mode !== 'expiry' && canTransfer && <Link to={`${APP_ROUTES.transfers}?item=${row.item_id}`}>{ar ? 'تحويل خامة' : 'Transfer material'}</Link>}
        {row.item_type !== 'manufactured' && mode === 'cover' && canPurchase && <Link to={`${APP_ROUTES.lowStockAlerts}?item=${row.item_id}`}>{ar ? 'إعادة الطلب' : 'Reorder'}</Link>}
      </div>
    ) },
  ];

  return (
    <DesignSurface testId="stock-health-page">
      <DesignPageHeader title={ar ? 'صحة المخزون' : 'Stock health'} actions={
        <Button variant="outline" size="sm" disabled={!branch} onClick={() => setRevision((value) => value + 1)}>
          {ar ? 'تحديث' : 'Refresh'}
        </Button>
      } />
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={ar ? 'تحليلات المخزون' : 'Stock analyses'}>
        {(history ? ['cover', 'idle', 'expiry'] as const : ['expiry'] as const).map((item) => (
          <Button key={item} size="sm" variant={mode === item ? 'primary' : 'outline'} aria-pressed={mode === item}
            onClick={() => setParams({ view: item })}>{modeLabels[item]}</Button>
        ))}
      </div>
      <p className="mb-3 text-xs text-ui-muted">
        {mode === 'expiry'
          ? (ar ? 'التشغيلات ذات الرصيد الموجب المنتهية أو التي تنتهي خلال 30 يومًا.' : 'Positive-balance lots that have expired or expire within 30 days.')
          : (ar ? 'تستند التغطية إلى صافي صرف البيع والإنتاج خلال آخر 30 يومًا مكتملًا.' : 'Coverage uses net sales and production issues in the last 30 complete days.')}
      </p>
      {branch ? (
        <DesignPanel>
          <DataTable data={rows} columns={columns} loading={!visible}
            error={visible?.error ? (ar ? 'تعذّر تحميل مؤشرات المخزون.' : 'Stock indicators could not be loaded.') : null}
            emptyMessage={ar ? 'لا توجد نتائج لهذا العرض.' : 'No results for this view.'} />
          {(page > 0 || (visible?.rows.length ?? 0) > pageSize) && (
            <div className="flex items-center gap-3 p-3">
              <Button size="sm" variant="outline" disabled={page === 0 || !visible} onClick={() => setPage(page - 1)}>{ar ? 'السابق' : 'Previous'}</Button>
              <DesignPagination total={null} loaded={page * pageSize + rows.length} hasMore={(visible?.rows.length ?? 0) > pageSize} loadingMore={!visible} onLoadMore={() => setPage(page + 1)} />
            </div>
          )}
        </DesignPanel>
      ) : <p role="status">{ar ? 'اختر فرعًا واحدًا لعرض مؤشرات المخزون.' : 'Select a single branch to view stock indicators.'}</p>}
    </DesignSurface>
  );
}
