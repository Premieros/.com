import { useEffect, useMemo, useRef, useState } from 'react';
import { Package, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { MENU_ITEMS } from '@/core/navigation/menu.config';
import { isAdminRole, useCan } from '@/lib/permissions';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';
import { moduleForRoute } from '@/core/modules/module.config';
import { useBranchScope } from '@/lib/branchScope';
import { RECORD_SEARCH_SOURCES, findWorkspaceRecords, recordSearchTerm, type RecordSearchResult } from '@/core/navigation/recordSearch';
import { businessMenuLabel } from '@/core/organizations/businessRuntime';

const OPEN_COMMAND_PALETTE_EVENT = 'premier:open-command-palette';

export function CommandPalette() {
  const { lang } = useLanguage();
  const { user } = useAuth();
  const can = useCan();
  const navigate = useNavigate();
  const { canAccessModule, canAccessPath, runtime } = useOrganizationModules();
  const ar = lang === 'ar';
  const { actionBranchId, scopeKey, loading: scopeLoading } = useBranchScope();
  const [recordResults, setRecordResults] = useState<{ key: string; records: RecordSearchResult[]; incomplete: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  const items = useMemo(() => {
    const admin = isAdminRole(user?.role);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return MENU_ITEMS.filter((item) => {
      if (item.superAdminOnly && user?.role !== 'super_admin') return false;
      if (item.ownerOnly && !admin) return false;
      if (item.permission && !can(item.permission)) return false;
      if (item.permissionsAny && !item.permissionsAny.some((permission) => can(permission))) return false;
      if (runtime.navigation.hidden.has(item.id)) return false;
      if (!canAccessModule(moduleForRoute(item.route))) return false;
      if (!canAccessPath(item.route)) return false;
      if (!normalizedQuery) return true;
      const label = businessMenuLabel(
        runtime,
        item.id,
        ar ? 'ar' : 'en',
        item.label ? item.label[ar ? 'ar' : 'en'] : item.labelKey,
      );
      return [item.id, label, item.group, item.route]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [ar, can, canAccessModule, canAccessPath, query, runtime, user?.role]);

  const term = recordSearchTerm(query);
  const recordKey = `${user?.id ?? ''}:${user?.role ?? ''}:${scopeKey}:${actionBranchId ?? ''}:${term}`;
  const sources = useMemo(() => RECORD_SEARCH_SOURCES.filter((source) =>
    can(source.permission) && canAccessModule(moduleForRoute(source.route)) && canAccessPath(source.route)
    && !runtime.navigation.hidden.has(MENU_ITEMS.find((item) => item.route === source.route)?.id ?? ''),
  ), [can, canAccessModule, canAccessPath, runtime]);

  useEffect(() => {
    if (!open || !user?.id || scopeLoading || term.length < 2 || !actionBranchId || !sources.length) return;
    const request = new AbortController();
    const timer = window.setTimeout(() => {
      void findWorkspaceRecords(sources, [actionBranchId], term, request.signal).then((result) => {
        if (!request.signal.aborted) setRecordResults({ key: recordKey, ...result });
      });
    }, 350);
    return () => { window.clearTimeout(timer); request.abort(); };
  }, [open, user?.id, scopeLoading, recordKey, actionBranchId, sources, term]);

  const matched = scopeLoading || recordResults?.key !== recordKey ? null : recordResults;
  const records = matched?.records.filter((record) => sources.some(
    (source) => record.id.startsWith(`${source.table}:`),
  )) ?? [];
  const length = items.length + records.length;
  useEffect(() => {
    if (selectedIndex >= length) setSelectedIndex(Math.max(length - 1, 0));
  }, [length, selectedIndex]);

  if (!open) return null;

  const choose = (index: number) => {
    if (index < records.length) {
      const record = records[index];
      navigate(record.route, { state: { branchId: record.branchId } });
    } else {
      const item = items[index - records.length];
      if (!item) return;
      navigate(item.route);
    }
    setOpen(false);
  };

  return (
    <div data-testid="command-palette-overlay" className="fixed inset-0 z-[100] bg-black/35 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-sm sm:p-4" dir={ar ? 'rtl' : 'ltr'} onMouseDown={() => setOpen(false)}>
      <div data-testid="command-palette-panel" className="mx-auto flex h-[min(88dvh,720px)] max-w-2xl flex-col overflow-hidden rounded-2xl border border-ui-border bg-ui-surface shadow-2xl sm:mt-[10vh] sm:h-auto" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-ui-border px-4">
          <Search className="h-5 w-5 text-ui-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0); }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedIndex((value) => Math.min(value + 1, Math.max(length - 1, 0))); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedIndex((value) => Math.max(value - 1, 0)); }
              if (event.key === 'Enter') { event.preventDefault(); choose(selectedIndex); }
            }}
            className="h-14 min-w-0 flex-1 bg-transparent text-ui-text outline-none"
            placeholder={ar ? 'ابحث عن شاشة أو فاتورة أو صنف…' : 'Search screens, invoices or items…'}
            aria-label={ar ? 'بحث الأوامر' : 'Command search'}
          />
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-ui-muted hover:bg-ui-page-alt" aria-label={ar ? 'إغلاق' : 'Close'}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 sm:max-h-[55vh]">
          {records.map((record, index) => (
            <button key={record.id} type="button" onMouseEnter={() => setSelectedIndex(index)} onClick={() => choose(index)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start ${index === selectedIndex ? 'bg-ui-primary-soft text-ui-primary' : 'hover:bg-ui-page-alt'}`}>
              <span className="min-w-0 flex-1 truncate font-semibold">{record.label}</span>
              <span className="text-xs text-ui-muted">
                {record.kind[ar ? 0 : 1]}
              </span>
            </button>
          ))}
          {matched?.incomplete && <p role="status" className="p-2 text-xs text-ui-warning">{ar ? 'بعض مصادر البحث غير متاحة.' : 'Some search sources are unavailable.'}</p>}
          {term.length >= 2 && actionBranchId && sources.length > 0 && !matched && (
            <p role="status" className="p-2 text-xs text-ui-muted">{ar ? 'جارٍ البحث في السجلات…' : 'Searching records…'}</p>
          )}
          {length === 0 && (matched || term.length < 2 || !actionBranchId || !sources.length) && (
            <div className="p-8 text-center text-sm text-ui-muted">{ar ? 'لا توجد نتائج مطابقة.' : 'No matching results.'}</div>
          )}
          {items.map((item, itemIndex) => {
            const index = itemIndex + records.length;
            return (
            <button key={item.id} type="button" onMouseEnter={() => setSelectedIndex(index)} onClick={() => choose(index)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start transition ${index === selectedIndex ? 'bg-ui-primary-soft text-ui-primary' : 'text-ui-text hover:bg-ui-page-alt'}`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ui-page-alt"><Package className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{businessMenuLabel(
                runtime,
                item.id,
                ar ? 'ar' : 'en',
                item.label ? item.label[ar ? 'ar' : 'en'] : item.labelKey,
              )}</span><span className="block truncate text-xs text-ui-muted">{item.route}</span></span>
              {item.permission && <span className="hidden text-[10px] text-ui-subtle sm:block">{item.permission}</span>}
            </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CommandPaletteTrigger() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))}
      className="flex h-9 shrink-0 items-center gap-1 rounded-xl border border-ui-border bg-ui-surface px-2.5 text-xs font-semibold text-ui-muted transition hover:bg-ui-page-alt hover:text-ui-text"
      aria-label={ar ? 'فتح البحث السريع' : 'Open command search'}
      title={ar ? 'بحث سريع (Ctrl+K)' : 'Quick search (Ctrl+K)'}
    >
      <Search className="h-4 w-4" />
      <span className="hidden xl:inline">{ar ? 'بحث' : 'Search'}</span>
      <kbd className="hidden rounded border border-ui-border bg-ui-page-alt px-1.5 py-0.5 text-[10px] text-ui-subtle 2xl:inline">Ctrl K</kbd>
    </button>
  );
}
