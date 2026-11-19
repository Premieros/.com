import {describe,expect,it} from 'vitest';
import type {KitchenQueueItem} from '@/lib/types';
import {hasGenuinelyNewKitchenSend,kitchenSentLineKeys} from '@/features/inventory/utils/kitchenSendNotice';
const stamp='2026-11-19T09:00:00.000Z';
const after='2026-11-19T09:01:00.000Z';
const ticket=(orderId:string, lineId:string, sentAt=stamp):KitchenQueueItem=>({
 order_id:orderId,order_number:orderId,table_number:5,station:'main',
 kitchen_status:'sent',guest_count:2,notes:null,created_at:stamp,
 elapsed_seconds:1,
 items:[{order_item_id:lineId,sent_at:sentAt,product_name:'Burger',quantity:2,notes:null,modifiers:null}]
});
describe('KDS bell respects original kitchen sending, not billing/table IDs',()=>{
 it('never rings on initial queue load',()=>{
  expect(hasGenuinelyNewKitchenSend(null,[ticket('old','line')],Date.parse(stamp))).toBe(false);
 });
 it('does not ring when sent item moves to another table/guest bill',()=>{
  const previous=kitchenSentLineKeys([ticket('old','line')]);
  expect(hasGenuinelyNewKitchenSend(previous,[ticket('new-bill','line')],Date.parse(after))).toBe(false);
 });
 it('does not ring when partial transfer creates a NEW item/send ID but preserves historical sent time',()=>{
  const previous=kitchenSentLineKeys([ticket('old','line')]);
  expect(hasGenuinelyNewKitchenSend(previous,[ticket('new-bill','partial-line')],Date.parse(after))).toBe(false);
 });
 it('does ring for genuinely new send to an existing ticket, including a second product',()=>{
  const previous=kitchenSentLineKeys([ticket('old','line')]);
  expect(hasGenuinelyNewKitchenSend(previous,[ticket('old','line'),ticket('old','new-line','2026-11-19T09:02:00Z')],Date.parse(after))).toBe(true);
 });
 it('does not ring for legacy rows without sent timestamps',()=>{
  const old=ticket('old','line');old.items[0].sent_at=null;
  expect(hasGenuinelyNewKitchenSend(new Set(),[old],Date.parse(stamp))).toBe(false);
 });
 it('does not ring again on mere refresh of identical sends',()=>{
  const current=[ticket('old','line')];
  expect(hasGenuinelyNewKitchenSend(kitchenSentLineKeys(current),current,Date.parse('2026-11-19T08:00:00Z'))).toBe(false);
 });
});
