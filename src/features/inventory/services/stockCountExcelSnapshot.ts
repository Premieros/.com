import { supabase } from '@/api';
import { fetchAllReportRows } from '@/features/reporting/fetchAllReportRows';

/**
 * Reads authorized stock quantities for exactly one selected branch and warehouse.
 * Importing a workbook never writes stock; it only prepares the normal count draft.
 */
export async function loadStockCountExcelSnapshot(
  branchId: string,
  warehouseId: string,
): Promise<Record<string, number>> {
  const rows = await fetchAllReportRows(
    supabase.from('raw_material_warehouse_inventory')
      .select('raw_material_id, quantity')
      .eq('branch_id', branchId)
      .eq('warehouse_id', warehouseId)
      .order('raw_material_id'),
    500,
  );
  const result: Record<string, number> = {};
  for (const row of rows as Array<{ raw_material_id: string | null; quantity: number | string | null }>) {
    if (!row.raw_material_id) continue;
    result[row.raw_material_id] = (result[row.raw_material_id] || 0) + Number(row.quantity || 0);
  }
  return result;
}
