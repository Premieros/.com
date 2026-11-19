import { describe, expect, it } from 'vitest';
import { computePosTotals, type PosTotalsInput } from '@/lib/posMath';

// Deterministic checkout math permutations; integration coverage is tracked
// separately. Never submit synthetic sales to a customer's live database.
const defaults: PosTotalsInput = {
  items: [{quantity: 2,unit_price:50,discount_amount:0}],
  discountType:'amount',discountAmount:0,taxRate:14,taxEnabled:true,
  paidAmount:114,paymentMethod:'cash',
};
const total = (changes:Partial<PosTotalsInput>={}) => computePosTotals({...defaults,...changes});

describe('POS financial scenario matrix - checkout totals',()=>{
 it.each([
  ['cash taxable',{}, {subtotal:100,discountValue:0,taxAmount:14,total:114,change:0}],
  ['card taxable',{paymentMethod:'card' as const,paidAmount:114},{subtotal:100,taxAmount:14,total:114,change:0}],
  ['percent discount',{discountType:'percent' as const,discountAmount:10,paidAmount:102.6},{discountValue:10,taxableAmount:90,taxAmount:12.6,total:102.6,change:0}],
  ['fixed discount',{discountAmount:20,paidAmount:100},{discountValue:20,taxableAmount:80,taxAmount:11.2,total:91.2,change:8.8}],
  ['tax off',{taxEnabled:false,paidAmount:100},{taxAmount:0,total:100,change:0}],
  ['credit sale',{paymentMethod:'credit' as const,paidAmount:300},{total:114,change:0}],
  ['full discount',{discountType:'percent' as const,discountAmount:100,paidAmount:0},{discountValue:100,total:0,change:0}],
  ['out-of-range percent',{discountType:'percent' as const,discountAmount:250,paidAmount:0},{discountValue:100,total:0}],
  ['negative order discount',{discountAmount:-20},{discountValue:0,total:114}],
  ['zero quantity',{items:[{quantity:0,unit_price:50,discount_amount:0}],paidAmount:0},{subtotal:0,total:0,change:0}],
  ['multi-item, line plus invoice discounts',{
    items:[{quantity:2,unit_price:50,discount_amount:5},{quantity:1,unit_price:20,discount_amount:0}],
    discountType:'percent' as const,discountAmount:10,paidAmount:130
  },{subtotal:115,discountValue:11.5,taxableAmount:103.5,taxAmount:14.49,total:117.99,change:12.01}]
 ])('%s',(_name,changes,expected)=>{
  const actual=total(changes);
  for(const [key,value] of Object.entries(expected))
    expect(actual[key as keyof typeof actual]).toBeCloseTo(value,8);
 });
 it('zero tender never reports change and does not create imaginary cash',()=>{
  expect(total({paidAmount:0}).change).toBe(0);
 });
 it('finite invalid invoice discounts do not create negative totals',()=>{
  for(const discountType of ['amount','percent'] as const){
   for(const discountAmount of [1e6,Infinity,-Infinity,NaN]){
    const result=total({discountType,discountAmount,paidAmount:0});
    expect(Number.isFinite(result.total)).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(0);
   }
  }
 });
});
