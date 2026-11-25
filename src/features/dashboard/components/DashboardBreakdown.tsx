import { Link } from 'react-router-dom';

type DashboardBreakdownProps = {
  rows: Array<{ key: string; label: string; value: number; href?: string }>;
  formatValue: (value: number) => string;
};

export function DashboardBreakdown({ rows, formatValue }: DashboardBreakdownProps) {
  const max = Math.max(1, ...rows.map(({ value }) => Math.abs(value)));
  return (
    <ul className="space-y-4">
      {rows.map(({ key, label, value, href }) => (
        <li key={key} className="space-y-1.5">
          <div className="flex justify-between gap-3 text-sm">
            {href
              ? <Link className="font-semibold text-ui-primary underline-offset-2 hover:underline" to={href}>{label}</Link>
              : <span className="font-semibold text-ui-text">{label}</span>}
            <span className="tabular-nums text-ui-muted">{formatValue(value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ui-page-alt" aria-hidden="true">
            <div className="h-full rounded-full bg-ui-primary" style={{ width: `${Math.abs(value) / max * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
