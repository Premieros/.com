import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {TableFloorPlan} from '@/features/pos/components/floor/TableFloorPlan';
import type {DiningArea, DiningTable} from '@/lib/types';

vi.mock('@/context/LanguageContext',()=>({useLanguage:()=>({lang:'ar',t:(s:string)=>s})}));
afterEach(cleanup);

it('shows early tables before areas arrive and keeps selection blocked until orders are confirmed',()=>{
 const select=vi.fn();
 const table={id:'table-a',branch_id:'branch-a',area_id:'area-a',name:'Table 01',capacity:4,status:'vacant'} as DiningTable;
 const props={tables:[table],ordersByTable:{},canManage:false,currency:'EGP',onSelectTable:select,
  onAddArea:vi.fn(),onAddTable:vi.fn(),onRenameArea:vi.fn(),onDeleteArea:vi.fn(),onEditDefaultAreaCount:vi.fn()};
 const view=render(<fieldset disabled><TableFloorPlan {...props} areas={[]}/></fieldset>);
 const button=screen.getByRole('button',{name:/Table 01/});
 expect(button).toBeDisabled();
 view.rerender(<fieldset><TableFloorPlan {...props} areas={[{id:'area-a',name:'Main Area'} as DiningArea]}/></fieldset>);
 expect(screen.getAllByRole('button',{name:/Table 01/})).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:/Table 01/}));
 expect(select).toHaveBeenCalledWith(table);
});
