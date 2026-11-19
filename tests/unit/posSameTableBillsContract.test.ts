import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
const read=(path:string)=>readFileSync(path,'utf8');
describe('POS same-table guest bill transfer UI contract',()=>{
 it('exposes same-table separate-bill action through persisted selected order lines',()=>{
  const modal=read('src/features/pos/components/tables/TransferItemsModal.tsx');
  const panel=read('src/features/pos/components/order/CurrentOrderPanel.tsx');
  const sql=read('supabase/migrations/20261119163500_same_table_individual_bill_transfer.sql');
  expect(modal).toContain('split_bill: selectedTableId === sourceTable?.id');
  expect(modal).toContain('فصل في حساب مستقل');
  expect(modal).toContain('operation_id: crypto.randomUUID()');
  expect(panel).toContain('pos-select-all-saved-transfer-lines');
  expect(panel).toContain('transferLineIsSaved(item, saved)');
  expect(sql).toContain("IF NOT v_split_bill THEN");
  expect(sql).toContain("'SPLIT_BILL_REQUIRES_SOURCE_TABLE'");
  expect(sql).toContain("'TRANSFER_OPERATION_CONFLICT'");
  expect(sql).toContain("UPDATE public.order_kitchen_sends");
  expect(sql).toContain("'inventory_changed',false");
 });
 it('exposes independent open/pay selections on same physical table',()=>{
  const tables=read('src/features/pos/components/tables/TablesPanel.tsx');
  expect(tables).toContain("pos-same-table-separate-bills");
  expect(tables).toContain("tableOrders.map((bill)");
  expect(tables).toContain("onResume(bill)");
  expect(tables).toContain("onPay(bill)");
  const legacyMerge=read('src/features/pos/components/tables/TransferOrderModal.tsx');
  expect(legacyMerge).toContain('SOURCE_HAS_SENT_ITEMS');
  expect(legacyMerge).toContain('تحديد كل الأصناف المحفوظة');
 });
});
