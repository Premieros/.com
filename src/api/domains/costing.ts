import type { ApiResult } from '../types';
import type { CostingOverviewRow, ProductCostingDetail, CostHistoryRow, SupplierPriceImpactRow, OrderMarginRow, RawMaterialCostOverviewRow, RawMaterialCostHistoryRow } from '@/lib/types';
import { rpc } from '../rpc';

type CostingSalesSummary = {
  sales_count: number;
  net_sales: number;
  cogs: number;
  ratio: number;
};

export type RawConsumptionCostBreakdownRow = {
  raw_material_id: string;
  raw_material_name: string;
  raw_material_code: string | null;
  unit_name: string;
  consumed_quantity: number;
  actual_quantity: number;
  estimated_quantity: number;
  actual_cost: number;
  estimated_cost: number;
  displayed_cost: number;
};

export type CostingV2Row = {
  item_id: string;
  organization_id: string;
  branch_id: string;
  item_type: string;
  name: string;
  code: string | null;
  inventory_cost: number | null;
  costing_reference_cost: number | null;
  theoretical_cost: number | null;
  standard_cost: number | null;
  standard_effective_from: string | null;
  standard_effective_to: string | null;
  theoretical_cost_basis: string;
  theoretical_cost_status: 'AVAILABLE' | 'MISSING_INPUT';
};

export type StandardCostHistoryRow = {
  id: string;
  standard_cost: number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type SetStandardCostResult = {
  success: boolean;
  error?: string;
  permission?: string;
  standard_cost_id?: string;
  item_id?: string;
  branch_id?: string;
  standard_cost?: number;
  effective_from?: string;
  effective_to?: string | null;
};

export type SaleCostVarianceV2Row = {
  sale_id: string;
  invoice_number: string | null;
  sale_created_at: string;
  net_sales: number;
  actual_cogs: number | null;
  actual_cogs_basis: 'JOURNAL_POSTED' | 'KITCHEN_SNAPSHOT' | 'LEGACY_LEDGER' | 'MISSING';
  theoretical_cost: number | null;
  theoretical_basis:
    | 'IMMUTABLE_SALE_SNAPSHOT_V1'
    | 'CURRENT_RECIPE_REFERENCE_NOT_HISTORICAL'
    | 'MIXED_SNAPSHOT_AND_CURRENT_REFERENCE'
    | 'INCOMPLETE';
  theoretical_coverage_status: 'COMPLETE' | 'NO_NET_LINES' | 'UNMAPPED_ITEM' | 'MODIFIER_UNMODELED' | 'MISSING_INPUT';
  standard_cost: number | null;
  standard_coverage_status: 'COMPLETE' | 'NO_NET_LINES' | 'UNMAPPED_ITEM' | 'NO_STANDARD_COST' | 'PARTIAL_STANDARD_COST';
  actual_vs_theoretical_variance: number | null;
  actual_vs_standard_variance: number | null;
  theoretical_vs_standard_variance: number | null;
  actual_food_cost_pct: number | null;
  theoretical_food_cost_pct: number | null;
};

export type PurchaseCostVarianceV2Row = {
  purchase_id: string;
  invoice_number: string | null;
  purchase_created_at: string;
  raw_material_id: string;
  item_id: string | null;
  received_base_quantity: number | null;
  actual_base_unit_cost: number | null;
  actual_cost_status: 'LEDGER_NORMALIZED' | 'MISSING_LEDGER';
  prior_reference_unit_cost: number | null;
  reference_cost_status: 'PRIOR_PURCHASE_REFERENCE' | 'NO_PRIOR_PURCHASE';
  standard_unit_cost: number | null;
  standard_cost_status: 'AVAILABLE' | 'NO_STANDARD_COST';
  actual_vs_reference_unit_variance: number | null;
  actual_vs_reference_total_variance: number | null;
  actual_vs_standard_unit_variance: number | null;
  actual_vs_standard_total_variance: number | null;
};

export type CostingSnapshotHealthV2Row = {
  snapshot_started_at: string;
  eligible_sale_items: number;
  snapshotted_sale_items: number;
  theoretical_available: number;
  theoretical_missing_input: number;
  snapshot_failures: number;
  missing_snapshot_without_failure: number;
};

export const costing = {
  getItemCostingV2(p_branch_id: string): ApiResult<CostingV2Row[]> {
    return rpc('get_item_costing_v2', { p_branch_id });
  },

  getSaleCostVarianceV2(p: {
    p_branch_id: string;
    p_from?: string | null;
    p_to?: string | null;
    p_limit?: number;
    p_offset?: number;
  }): ApiResult<SaleCostVarianceV2Row[]> {
    return rpc('get_sale_cost_variance_v2' as any, {
      p_branch_id: p.p_branch_id,
      p_from: p.p_from ?? null,
      p_to: p.p_to ?? null,
      p_limit: p.p_limit ?? 200,
      p_offset: p.p_offset ?? 0,
    } as any);
  },

  getPurchaseCostVarianceV2(p: {
    p_branch_id: string;
    p_from?: string | null;
    p_to?: string | null;
    p_limit?: number;
    p_offset?: number;
  }): ApiResult<PurchaseCostVarianceV2Row[]> {
    return rpc('get_purchase_cost_variance_v2' as any, {
      p_branch_id: p.p_branch_id,
      p_from: p.p_from ?? null,
      p_to: p.p_to ?? null,
      p_limit: p.p_limit ?? 200,
      p_offset: p.p_offset ?? 0,
    } as any);
  },

  getCostingSnapshotHealthV2(p_branch_id: string): ApiResult<CostingSnapshotHealthV2Row[]> {
    return rpc('get_costing_snapshot_health_v2' as any, { p_branch_id } as any);
  },
  getItemStandardCostHistory(p: { p_item_id: string; p_branch_id: string }): ApiResult<StandardCostHistoryRow[]> {
    return rpc('get_item_standard_cost_history', p);
  },
  setItemStandardCost(p: {
    p_item_id: string;
    p_branch_id: string;
    p_standard_cost: number;
    p_reason: string;
    p_effective_from?: string | null;
  }): ApiResult<SetStandardCostResult> {
    const args: Record<string, unknown> = {
      p_item_id: p.p_item_id,
      p_branch_id: p.p_branch_id,
      p_standard_cost: p.p_standard_cost,
      p_reason: p.p_reason,
    };
    if (p.p_effective_from) args.p_effective_from = p.p_effective_from;
    return rpc('set_item_standard_cost', args);
  },
  getOverview(p: { p_branch_id?: string | null }): ApiResult<CostingOverviewRow[]> { return rpc('get_costing_overview', p); },
  getProductDetail(p: { p_product_id: string; p_branch_id?: string | null }): ApiResult<ProductCostingDetail> { return rpc('get_product_costing_detail', p); },
  getCostHistory(p: { p_product_id: string; p_limit?: number }): ApiResult<CostHistoryRow[]> { return rpc('get_cost_history', p); },
  getSupplierPriceImpact(p: { p_supplier_id: string }): ApiResult<SupplierPriceImpactRow[]> { return rpc('get_supplier_price_impact', p); },
  getOrderMargin(p: { p_branch_id?: string | null; p_from?: string | null; p_to?: string | null }): ApiResult<OrderMarginRow[]> { return rpc('get_order_margin', p); },
  getSalesSummary(p: { p_branch_id?: string | null; p_from?: string | null; p_to?: string | null }): ApiResult<CostingSalesSummary> { return rpc('get_costing_sales_summary', p); },
  getRawMaterialCostOverview(p: { p_branch_id?: string | null }): ApiResult<RawMaterialCostOverviewRow[]> { return rpc('get_raw_material_cost_valuation_overview', p); },
  getRawMaterialCostHistory(p: { p_raw_material_id: string; p_branch_id?: string | null; p_limit?: number }): ApiResult<RawMaterialCostHistoryRow[]> { return rpc('get_raw_material_cost_history', p); },
  getRawConsumptionCostBreakdown(p: { p_branch_id: string; p_from: string; p_to: string }): ApiResult<RawConsumptionCostBreakdownRow[]> { return rpc('get_raw_consumption_cost_breakdown', p); },
  setRawMaterialPrice(p: { p_raw_material_id: string; p_branch_id: string; p_unit_cost: number; p_note?: string | null }): ApiResult<{ success: boolean; error?: string; permission?: string; event_id?: string; reference_number?: string; unit_cost?: number; source?: 'pricing'; priced_at?: string }> { return rpc('set_raw_material_price', p); },
};
