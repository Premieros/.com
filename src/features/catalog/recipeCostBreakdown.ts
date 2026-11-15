import type { RawRecipeEstimateLine, RawRecipeEstimatePrice } from './recipeDefaultCostPreview';

export type RecipeCostBreakdownRow = {
  rawMaterialId: string;
  baseQuantity: number;
  wastePercent: number;
  effectiveQuantity: number | null;
  unitCost: number | null;
  extendedCost: number | null;
  valid: boolean;
};

export type RecipeCostBreakdown = {
  lines: RecipeCostBreakdownRow[];
  knownSubtotal: number;
  complete: boolean;
  incompleteLines: number;
  excludedGroups: number;
  projectedCostRatio: number | null;
  projectedGrossMargin: number | null;
};

/**
 * Display-only preview using configured material default costs.
 * Missing prices, invalid quantities, and unvalued groups are never
 * represented as a final product cost or a projected gross margin.
 */
export function recipeCostBreakdown(
  lines: RawRecipeEstimateLine[],
  materials: RawRecipeEstimatePrice[],
  manufacturedGroups: number,
  salePrice: number,
): RecipeCostBreakdown {
  const costs = new Map(materials.map(item => [item.id, item.default_cost]));
  let knownSubtotal = 0;
  let incompleteLines = 0;
  const details = lines.map((line): RecipeCostBreakdownRow => {
    const price = costs.get(line.raw_material_id);
    const valid = !!line.raw_material_id
      && Number.isFinite(line.quantity) && line.quantity > 0
      && Number.isFinite(line.wastage_percent) && line.wastage_percent >= 0
      && price != null && Number.isFinite(price) && price > 0;
    const effectiveQuantity = Number.isFinite(line.quantity) && line.quantity > 0
      && Number.isFinite(line.wastage_percent) && line.wastage_percent >= 0
      ? line.quantity * (1 + line.wastage_percent / 100) : null;
    const extendedCost = valid && effectiveQuantity !== null && price != null
      ? effectiveQuantity * price : null;
    if (extendedCost === null || !Number.isFinite(extendedCost)) incompleteLines += 1;
    else knownSubtotal += extendedCost;
    return {
      rawMaterialId: line.raw_material_id,
      baseQuantity: line.quantity,
      wastePercent: line.wastage_percent,
      effectiveQuantity,
      unitCost: price != null && Number.isFinite(price) && price > 0 ? price : null,
      extendedCost: extendedCost !== null && Number.isFinite(extendedCost) ? Math.round(extendedCost * 100) / 100 : null,
      valid: extendedCost !== null && Number.isFinite(extendedCost),
    };
  });
  const excludedGroups = Math.max(0, Math.floor(manufacturedGroups) || 0);
  const complete = details.length > 0 && incompleteLines === 0 && excludedGroups === 0;
  const safePrice = Number.isFinite(salePrice) && salePrice > 0 ? salePrice : null;
  const projectedCostRatio = complete && safePrice !== null ? knownSubtotal / safePrice * 100 : null;
  const projectedGrossMargin = projectedCostRatio !== null ? 100 - projectedCostRatio : null;

  return {
    lines: details,
    knownSubtotal: Math.round(knownSubtotal * 100) / 100,
    complete,
    incompleteLines,
    excludedGroups,
    projectedCostRatio,
    projectedGrossMargin,
  };
}
