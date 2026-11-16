import type { ReactNode } from 'react';

export interface PartyProfileData {
  name: string;
  name_en?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  tax_number?: string | null;
  notes?: string | null;
}

export function PartyProfileCard({
  record, branchName, amount, ar, actions,
}: {
  record: PartyProfileData;
  branchName: string;
  amount: string;
  ar: boolean;
  actions?: ReactNode;
}) {
  const fields = [
    [ar ? 'الفرع' : 'Branch', branchName],
    [ar ? 'رقم الهاتف' : 'Phone', record.phone],
    [ar ? 'البريد الإلكتروني' : 'Email', record.email],
    [ar ? 'العنوان' : 'Address', record.address],
    [ar ? 'الاسم بالإنجليزية' : 'English name', record.name_en],
    [ar ? 'الرقم الضريبي' : 'Tax number', record.tax_number],
  ];
  return (
    <div className="space-y-5" data-testid="party-profile-card">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-ui-border bg-ui-page-alt p-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-600/10 text-xl font-black text-brand-600">
            {record.name.trim().slice(0, 1).toUpperCase() || '•'}
          </div>
          <div className="min-w-0">
            <h3 className="break-words text-lg font-bold text-ui-text" dir="auto">{record.name}</h3>
            <p className="text-sm text-ui-muted">{branchName}</p>
          </div>
        </div>
        <div className="rounded-xl border border-ui-border bg-ui-surface px-4 py-3">
          <div className="text-xs text-ui-muted">{ar ? 'الرصيد الحالي المعروض' : 'Displayed balance'}</div>
          <div className="font-bold text-ui-text tabular-nums">{amount}</div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-xl border border-ui-border p-3">
            <div className="text-xs font-semibold text-ui-muted">{label}</div>
            <div className="mt-1 break-words text-sm font-semibold text-ui-text" dir="auto">{value?.trim() || '—'}</div>
          </div>
        ))}
      </div>
      {record.notes && (
        <div className="rounded-xl border border-ui-border p-4">
          <div className="text-xs font-semibold text-ui-muted">{ar ? 'ملاحظات' : 'Notes'}</div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ui-text">{record.notes}</p>
        </div>
      )}
      {actions && <div className="flex flex-wrap justify-end gap-2 border-t border-ui-border pt-4">{actions}</div>}
    </div>
  );
}
