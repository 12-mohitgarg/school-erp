/**
 * Chart wrappers.
 *
 * One place defines the palette, grid, axis and tooltip treatment so every
 * chart in the app reads as part of the same system. Colours are chosen to stay
 * distinguishable in both themes and to remain separable for the most common
 * forms of colour blindness (no red/green-only pairings).
 */

import type { ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardHeader, EmptyState } from '@/components/ui';

/** Categorical palette — ordered by how distinct the first few are from each other. */
export const SERIES_COLORS = [
  '#6366F1', // indigo
  '#0EA5E9', // sky
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EC4899', // pink
  '#8B5CF6', // violet
  '#14B8A6', // teal
  '#EF4444', // red
];

const AXIS = {
  stroke: 'rgb(148 163 184)',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
};

interface TooltipPayload {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  formatter?: (value: number) => string;
}

/** Themed tooltip — Recharts' default is a white box that breaks in dark mode. */
function ChartTooltip({ active, payload, label, formatter }: TooltipPayload) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-hairline bg-surface px-3 py-2 shadow-lg">
      {label && <p className="mb-1 text-xs font-medium text-ink">{label}</p>}
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-xs">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: entry.color }}
            aria-hidden="true"
          />
          <span className="text-ink-muted">{entry.name}</span>
          <span className="ml-auto font-medium text-ink nums">
            {formatter ? formatter(entry.value) : entry.value.toLocaleString('en-IN')}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChartFrame({
  title,
  description,
  action,
  hasData,
  children,
  height = 260,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  hasData: boolean;
  children: ReactNode;
  height?: number;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} action={action} />
      <div className="p-3">
        {hasData ? (
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              {children as never}
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState title="No data for this period" />
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export interface SeriesPoint {
  label: string;
  [key: string]: string | number;
}

export function TrendChart({
  title,
  description,
  data,
  series,
  height,
  valueFormatter,
  action,
}: {
  title: string;
  description?: string;
  data: SeriesPoint[];
  series: Array<{ key: string; name: string; color?: string }>;
  height?: number;
  valueFormatter?: (value: number) => string;
  action?: ReactNode;
}) {
  return (
    <ChartFrame title={title} description={description} action={action} hasData={data.length > 0} height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color ?? SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0.28} />
              <stop offset="100%" stopColor={s.color ?? SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184)" strokeOpacity={0.15} vertical={false} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis {...AXIS} width={52} />
        <Tooltip content={<ChartTooltip formatter={valueFormatter} />} />
        {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color ?? SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={2}
            fill={`url(#grad-${s.key})`}
            // Dots on a dense series become visual noise; show them on hover only.
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2 }}
          />
        ))}
      </AreaChart>
    </ChartFrame>
  );
}

export function ComparisonChart({
  title,
  description,
  data,
  series,
  height,
  valueFormatter,
  stacked,
  horizontal,
}: {
  title: string;
  description?: string;
  data: SeriesPoint[];
  series: Array<{ key: string; name: string; color?: string }>;
  height?: number;
  valueFormatter?: (value: number) => string;
  stacked?: boolean;
  horizontal?: boolean;
}) {
  return (
    <ChartFrame title={title} description={description} hasData={data.length > 0} height={height}>
      <BarChart
        data={data}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 8, left: horizontal ? 8 : -16, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184)" strokeOpacity={0.15} vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...AXIS} />
            <YAxis type="category" dataKey="label" {...AXIS} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" {...AXIS} />
            <YAxis {...AXIS} width={52} />
          </>
        )}
        <Tooltip content={<ChartTooltip formatter={valueFormatter} />} cursor={{ fill: 'rgb(148 163 184)', fillOpacity: 0.06 }} />
        {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stackId={stacked ? 'stack' : undefined}
            fill={s.color ?? SERIES_COLORS[i % SERIES_COLORS.length]}
            radius={stacked ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={44}
          />
        ))}
      </BarChart>
    </ChartFrame>
  );
}

export function DistributionChart({
  title,
  description,
  data,
  height = 260,
  valueFormatter,
}: {
  title: string;
  description?: string;
  data: Array<{ label: string; value: number; color?: string }>;
  height?: number;
  valueFormatter?: (value: number) => string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <ChartFrame title={title} description={description} hasData={total > 0} height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          cx="50%"
          cy="50%"
          // A donut reads proportions better than a full pie and leaves room
          // for a centre label.
          innerRadius="55%"
          outerRadius="80%"
          paddingAngle={2}
          strokeWidth={0}
        >
          {data.map((entry, i) => (
            <Cell key={entry.label} fill={entry.color ?? SERIES_COLORS[i % SERIES_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<ChartTooltip formatter={valueFormatter} />} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ChartFrame>
  );
}

export function SparkLine({
  data,
  color = SERIES_COLORS[0]!,
  height = 40,
}: {
  data: Array<{ value: number }>;
  color?: string;
  height?: number;
}) {
  if (data.length === 0) return null;

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.75} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
