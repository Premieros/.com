/**
 * Compatible purchase-unit conversion.
 *
 * Johna's supported transforming the per-unit price when the purchasing unit
 * changes. Premier also adjusts the quantity so the invoice line amount
 * remains unchanged for the same physical goods.
 *
 * No database mutation occurs here. Unknown or incompatible units cannot
 * be converted implicitly.
 */
type UnitFamily = 'mass' | 'volume' | 'piece' | 'bag';

type KnownUnit = { family: UnitFamily; size: number };

function knownPurchaseUnit(value: string): KnownUnit | null {
  const label = value.trim().toLowerCase();
  if (['kg', 'kgs', 'kilogram', 'kilograms', 'كجم', 'كغ', 'كيلو'].includes(label)) return { family: 'mass', size: 1000 };
  if (['g', 'gr', 'gm', 'gram', 'grams', 'جم', 'جرام'].includes(label)) return { family: 'mass', size: 1 };
  if (['l', 'lt', 'liter', 'litre', 'liters', 'litres', 'ل', 'لتر'].includes(label)) return { family: 'volume', size: 1000 };
  if (['ml', 'mil', 'milliliter', 'milliliters', 'مل'].includes(label)) return { family: 'volume', size: 1 };
  if (['قطعة', 'حبة', 'each', 'ea', 'pcs', 'pc', 'piece', 'pieces'].includes(label)) return { family: 'piece', size: 1 };
  if (['كيس', 'باكيت', 'packet', 'pack', 'bag'].includes(label)) return { family: 'bag', size: 1 };
  return null;
}

export function convertPurchaseUnitPrice(price: number, from: string, to: string): number | null {
  if (!Number.isFinite(price) || price < 0) return null;
  if (from.trim().toLowerCase() === to.trim().toLowerCase()) return price;
  const source = knownPurchaseUnit(from);
  const target = knownPurchaseUnit(to);
  if (!source || !target || source.family !== target.family) return null;
  return price * target.size / source.size;
}

export function convertPurchaseLineUnit(
  input: { quantity: number; unit_cost: number; unit_name: string },
  nextUnit: string,
): { quantity: number; unit_cost: number; unit_name: string } | null {
  if (!Number.isFinite(input.quantity) || input.quantity < 0) return null;
  const unitCost = convertPurchaseUnitPrice(input.unit_cost, input.unit_name, nextUnit);
  if (unitCost === null) return null;
  const source = knownPurchaseUnit(input.unit_name);
  const target = knownPurchaseUnit(nextUnit);
  if (input.unit_name.trim().toLowerCase() !== nextUnit.trim().toLowerCase() && (!source || !target)) return null;
  const quantity = source && target
    ? input.quantity * source.size / target.size
    : input.quantity;
  if (!Number.isFinite(quantity) || !Number.isFinite(unitCost)) return null;
  return { quantity, unit_cost: unitCost, unit_name: nextUnit };
}
