import { NavLink } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import type { LucideIcon } from 'lucide-react';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';
import { moduleForPath } from '@/core/modules/module.config';

export type CenterTileItem = {
  id: string;
  accent?: 'primary' | 'purchase' | 'inventory' | 'finance' | 'alert' | 'system' | 'neutral';
  labelKey?: string;
  ar?: string;
  en?: string;
  descriptionAr?: string;
  descriptionEn?: string;
  route: string;
  permission?: boolean;
  icon: LucideIcon;
  badge?: string;
};

type CenterTileProps = {
  item: CenterTileItem;
  testIdPrefix: string;
};

/** Compact navigation tab: every center opens its pages by clicking the top row. */
export function CenterTile({ item, testIdPrefix }: CenterTileProps) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const Icon = item.icon;
  const label = (ar ? item.ar ?? item.en : item.en ?? item.ar) || item.id;
  const description = ar ? item.descriptionAr : item.descriptionEn;

  return (
    <NavLink
      data-testid={`${testIdPrefix}-${item.id}`}
      to={item.route}
      title={description || label}
      className={({ isActive }) =>
        `inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-ring ${isActive
          ? 'border-ui-primary bg-ui-primary-soft text-ui-primary'
          : 'border-ui-border bg-ui-surface text-ui-text hover:border-ui-primary hover:bg-ui-page-alt'}`
      }
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span>{label}</span>
      {item.badge && <span className="rounded-full bg-ui-page-alt px-2 py-0.5 text-xs">{item.badge}</span>}
    </NavLink>
  );
}

type CenterGridProps = {
  items: CenterTileItem[];
  testIdPrefix: string;
  columns?: 2 | 3 | 4;
};

/** Retain the existing component API so every center gets the same tab row. */
export function CenterGrid({ items, testIdPrefix }: CenterGridProps) {
  const { canAccessModule } = useOrganizationModules();
  const { lang } = useLanguage();
  const visibleItems = items.filter(
    item => item.permission !== false && canAccessModule(moduleForPath(item.route)),
  );

  return (
    <nav
      aria-label={lang === 'ar' ? 'صفحات المركز' : 'Center pages'}
      data-testid={`${testIdPrefix}-navigation`}
      className="w-full rounded-2xl border border-ui-border bg-ui-surface p-2 shadow-ui-sm"
    >
      <div className="flex w-full flex-nowrap items-center gap-2 overflow-x-auto pb-1">
        {visibleItems.map(item => (
          <CenterTile key={item.id} item={item} testIdPrefix={testIdPrefix} />
        ))}
      </div>
      {visibleItems.length === 0 && (
        <p className="px-3 py-2 text-sm text-ui-muted">
          {lang === 'ar' ? 'لا توجد صفحات متاحة لصلاحياتك الحالية' : 'No pages available with your current permissions'}
        </p>
      )}
    </nav>
  );
}
