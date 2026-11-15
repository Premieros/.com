/** Non-posting estimate using configured raw-material default costs only.
 * Never substitutes for posted COGS, FIFO or historical approved valuation.
 */
export interface RawRecipeEstimateLine {
  raw_material_id: string; quantity: number; wastage_percent: number;
}
export interface RawRecipeEstimatePrice { id: string; default_cost?: number | null }

export function estimateRawRecipeDefaultCost(
  lines: RawRecipeEstimateLine[],
  materials: RawRecipeEstimatePrice[],
  manufacturedGroups: number,
): { subtotal: number; complete: boolean; missingPrices: number; includesGroups: boolean } {
  const byId = new Map(materials.map(row => [row.id, row.default_cost]));
  let subtotal = 0;
  let missingPrices = 0;
  let complete = lines.length > 0 && manufacturedGroups === 0;
  for (const line of lines) {
    const cost = byId.get(line.raw_material_id);
    const validLine = !!line.raw_material_id && Number.isFinite(line.quantity) && line.quantity > 0
      && Number.isFinite(line.wastage_percent) && line.wastage_percent >= 0;
    if (!validLine || cost == null || !Number.isFinite(cost) || cost <= 0) {
      missingPrices += 1;
      complete = false;
      continue;
    }
    subtotal += line.quantity * (1 + line.wastage_percent / 100) * cost;
  }
  return { subtotal: Math.round(subtotal * 100) / 100, complete, missingPrices, includesGroups: manufacturedGroups > 0 };
}
