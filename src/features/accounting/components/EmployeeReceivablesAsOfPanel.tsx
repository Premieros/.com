import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useCan } from '@/lib/permissions';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { businessDateISO } from '@/lib/businessTime';
import { formatFinancialCurrency } from '@/lib/format';
import { useSettings } from '@/context/SettingsContext';
import type { ArAgingRow } from '@/lib/types';

interface EmployeeSummaryRow {
  customer_id: string;
  name: string;
  open_amount: number;
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
}

/** Existing employee receivable balances RPC, evaluated at one as-of date.
 * No invented period debit/credit columns or balance mutations.
 */
export function EmployeeReceivablesAsOfPanel({ branchId }: { branchId: string }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const can = useCan();
  const history = useHistoryAccess();
  const { effectiveSettings } = useSettings();
  const currency = effectiveSettings(branchId)?.currency || 'EGP';
  const today = businessDateISO();
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<EmployeeSummaryRow[]>([]);
  const [loadedDate, setLoadedDate] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const token = useRef(0);
  const allowed = can('accounts.view');
  const scope = [branchId, allowed, history.minDate || ''].join('|');
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date)
    && date <= today && history.clampRange(date, date).from === date
    && history.clampRange(date, date).to === date;

  const run = useCallback(async () => {
    const request = ++token.current;
    const currentScope = scope;
    setRows([]);
    setLoadedDate('');
    setError('');
    if (!allowed || !branchId || !valid) return;
    setLoading(true);
    try {
      const [{ data: customers, error: customersError }, { data: balances, error: balanceError }] = await Promise.all([
        supabase.from('customers').select('id,name').eq('branch_id', branchId).eq('customer_type', 'employee').order('name'),
        supabase.rpc('get_employee_receivable_balances', { p_branch_id: branchId, p_as_of: date }),
      ]);
      if (customersError || balanceError) throw customersError || balanceError;
      if (!Array.isArray(customers) || !Array.isArray(balances)) throw new Error('INVALID_EMPLOYEE_BALANCES');
      if (request !== token.current || scopeRef.current !== currentScope) return;
      const byId = new Map((balances as ArAgingRow[]).map(row => [row.customer_id, row]));
      setRows((customers as { id: string; name: string }[]).map(person => {
        const row = byId.get(person.id);
        return {
          customer_id: person.id, name: person.name,
          open_amount: Number(row?.open_amount || 0),
          bucket_0_30: Number(row?.bucket_0_30 || 0),
          bucket_31_60: Number(row?.bucket_31_60 || 0),
          bucket_61_90: Number(row?.bucket_61_90 || 0),
          bucket_90_plus: Number(row?.bucket_90_plus || 0),
        };
      }));
      setLoadedDate(date);
    } catch {
      if (request === token.current && scopeRef.current === currentScope) {
        setError(ar ? 'تعذر تحميل أرصدة ذمم الموظفين لهذا التاريخ.' : 'Could not load employee receivable balances for this date.');
      }
    } finally {
      if (request === token.current && scopeRef.current === currentScope) setLoading(false);
    }
  }, [allowed, ar, branchId, date, scope, valid]);

  useEffect(() => {
    token.current += 1;
    setRows([]);
    setLoadedDate('');
    setLoading(false);
    setError('');
    return () => { token.current += 1; };
  }, [scope]);

  const total = rows.reduce((sum, row) => sum + row.open_amount, 0);
  const money = (value: number) => formatFinancialCurrency(value, currency, lang);

  return <section data-testid="employee-receivables-as-of" className="space-y-3 rounded-xl border border-ui-border bg-ui-surface p-4">
    <h3 className="text-base font-bold">{ar ? 'أرصدة ذمم الموظفين حتى تاريخ' : 'Employee receivables as of date'}</h3>
    <p className="text-xs text-ui-muted">{ar
      ? 'قراءة تاريخية لرصيد الموظفين وأعمار الدين. ليست تقرير حركة المدين والمسدد خلال فترة.'
      : 'Historical employee balances and aging buckets. Not a period debit/credit movements report.'}</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm font-semibold">{ar ? 'تاريخ الرصيد' : 'Balance date'}
        <input type="date" dir="ltr" lang="en-GB-u-ca-gregory" value={date}
          max={today} min={history.minDate || undefined}
          onChange={event => { setDate(event.target.value); setLoadedDate(''); setRows([]); }}
          className="mt-1 block rounded-lg border border-ui-border bg-ui-page p-2" />
      </label>
      <button type="button" disabled={!valid || !branchId || !allowed || loading}
        onClick={() => void run()} className="rounded-lg bg-ui-primary px-4 py-2 text-sm font-bold text-ui-primary-fg disabled:opacity-40">
        {loading ? (ar ? 'جارٍ التحميل…' : 'Loading…') : (ar ? 'عرض الأرصدة' : 'View balances')}
      </button>
    </div>
    {!valid && <p role="alert" className="text-xs text-ui-warning">{ar ? 'التاريخ غير صحيح أو خارج نطاق صلاحية الاطلاع.' : 'Invalid date or outside permitted history.'}</p>}
    {error && <p role="alert" className="text-xs text-ui-danger">{error}</p>}
    {loadedDate === date && !loading && <>
      <p className="text-sm font-bold">{ar ? 'إجمالي الرصيد المستحق' : 'Total outstanding'}: {money(total)} · {rows.length} {ar ? 'موظف' : 'employees'}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[660px] text-sm">
          <thead><tr className="border-b border-ui-border">
            {(ar ? ['الموظف', 'المستحق', '0–30', '31–60', '61–90', '+90'] : ['Employee', 'Outstanding', '0–30', '31–60', '61–90', '90+'])
              .map(label => <th key={label} className="p-2 text-start">{label}</th>)}
          </tr></thead>
          <tbody>{rows.map(row => <tr key={row.customer_id} className="border-b border-ui-border">
            <td className="p-2 font-semibold">{row.name}</td>
            {[row.open_amount, row.bucket_0_30, row.bucket_31_60, row.bucket_61_90, row.bucket_90_plus].map((value, index) =>
              <td key={index} className="p-2 tabular-nums">{money(value)}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </>}
  </section>;
}
