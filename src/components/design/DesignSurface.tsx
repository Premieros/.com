import { WorkspaceControls, WorkspaceToolbarTarget } from '@/components/WorkspaceToolbar';
import { useContext, type ReactNode } from 'react';
import clsx from 'clsx';
import { PageHeader, type BreadcrumbItem } from '@/components/PageHeader';

export type DesignBreadcrumb = BreadcrumbItem;

export function DesignSurface({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId: string;
}) {
  return (
    <section data-testid={testId} className={clsx('min-w-0 space-y-2', className)}>
      {children}
    </section>
  );
}

// Delegates to the canonical 6D page-header surface (PageHeader) so there is a
// single implementation while the design package keeps its own stable API.
export function DesignPageHeader({
  title,
  subtitle,
  description,
  actions,
  breadcrumbs,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: DesignBreadcrumb[];
}) {
  return <PageHeader title={title} subtitle={subtitle ?? description} actions={actions} breadcrumbs={breadcrumbs} />;
}

export function DesignFilterBar({ children }: { children: ReactNode }) {
  const toolbar = useContext(WorkspaceToolbarTarget);
  if (toolbar !== undefined) return <WorkspaceControls>{children}</WorkspaceControls>;
  return (
    <div data-testid="design-filter-bar" className="ui-accent-card ui-accent-system flex min-h-11 min-w-0 flex-wrap items-center justify-start gap-2 rounded-[20px] border border-ui-border bg-ui-surface px-4 py-2.5 shadow-ui-sm">
      {children}
    </div>
  );
}
