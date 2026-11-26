import type { ReportFilters } from './reportFilters';
import type { ReportSortDirection } from './reportTablePresentation';

export type ReportReturnView = {
  from: string;
  to: string;
  filters: ReportFilters;
  search: string;
  sort: string | null;
  sortDirection: ReportSortDirection;
  page: number;
  pageSize: number;
  scrollY: number;
};
const savedViews = new Map<string, ReportReturnView>();

export function stashReportReturnView(key: string, view: ReportReturnView) {
  savedViews.delete(key);
  savedViews.set(key, view);
  if (savedViews.size > 20) savedViews.delete(savedViews.keys().next().value!);
}

export function takeReportReturnView(key: string) {
  return savedViews.get(key);
}
