import { type HTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { useEmbeddedCenterPage } from '@/components/design/EmbeddedCenterPage';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
}

export function PageHeader({ title, subtitle, actions, breadcrumbs }: PageHeaderProps) {
  const embedded = useEmbeddedCenterPage();
  if (embedded) return actions ? <div data-testid="page-actions" className="flex min-w-0 flex-wrap items-center gap-2 py-2">{actions}</div> : null;
  return (
    <div data-testid="page-header" className="mb-5 grid min-w-0 grid-cols-1 items-center gap-x-5 gap-y-3 sm:min-h-16 sm:grid-cols-[minmax(0,1fr)_minmax(0,auto)]">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav data-testid="page-breadcrumbs" aria-label="Breadcrumbs" className="mb-1 flex flex-wrap items-center gap-1 text-xs">
            {breadcrumbs.map((crumb, i) => {
              const last = i === breadcrumbs.length - 1;
              return (
                <span key={crumb.label + i} className="flex items-center gap-1">
                  {crumb.href && !last ? (
                    <Link to={crumb.href} className="font-medium text-ui-subtle hover:text-ui-primary">{crumb.label}</Link>
                  ) : (
                    <span className={clsx(last ? 'font-semibold text-ui-muted' : 'text-ui-subtle')}>{crumb.label}</span>
                  )}
                  {!last && <ChevronRight className="h-3 w-3 text-ui-subtle [dir='rtl']:rotate-180" />}
                </span>
              );
            })}
          </nav>
        )}
        {subtitle && <p data-testid="page-description" className="mb-0.5 text-[13px] font-medium leading-5 text-ui-muted">{subtitle}</p>}
        <h1 data-testid="page-title" className="text-[clamp(1.65rem,2.4vw,2.25rem)] font-semibold leading-[1.08] tracking-[-0.022em] text-ui-text">{title}</h1>
      </div>
      {actions && (
        <div
          data-testid="page-actions"
          className="flex min-w-0 max-w-full flex-wrap items-center justify-start gap-2 sm:justify-end sm:flex-nowrap sm:overflow-x-auto sm:overscroll-x-contain sm:[scrollbar-width:none] sm:[&::-webkit-scrollbar]:hidden"
        >
          {actions}
        </div>
      )}
    </div>
  );
}

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = '', ...rest }: CardProps) {
  return (
    <div
      className={clsx(
        'rounded-[22px] border border-ui-border bg-ui-surface shadow-ui transition-all duration-150',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  icon: ReactNode;
  color?: string;
  trend?: string;
}

export function StatCard({ title, value, icon, color = 'navy', trend }: StatCardProps) {
  const colorMap: Record<string, { bg: string; icon: string; badge: string; accent: string }> = {
    navy: { bg: 'bg-ui-page-alt', icon: 'text-ui-muted', badge: 'bg-ui-page-alt text-ui-muted', accent: 'ui-accent-neutral' },
    gold: { bg: 'bg-ui-warning-soft', icon: 'text-ui-warning', badge: 'bg-ui-warning-soft text-ui-warning', accent: 'ui-accent-purchase' },
    brand: { bg: 'bg-ui-primary-soft', icon: 'text-ui-primary', badge: 'bg-ui-primary-soft text-ui-primary', accent: 'ui-accent-primary' },
    blue: { bg: 'bg-ui-info-soft', icon: 'text-ui-info', badge: 'bg-ui-info-soft text-ui-info', accent: 'ui-accent-primary' },
    amber: { bg: 'bg-ui-warning-soft', icon: 'text-ui-warning', badge: 'bg-ui-warning-soft text-ui-warning', accent: 'ui-accent-purchase' },
    red: { bg: 'bg-ui-danger-soft', icon: 'text-ui-danger', badge: 'bg-ui-danger-soft text-ui-danger', accent: 'ui-accent-alert' },
    purple: { bg: 'bg-ui-primary-soft', icon: 'text-ui-primary', badge: 'bg-ui-primary-soft text-ui-primary', accent: 'ui-accent-finance' },
    green: { bg: 'bg-ui-success-soft', icon: 'text-ui-success', badge: 'bg-ui-success-soft text-ui-success', accent: 'ui-accent-inventory' },
  };

  const c = colorMap[color] || colorMap.navy;

  return (
    <Card className={clsx('p-5 hover:shadow-ui-md transition-all duration-200', c.accent)}>
      <div className="flex items-center gap-2.5">
        <div className={clsx('w-8 h-8 rounded-full flex items-center justify-center shrink-0', c.bg, c.icon)}>
          {icon}
        </div>
        <p className="text-[13px] font-medium text-ui-muted truncate">{title}</p>
      </div>
      <div className="mt-3.5 flex flex-wrap items-baseline gap-2.5">
        <p className="text-[26px] font-bold leading-none tracking-[-0.02em] text-ui-text tabular-nums">{value}</p>
        {trend && <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold', c.badge)}>{trend}</span>}
      </div>
    </Card>
  );
}
