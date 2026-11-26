import { useId, type ReactNode } from 'react';
import clsx from 'clsx';

export type IndicatorTone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

const TONE_COLOR: Record<IndicatorTone, string> = {
  primary: 'rgb(var(--ui-primary))',
  success: 'rgb(var(--ui-success))',
  warning: 'rgb(var(--ui-warning))',
  danger: 'rgb(var(--ui-danger))',
  info: 'rgb(var(--ui-info))',
  muted: 'rgb(var(--ui-subtle))',
};

/**
 * Compact Premier inline SVG sparkline with soft gradient fill and terminal dot.
 */
export function WorkspaceSparkline({
  values,
  tone = 'primary',
  height = 28,
  width = 88,
  className = '',
  showDot = true,
}: {
  values: number[];
  tone?: IndicatorTone;
  height?: number;
  width?: number;
  className?: string;
  showDot?: boolean;
}) {
  const gradId = useId();
  const safe = values.length >= 2 ? values : [0, ...values, values[0] ?? 0];
  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const span = max - min || 1;
  const pad = 3;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const pts = safe.map((val, idx) => {
    const x = pad + (idx / Math.max(1, safe.length - 1)) * innerW;
    const y = pad + innerH - ((val - min) / span) * innerH;
    return [Number(x.toFixed(1)), Number(y.toFixed(1))] as const;
  });

  const linePath = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
  const areaPath = `${linePath} L${pts[pts.length - 1][0]},${height} L${pts[0][0]},${height} Z`;
  const stroke = TONE_COLOR[tone];
  const last = pts[pts.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={clsx('shrink-0 overflow-visible', className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {showDot && <circle cx={last[0]} cy={last[1]} r="2.4" fill={stroke} />}
    </svg>
  );
}

/**
 * Animated Premier horizontal capacity / proportion meter with optional threshold tick.
 */
export function WorkspaceMeter({
  value,
  max = 100,
  tone = 'primary',
  thresholdPct,
  height = 'sm',
  className = '',
}: {
  value: number;
  max?: number;
  tone?: IndicatorTone;
  thresholdPct?: number;
  height?: 'xs' | 'sm' | 'md';
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const hClass = height === 'xs' ? 'h-1.5' : height === 'md' ? 'h-2.5' : 'h-2';
  return (
    <div className={clsx('relative w-full overflow-hidden rounded-full bg-ui-page-alt', hClass, className)}>
      <div
        className="premier-refresh-meter-fill h-full rounded-full transition-all duration-500 ease-[var(--ui-ease)]"
        style={{ width: `${pct.toFixed(1)}%`, backgroundColor: TONE_COLOR[tone] }}
      />
      {typeof thresholdPct === 'number' && thresholdPct > 0 && thresholdPct < 100 && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-0.5 bg-ui-text/45"
          style={{ insetInlineStart: `${thresholdPct}%` }}
        />
      )}
    </div>
  );
}

/**
 * Circular SVG donut percentage ring matching Premier KPI and supplier cards.
 */
export function WorkspaceDonut({
  percent,
  size = 44,
  strokeWidth = 4.5,
  tone = 'primary',
  label,
  className = '',
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
  tone?: IndicatorTone;
  label?: ReactNode;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (clamped / 100) * circ;

  return (
    <div className={clsx('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgb(var(--ui-border))"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={TONE_COLOR[tone]}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className="transition-all duration-500 ease-[var(--ui-ease)]"
        />
      </svg>
      {label !== undefined && (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-ui-text tabular-nums">
          {label}
        </span>
      )}
    </div>
  );
}

/**
 * Subtle pulsing live status indicator dot.
 */
export function WorkspaceLiveDot({ tone = 'success', className = '' }: { tone?: IndicatorTone; className?: string }) {
  return (
    <span className={clsx('relative inline-flex h-2 w-2 shrink-0', className)} aria-hidden="true">
      <span
        className="premier-refresh-live-ping absolute inline-flex h-full w-full rounded-full opacity-60"
        style={{ backgroundColor: TONE_COLOR[tone] }}
      />
      <span
        className="relative inline-flex h-2 w-2 rounded-full"
        style={{ backgroundColor: TONE_COLOR[tone] }}
      />
    </span>
  );
}
