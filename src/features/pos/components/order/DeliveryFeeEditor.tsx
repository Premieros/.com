import { useEffect, useState } from 'react';
import { supabase } from '@/api';
import { formatFinancialCurrency } from '@/lib/format';
import { useLanguage } from '@/context/LanguageContext';

interface Fee { amount: number | null; collected: boolean }

export function DeliveryFeeEditor({ orderId, currency, canEdit, itemsTotal }: {
  orderId: string;
  currency: string;
  canEdit: boolean;
  itemsTotal: number;
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [fee, setFee] = useState<Fee | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    void supabase.rpc('order_delivery_fee', { p_order: orderId }).then(({ data, error: failure }) => {
      if (!alive) return;
      if (failure) setError(true);
      else if (data) {
        const current = data as Fee;
        setFee(current);
        setValue(current.amount == null ? '' : String(current.amount));
      }
    });
    return () => { alive = false; };
  }, [orderId]);

  async function save() {
    if (saving || !canEdit || !value.trim()) return;
    setSaving(true);
    setError(false);
    try {
      const { data, error: failure } = await supabase.rpc('save_order_delivery_fee', {
        p_order: orderId, p_amount: Number(value),
      });
      if (failure || !data) throw failure;
      setFee(data as Fee);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  const label = ar ? 'رسوم التوصيل' : 'Delivery fee';
  const errorMessage = ar ? 'تعذر تحديث رسوم التوصيل. أعد فتح الطلب وحاول مجددًا.' : 'Could not update the delivery fee. Reopen the order and try again.';
  if (!fee) return error ? <p role="status" className="text-xs text-ui-warning">{errorMessage}</p> : null;
  return <section className="rounded-xl border border-ui-border p-2.5 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong>{label}</strong>
      {fee.amount != null && <span>{formatFinancialCurrency(fee.amount, currency, lang)}</span>}
    </div>
    {fee.amount != null && <p className="mt-1 text-xs font-semibold">
      {ar ? 'الإجمالي مع التوصيل' : 'Total with delivery'} · {formatFinancialCurrency(itemsTotal + fee.amount, currency, lang)}
    </p>}
    {canEdit && !fee.collected && <form className="mt-2 flex gap-2" onSubmit={event => {
      event.preventDefault();
      void save();
    }}>
      <input aria-label={label} type="number" inputMode="decimal" min="0" max="999999" step="0.01" required
        value={value} onChange={event => setValue(event.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-ui-border bg-ui-surface px-2" />
      <button disabled={saving || !value.trim()} className="rounded-lg bg-ui-primary px-3 py-1.5 text-ui-primary-fg disabled:opacity-50">
        {saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ' : 'Save')}
      </button>
    </form>}
    {error && <p role="status" className="mt-1 text-xs text-ui-warning">{errorMessage}</p>}
    {fee.amount == null && <p className="mt-1 text-xs text-ui-muted">{ar ? 'أدخل 0 للتوصيل المجاني.' : 'Enter 0 for free delivery.'}</p>}
  </section>;
}
