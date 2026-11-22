import { useState } from 'react';
import { TableCamera } from './TableCamera';
import type { GuestOrderType, QrTable } from './service';

const types = {
  delivery: ['توصيل', 'Delivery'],
  pickup: ['استلام من المطعم', 'Pickup'],
  dine_in: ['داخل المطعم', 'Dine in'],
} as const;

export function CartFulfillment({ type, tableName, tables, english, locked, saving, editing, setEditing, onSave }: {
  type: GuestOrderType;
  tableName?: string | null;
  tables: QrTable[];
  english: boolean;
  locked: boolean;
  saving: boolean;
  editing: boolean;
  setEditing: (editing: boolean) => void;
  onSave: (type: GuestOrderType, table: string | null, photo: string | null) => Promise<boolean>;
}) {
  const [choice, setChoice] = useState(type);
  const [table, setTable] = useState('');
  const [photo, setPhoto] = useState('');
  const [camera, setCamera] = useState(false);
  const label = (arabic: string, englishText: string) => english ? englishText : arabic;
  const selectingTable = choice === 'dine_in' && choice !== type;

  return <section className="customer-cart-fulfillment">
    <div className="customer-pickup-summary">
      <div>
        <small>{label('نوع الطلب', 'Order type')}</small>
        <strong>{types[type][english ? 1 : 0]}{type === 'dine_in' && tableName ? ` · ${tableName}` : ''}</strong>
      </div>
      {!locked && !editing && <button type="button" className="customer-refresh" onClick={() => {
        setChoice(type);
        setTable('');
        setPhoto('');
        setCamera(false);
        setEditing(true);
      }}>{label('تغيير نوع الطلب', 'Change order type')}</button>}
    </div>
    {editing && !locked && <form className="customer-delivery-checkout" onSubmit={async event => {
      event.preventDefault();
      if (choice === type || await onSave(choice, selectingTable ? table : null, selectingTable ? photo : null)) {
        setEditing(false);
        setCamera(false);
      }
    }}>
      <label>{label('كيف تستلم طلبك؟', 'How will you receive your order?')}
        <select value={choice} disabled={saving} onChange={event => {
          setChoice(event.target.value as GuestOrderType);
          setCamera(false);
        }}>
          {(Object.entries(types) as Array<[GuestOrderType, readonly [string, string]]>).map(([id, names]) =>
            <option key={id} value={id}>{names[english ? 1 : 0]}</option>)}
        </select>
      </label>
      {selectingTable && <>
        <label>{label('رقم الطاولة', 'Table number')}
          <select required value={table} onChange={event => setTable(event.target.value)}>
            <option value="">{label('اختر طاولتك', 'Choose your table')}</option>
            {tables.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
        {photo
          ? <img className="customer-table-photo" src={photo} alt={label('صورة رقم الطاولة', 'Table number photo')} />
          : camera
            ? <TableCamera onCapture={image => { setPhoto(image); setCamera(false); }} />
            : <button type="button" className="customer-refresh" onClick={() => setCamera(true)}>{label('صوّر رقم الطاولة', 'Photograph the table number')}</button>}
      </>}
      <button className="customer-primary" disabled={saving || (selectingTable && (!table || !photo))}>
        {saving ? label('جارٍ الحفظ…', 'Saving…') : label('اعتماد نوع الطلب', 'Apply order type')}
      </button>
      <button type="button" className="customer-refresh" disabled={saving} onClick={() => { setEditing(false); setCamera(false); }}>
        {label('إلغاء', 'Cancel')}
      </button>
    </form>}
  </section>;
}
