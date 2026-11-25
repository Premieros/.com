import { supabase } from '@/api';
import type { Permission } from '@/lib/permissions';
import { APP_ROUTES, posOrderRoute, type AppRoute } from './routes';

export const RECORD_SEARCH_SOURCES = [
  { table: 'sales', route: APP_ROUTES.sales, permission: 'sales.view', label: ['فاتورة', 'Invoice'], columns: ['invoice_number'] },
  { table: 'orders', route: APP_ROUTES.pos, permission: 'pos.view', label: ['طلب نشط', 'Active order'], columns: ['order_number'] },
  { table: 'products', route: APP_ROUTES.products, permission: 'products.view', label: ['صنف', 'Product'], columns: ['name', 'name_en', 'sku', 'barcode'] },
  { table: 'customers', route: APP_ROUTES.customers, permission: 'customers.view', label: ['عميل', 'Customer'], columns: ['name', 'name_en', 'phone'] },
  { table: 'suppliers', route: APP_ROUTES.suppliers, permission: 'suppliers.view', label: ['مورد', 'Supplier'], columns: ['name', 'name_en', 'phone'] },
] as const satisfies readonly {
  table: string; route: AppRoute; permission: Permission; label: readonly [string, string]; columns: readonly string[];
}[];

export type RecordSearchSource = (typeof RECORD_SEARCH_SOURCES)[number];
export type RecordSearchResult = { id: string; label: string; route: string; branchId: string; kind: RecordSearchSource['label'] };
export const recordSearchTerm = (text: string) => text.trim().replace(/[^\p{L}\p{N}\p{M}\s+/-]/gu, '').slice(0, 72);

export async function findWorkspaceRecords(
  sources: readonly RecordSearchSource[], branchIds: string[], term: string, signal: AbortSignal,
) {
  if (!branchIds.length || term.length < 2) return { records: [], incomplete: false };
  const results = await Promise.allSettled(sources.map(async (source) => {
    let query = supabase.from(source.table)
      .select(`id,branch_id,${source.columns.join(',')}`)
      .in('branch_id', branchIds)
      .or(source.columns.map((column) => `${column}.ilike.${term}%`).join(','))
      .order(source.columns[0])
      .order('id')
      .limit(5)
      .abortSignal(signal);
    if (source.table === 'sales') query = query.eq('is_archived', false);
    if (source.table === 'orders') query = query.in('status', ['open', 'held']);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as unknown as Array<{ id: string; branch_id: string } & Record<string, string | null>>)
      .map((row): RecordSearchResult => ({
        id: `${source.table}:${row.id}`,
        label: row[source.columns[0]] || row.id,
        route: source.table === 'orders' ? posOrderRoute(row.id)
          : `${source.route}?${new URLSearchParams({ [source.table === 'sales' ? 'saleId' : 'record']: row.id })}`,
        branchId: row.branch_id,
        kind: source.label,
      }));
  }));
  return {
    records: results.flatMap((result) => result.status === 'fulfilled' ? result.value : []),
    incomplete: results.some((result) => result.status === 'rejected'),
  };
}
