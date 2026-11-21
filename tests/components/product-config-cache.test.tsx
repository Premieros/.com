import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {Product} from '@/lib/types';
import {ProductConfigModal} from '@/features/pos/components/catalog/ProductConfigModal';

const mocks=vi.hoisted(()=>({read:vi.fn(),user:{id:'actor-a'}}));
vi.mock('@/api',()=>({catalog:{getProductModifiers:mocks.read}}));
vi.mock('@/context/LanguageContext',()=>({useLanguage:()=>({lang:'ar',t:(s:string)=>s})}));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({user:mocks.user})}));
vi.mock('@/features/catalog/components/ProductImage',()=>({ProductImage:()=>null}));
afterEach(()=>{cleanup();mocks.read.mockReset();mocks.user.id='actor-a';});
const product={id:'product-a',branch_id:'branch-a',name:'Coffee',sale_price:10} as Product;

it('reuses successful modifier reads on reopen while keeping actors and branches isolated',async()=>{
 mocks.read.mockResolvedValue({data:{success:true,groups:[]},error:null});
 const confirm=vi.fn();
 const props={product,currency:'EGP',isOpen:true,onClose:vi.fn(),onConfirm:confirm};
 const view=render(<ProductConfigModal {...props}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'إضافة'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'إضافة'}));
 expect(confirm).toHaveBeenCalledOnce();
 view.rerender(<ProductConfigModal {...props} isOpen={false}/>);
 view.rerender(<ProductConfigModal {...props}/>);
 await act(async()=>{});
 expect(mocks.read).toHaveBeenCalledTimes(1);
 mocks.user.id='actor-b';
 view.rerender(<ProductConfigModal {...props}/>);
 await act(async()=>{});
 expect(mocks.read).toHaveBeenCalledTimes(2);
 view.rerender(<ProductConfigModal {...props} product={{...product,branch_id:'branch-b'}}/>);
 await act(async()=>{});
 expect(mocks.read).toHaveBeenCalledTimes(3);
});

it('does not cache a failed read or permit adding without verified modifier rules',async()=>{
 mocks.read.mockResolvedValueOnce({data:null,error:{message:'Unavailable'}})
  .mockResolvedValueOnce({data:{success:true,groups:[]},error:null});
 const props={product,currency:'EGP',isOpen:true,onClose:vi.fn(),onConfirm:vi.fn()};
 const view=render(<ProductConfigModal {...props}/>);
 await screen.findByText('Unavailable');
 expect(screen.getByRole('button',{name:'إضافة'})).toBeDisabled();
 view.rerender(<ProductConfigModal {...props} isOpen={false}/>);
 view.rerender(<ProductConfigModal {...props}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'إضافة'})).toBeEnabled());
 expect(mocks.read).toHaveBeenCalledTimes(2);
});
