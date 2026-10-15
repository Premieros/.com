import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Layers3 } from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchScope } from '@/lib/branchScope';

type Props = {
  compact?: boolean;
  mobile?: boolean;
};

type OrganizationRow = {
  id: string;
  name: string;
};

export function BranchScopeSelector({ compact = false, mobile = false }: Props) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const scope = useBranchScope();
  const [open, setOpen] = useState(false);
  const [organizations, setOrganizations] = useState<OrganizationRow[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const actionBranch = useMemo(
    () => scope.branches.find((branch) => branch.id === scope.actionBranchId) ?? null,
    [scope.actionBranchId, scope.branches],
  );

  const organizationIds = useMemo(
    () => [...new Set(scope.branches.map((branch) => branch.organization_id).filter((id): id is string => !!id))],
    [scope.branches],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (organizationIds.length === 0) {
        setOrganizations([]);
        return;
      }
      const { data, error } = await supabase
        .from('organizations')
        .select('id,name')
        .in('id', organizationIds)
        .order('name');
      if (cancelled) return;
      if (error) {
        console.error('[BranchScopeSelector] organizations unavailable', error);
        setOrganizations(organizationIds.map((id) => ({ id, name: id.slice(0, 8) })));
        return;
      }
      setOrganizations((data || []) as OrganizationRow[]);
    };
    void load();
    return () => { cancelled = true; };
  }, [organizationIds.join(',')]);

  const orgNameById = useMemo(
    () => new Map(organizations.map((org) => [org.id, org.name])),
    [organizations],
  );

  const groups = useMemo(() => {
    const map = new Map<string, typeof scope.branches>();
    for (const branch of scope.branches) {
      const key = branch.organization_id || '__no_org__';
      const list = map.get(key) || [];
      list.push(branch);
      map.set(key, list);
    }
    return [...map.entries()].map(([organizationId, branches]) => ({
      organizationId,
      name: organizationId === '__no_org__'
        ? (ar ? 'بدون مؤسسة' : 'No organization')
        : (orgNameById.get(organizationId) || (ar ? 'مؤسسة' : 'Organization')),
      branches,
      selectedCount: branches.filter((branch) => scope.selectedBranchSet.has(branch.id)).length,
    }));
  }, [ar, orgNameById, scope.branches, scope.selectedBranchSet]);

  const label = scope.allBranchesSelected
    ? (ar ? `إجمالي الفروع (${scope.selectedBranchIds.length})` : `All branches (${scope.selectedBranchIds.length})`)
    : scope.selectedBranchIds.length > 1
      ? (ar ? `${scope.selectedOrganizationIds.length} مؤسسة • ${scope.selectedBranchIds.length} فرع` : `${scope.selectedOrganizationIds.length} orgs • ${scope.selectedBranchIds.length} branches`)
      : actionBranch
        ? (lang === 'ar' ? actionBranch.name : actionBranch.name_en || actionBranch.name)
        : (ar ? 'اختر المؤسسة والفروع' : 'Select organization & branches');

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

  if (scope.branches.length === 0) {
    return (
      <div className="flex min-h-9 items-center gap-2 rounded-lg border border-ui-border bg-ui-surface px-3 text-xs font-bold text-ui-muted">
        <Building2 className="h-4 w-4" />
        {ar ? 'لا توجد فروع متاحة' : 'No branches available'}
      </div>
    );
  }

  const renderGroups = () => (
    <div className="space-y-1.5">
      {groups.map((group) => {
        const allSelected = group.selectedCount === group.branches.length && group.branches.length > 0;
        const someSelected = group.selectedCount > 0 && !allSelected;
        return (
          <div key={group.organizationId} className="overflow-hidden rounded-lg border border-ui-border">
            <button
              type="button"
              data-testid={`organization-scope-${group.organizationId}`}
              onClick={() => {
                if (group.organizationId !== '__no_org__') {
                  scope.setOrganizationSelected(group.organizationId, !allSelected);
                }
              }}
              className="flex w-full items-center justify-between gap-2 bg-ui-page-alt px-2.5 py-1.5 text-start"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                  allSelected
                    ? 'border-ui-primary bg-ui-primary text-ui-primary-fg'
                    : someSelected
                      ? 'border-ui-primary bg-ui-primary-soft text-ui-primary'
                      : 'border-ui-border bg-ui-surface'
                }`}>
                  {(allSelected || someSelected) && <Check className="h-3.5 w-3.5" />}
                </span>
                <Building2 className="h-4 w-4 shrink-0 text-ui-primary" />
                <span className="truncate text-xs font-black text-ui-text">{group.name}</span>
              </span>
              <span className="shrink-0 text-[10px] font-bold text-ui-subtle">
                {group.selectedCount}/{group.branches.length}
              </span>
            </button>

            <div className="p-1">
              {group.branches.map((branch) => {
                const selected = scope.selectedBranchSet.has(branch.id);
                return (
                  <button
                    key={branch.id}
                    type="button"
                    data-testid={`branch-scope-option-${branch.id}`}
                    onClick={() => scope.toggleBranch(branch.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs text-ui-text transition hover:bg-ui-page-alt"
                  >
                    <span className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border ${
                      selected ? 'border-ui-primary bg-ui-primary text-ui-primary-fg' : 'border-ui-border'
                    }`}>
                      {selected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate font-bold">{lang === 'ar' ? branch.name : branch.name_en || branch.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );

  if (mobile) {
    return (
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-black text-ui-text">{ar ? 'المؤسسات والفروع' : 'Organizations & branches'}</p>
            <p className="text-[10px] text-ui-subtle">
              {ar ? 'حدد المؤسسة كاملة أو اختر فروعًا منها.' : 'Select an organization or individual branches.'}
            </p>
          </div>
          <button
            type="button"
            data-testid="mobile-all-branches"
            onClick={() => scope.setAllBranches(!scope.allBranchesSelected)}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-black ${
              scope.allBranchesSelected
                ? 'border-ui-primary bg-ui-primary-soft text-ui-primary'
                : 'border-ui-border bg-ui-page text-ui-muted'
            }`}
          >
            {ar ? 'إجمالي الكل' : 'All'}
          </button>
        </div>

        <div className="max-h-64 overflow-y-auto pr-0.5">
          {renderGroups()}
        </div>

        <label className="grid gap-1">
          <span className="text-[10px] font-black text-ui-subtle">{ar ? 'فرع الإجراء' : 'Action branch'}</span>
          <select
            data-testid="mobile-action-branch-select"
            value={scope.actionBranchId || ''}
            onChange={(event) => scope.setActionBranchId(event.target.value)}
            className="min-h-10 w-full rounded-lg border border-ui-border bg-ui-page px-3 text-xs font-semibold text-ui-text outline-none focus:border-ui-primary"
          >
            {scope.branches
              .filter((branch) => scope.selectedBranchSet.has(branch.id))
              .map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {lang === 'ar' ? branch.name : branch.name_en || branch.name}
                </option>
              ))}
          </select>
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
        className={`flex min-h-9 items-center gap-2 rounded-lg border border-ui-border bg-ui-surface px-3 text-xs font-semibold text-ui-text transition hover:bg-ui-page-alt ${
          compact ? 'max-w-[190px]' : 'max-w-[230px]'
        }`}
      >
        {scope.isAggregate ? <Layers3 className="h-4 w-4 shrink-0 text-ui-primary" /> : <Building2 className="h-4 w-4 shrink-0 text-ui-primary" />}
        <span className="truncate">{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ui-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          data-testid="branch-scope-menu"
          className="absolute end-0 top-full z-50 mt-2 w-[258px] overflow-hidden rounded-lg border border-ui-border bg-ui-surface shadow-ui-lg"
        >
          <div className="border-b border-ui-border p-1.5">
            <button
              type="button"
              data-testid="all-branches-option"
              onClick={() => scope.setAllBranches(!scope.allBranchesSelected)}
              className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-start ${
                scope.allBranchesSelected
                  ? 'border-ui-primary bg-ui-primary-soft text-ui-primary'
                  : 'border-ui-border bg-ui-page text-ui-text'
              }`}
            >
              <span className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border ${
                scope.allBranchesSelected ? 'border-ui-primary bg-ui-primary text-ui-primary-fg' : 'border-ui-border'
              }`}>
                {scope.allBranchesSelected && <Check className="h-3 w-3" />}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-black">{ar ? 'إجمالي المؤسسات والفروع' : 'All organizations & branches'}</p>
                <p className="text-[10px] text-ui-subtle">{ar ? 'كل ما تملك صلاحية الوصول إليه.' : 'Everything you can access.'}</p>
              </div>
            </button>
          </div>

          <div className="max-h-56 overflow-y-auto p-1.5">
            {renderGroups()}
          </div>

          <div className="border-t border-ui-border bg-ui-page-alt/60 p-1.5">
            <label className="grid gap-1">
              <span className="text-[10px] font-black text-ui-muted">{ar ? 'فرع الإجراء' : 'Action branch'}</span>
              <select
                data-testid="action-branch-select"
                value={scope.actionBranchId || ''}
                onChange={(event) => scope.setActionBranchId(event.target.value)}
                className="min-h-9 w-full rounded-lg border border-ui-border bg-ui-surface px-2.5 text-xs font-bold text-ui-text outline-none focus:border-ui-primary"
              >
                {scope.branches
                  .filter((branch) => scope.selectedBranchSet.has(branch.id))
                  .map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {lang === 'ar' ? branch.name : branch.name_en || branch.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
