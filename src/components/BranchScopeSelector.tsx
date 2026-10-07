import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Layers3 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchScope } from '@/lib/branchScope';

type Props = {
  compact?: boolean;
  mobile?: boolean;
};

export function BranchScopeSelector({ compact = false, mobile = false }: Props) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const scope = useBranchScope();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const actionBranch = useMemo(
    () => scope.organizationBranches.find((branch) => branch.id === scope.actionBranchId) ?? null,
    [scope.actionBranchId, scope.organizationBranches],
  );

  const label = scope.allBranchesSelected
    ? (ar ? `إجمالي الفروع (${scope.selectedBranchIds.length})` : `All branches (${scope.selectedBranchIds.length})`)
    : scope.selectedBranchIds.length > 1
      ? (ar ? `${scope.selectedBranchIds.length} فروع` : `${scope.selectedBranchIds.length} branches`)
      : actionBranch
        ? (lang === 'ar' ? actionBranch.name : actionBranch.name_en || actionBranch.name)
        : (ar ? 'اختر الفروع' : 'Select branches');

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [open]);

  if (scope.organizationBranches.length === 0) {
    return (
      <div className="flex min-h-10 items-center gap-2 rounded-xl border border-ui-border bg-ui-surface px-3 text-xs font-bold text-ui-muted">
        <Building2 className="h-4 w-4" />
        {ar ? 'لا توجد فروع متاحة' : 'No branches available'}
      </div>
    );
  }

  if (mobile) {
    return (
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black text-ui-text">{ar ? 'فروع العرض' : 'View branches'}</p>
            <p className="text-[11px] text-ui-subtle">
              {ar ? 'اختر فرعًا أو أكثر لعرض إجمالي البيانات.' : 'Choose one or more branches for combined data.'}
            </p>
          </div>
          <button
            type="button"
            data-testid="mobile-all-branches"
            onClick={() => scope.setAllBranches(!scope.allBranchesSelected)}
            className={`rounded-xl border px-3 py-2 text-xs font-black ${
              scope.allBranchesSelected
                ? 'border-ui-primary bg-ui-primary-soft text-ui-primary'
                : 'border-ui-border bg-ui-page text-ui-muted'
            }`}
          >
            {ar ? 'إجمالي الفروع' : 'All branches'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {scope.organizationBranches.map((branch) => {
            const selected = scope.selectedBranchSet.has(branch.id);
            return (
              <button
                key={branch.id}
                type="button"
                data-testid={`mobile-branch-scope-${branch.id}`}
                onClick={() => scope.toggleBranch(branch.id)}
                className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 text-start text-xs font-bold ${
                  selected
                    ? 'border-ui-primary bg-ui-primary-soft text-ui-primary'
                    : 'border-ui-border bg-ui-page text-ui-muted'
                }`}
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                  selected ? 'border-ui-primary bg-ui-primary text-ui-primary-fg' : 'border-ui-border'
                }`}>
                  {selected && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className="truncate">{lang === 'ar' ? branch.name : branch.name_en || branch.name}</span>
              </button>
            );
          })}
        </div>

        <label className="grid gap-1">
          <span className="text-[11px] font-black text-ui-subtle">
            {ar ? 'فرع الإجراء' : 'Action branch'}
          </span>
          <select
            data-testid="mobile-action-branch-select"
            value={scope.actionBranchId || ''}
            onChange={(event) => scope.setActionBranchId(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-ui-border bg-ui-page px-3 text-sm font-semibold text-ui-text outline-none focus:border-ui-primary"
          >
            {scope.organizationBranches
              .filter((branch) => scope.selectedBranchSet.has(branch.id))
              .map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {lang === 'ar' ? branch.name : branch.name_en || branch.name}
                </option>
              ))}
          </select>
          {scope.isAggregate && (
            <span className="text-[10px] font-semibold text-ui-warning">
              {ar ? 'أي إنشاء أو تعديل أو حذف ينفذ على هذا الفرع فقط.' : 'Create, edit, and delete actions apply only to this branch.'}
            </span>
          )}
        </label>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        data-testid="branch-scope-indicator"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`flex items-center gap-2 rounded-xl border border-ui-border bg-ui-surface px-3 py-1.5 text-xs font-semibold text-ui-text transition hover:bg-ui-page-alt ${
          compact ? 'max-w-[210px]' : 'max-w-[260px]'
        }`}
      >
        {scope.isAggregate ? <Layers3 className="h-4 w-4 shrink-0 text-ui-primary" /> : <Building2 className="h-4 w-4 shrink-0 text-ui-primary" />}
        <span className="truncate">{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ui-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          data-testid="branch-scope-menu"
          className="absolute end-0 top-full z-50 mt-2 w-[320px] overflow-hidden rounded-2xl border border-ui-border bg-ui-surface shadow-ui-lg"
        >
          <div className="border-b border-ui-border p-3">
            <button
              type="button"
              data-testid="all-branches-option"
              onClick={() => scope.setAllBranches(!scope.allBranchesSelected)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-start ${
                scope.allBranchesSelected
                  ? 'border-ui-primary bg-ui-primary-soft text-ui-primary'
                  : 'border-ui-border bg-ui-page text-ui-text'
              }`}
            >
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                scope.allBranchesSelected ? 'border-ui-primary bg-ui-primary text-ui-primary-fg' : 'border-ui-border'
              }`}>
                {scope.allBranchesSelected && <Check className="h-3.5 w-3.5" />}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-black">{ar ? 'إجمالي الفروع' : 'All branches'}</p>
                <p className="text-[11px] font-medium text-ui-subtle">
                  {ar ? 'عرض مجموع الفروع التي تمتلك صلاحية الوصول إليها.' : 'Show the combined data for accessible branches.'}
                </p>
              </div>
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto p-2">
            {scope.organizationBranches.map((branch) => {
              const selected = scope.selectedBranchSet.has(branch.id);
              return (
                <button
                  key={branch.id}
                  type="button"
                  data-testid={`branch-scope-option-${branch.id}`}
                  onClick={() => scope.toggleBranch(branch.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start text-sm text-ui-text transition hover:bg-ui-page-alt"
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                    selected ? 'border-ui-primary bg-ui-primary text-ui-primary-fg' : 'border-ui-border'
                  }`}>
                    {selected && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="truncate font-bold">{lang === 'ar' ? branch.name : branch.name_en || branch.name}</span>
                </button>
              );
            })}
          </div>

          <div className="border-t border-ui-border bg-ui-page-alt/60 p-3">
            <label className="grid gap-1.5">
              <span className="text-[11px] font-black text-ui-muted">
                {ar ? 'فرع الإجراء' : 'Action branch'}
              </span>
              <select
                data-testid="action-branch-select"
                value={scope.actionBranchId || ''}
                onChange={(event) => scope.setActionBranchId(event.target.value)}
                className="min-h-10 w-full rounded-xl border border-ui-border bg-ui-surface px-3 text-sm font-bold text-ui-text outline-none focus:border-ui-primary"
              >
                {scope.organizationBranches
                  .filter((branch) => scope.selectedBranchSet.has(branch.id))
                  .map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {lang === 'ar' ? branch.name : branch.name_en || branch.name}
                    </option>
                  ))}
              </select>
              {scope.isAggregate && (
                <span className="text-[10px] font-bold text-ui-warning">
                  {ar
                    ? 'الإجراءات الكتابية تنفذ على هذا الفرع فقط، بينما العرض يشمل الفروع المحددة.'
                    : 'Write actions use this branch only; the view includes all selected branches.'}
                </span>
              )}
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
