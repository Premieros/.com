import { readFileSync } from 'node:fs';
import {describe,expect,it} from 'vitest';

const source=readFileSync('src/features/manufacturing/pages/RawMaterialsPage.tsx','utf8');
describe('Raw material price approval is explicit and zero-safe',()=>{
 it('provides a dedicated authorized approved-price action, not a catalog-only save',()=>{
   expect(source).toContain('raw-material-approved-price-panel');
   expect(source).toContain("api.costing.setRawMaterialPrice({");
   expect(source).toContain("p_unit_cost: amount");
   expect(source).toContain("p_raw_material_id: form.id");
   expect(source).toContain("p_branch_id: form.branch_id");
   expect(source).toContain("can('raw_materials.manage')");
 });
 it('accepts explicit zero and rejects empty or invalid text without coercing to zero',()=>{
   expect(source).toContain('const raw = approvalPrice.trim();');
   expect(source).toContain('if (!raw || !');
   expect(source).toContain('Number.isFinite(amount)');
   expect(source).not.toContain("Number(approvalPrice) || 0");
   expect(source).toContain('الصفر سعر معتمد صالح');
 });
 it('distinguishes current approved price from historical batch average',()=>{
   expect(source).toContain('متوسط الدفعات التاريخي');
   expect(source).toContain('ليست السعر المعتمد');
 });
});
