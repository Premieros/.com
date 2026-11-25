import { Area, AreaChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export type DashboardSalesPoint = {
  label: string;
  sales: number;
  previous: number;
};

export function DashboardSalesChart({
  data,
  formatValue,
  compare,
  labels,
}: {
  data: DashboardSalesPoint[];
  formatValue: (value: number) => string;
  compare: boolean;
  labels: { current: string; previous: string };
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        {compare && <Legend />}
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip formatter={(value) => formatValue(Number(value || 0))} />
        <Area
          type="monotone"
          dataKey="sales"
          name={labels.current}
          isAnimationActive={false}
          stroke="currentColor"
          fill="currentColor"
          fillOpacity={0.12}
        />
        {compare && (
          <Area type="monotone" dataKey="previous" name={labels.previous}
            stroke="rgb(var(--ui-muted))" strokeDasharray="5 4" fill="none" isAnimationActive={false} />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
