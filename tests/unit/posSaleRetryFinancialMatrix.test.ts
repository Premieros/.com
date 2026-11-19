import {describe,expect,it} from 'vitest';
import {decideOfflineSaleInsert} from '@/core/offline/offlineSaleIdempotency';
import type {OfflineSaleQueueItem} from '@/core/offline/offlineStorage';

const makeSale=(key='op:checkout-1'):OfflineSaleQueueItem=>({
 id:'queued-1',client_id:'queued-1',invoice_number:'INV-1',
 created_at:'2026-11-19T08:00:00.000Z',created_by_user_id:'cashier-A',
 status:'pending',retry_count:0,
 payload:{
  p_client_operation_key:key,p_invoice_number:'INV-1',p_branch_id:'branch-A',
  p_warehouse_id:'warehouse-A',p_shift_id:'shift-A',p_order_id:'order-A',
  p_total:114,p_paid_amount:114,p_payment_method:'cash',p_discount_amount:0,
  p_tax_amount:14,p_items:[{product_id:'product-1',quantity:2,unit_price:50}]
 }
});
describe('POS durable retry isolation across financial operation dimensions',()=>{
 it('accepts a true retry with a different generated invoice and object-key ordering',()=>{
  const saved=makeSale();const incoming={...makeSale(),id:'queued-2',invoice_number:'INV-2',
   payload:{...makeSale().payload,p_invoice_number:'INV-2'}};
  expect(decideOfflineSaleInsert([saved],incoming)).toEqual({id:'queued-1',inserted:false});
 });
 it.each([
  ['cashier identity',{created_by_user_id:'cashier-B'}],
  ['warehouse',{payload:{...makeSale().payload,p_warehouse_id:'warehouse-B'}}],
  ['shift',{payload:{...makeSale().payload,p_shift_id:'shift-B'}}],
  ['other order',{payload:{...makeSale().payload,p_order_id:'order-B'}}],
  ['payment method',{payload:{...makeSale().payload,p_payment_method:'card'}}],
  ['paid amount',{payload:{...makeSale().payload,p_paid_amount:100}}],
  ['tax amount',{payload:{...makeSale().payload,p_tax_amount:0}}],
  ['discount',{payload:{...makeSale().payload,p_discount_amount:10}}],
  ['line quantity',{payload:{...makeSale().payload,p_items:[{product_id:'product-1',quantity:3,unit_price:50}]}}],
 ] as const)('rejects reused key with changed %s',(_title,change)=>{
  const original=makeSale();const retry={...makeSale(),...change};
  expect(()=>decideOfflineSaleInsert([original],retry)).toThrow('OFFLINE_SALE_OPERATION_KEY_CONFLICT');
 });
 it('permits independent financial operation keys even with same invoice',()=>{
  expect(decideOfflineSaleInsert([makeSale()],makeSale('op:checkout-2'))).toEqual({
   id:'queued-1',inserted:true
  });
 });
});
