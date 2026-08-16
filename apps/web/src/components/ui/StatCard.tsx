import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TrendingUp, TrendingDown, Minus, ArrowUpRight } from 'lucide-react';
import { cn, formatCompactCurrency, formatNumber } from '@/lib/utils';
import { Skeleton } from './index';

export interface Stat {
  key: string;
  label: string;
  value: number | string;
  delta?: number;
  trend?: 'up' | 'down' | 'flat';
  format?: 'number' | 'currency' | 'percent' | 'text';
  hint?: string;
  /** Optional history for the inline sparkline. */
  series?: number[];
}

/**
 * Count up to the target value on mount.
 *
 * Numbers that animate into place read as "live" rather than static, which is
 * the single cheapest way to make a dashboard feel responsive. Respects
 * `prefers-reduced-motion` by jumping straight to the final value.
 */
function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number>();

  useEffect(() => {
    if (!Number.isFinite(target)) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || target === 0) {
      setValue(target);
      return;
    }

    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      // Ease-out cubic: fast at first, settling gently on the final figure.
      const eased = 1 - (1 - progress) ** 3;
      setValue(target * eased);

      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
      else setValue(target);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, durationMs]);

  return value;
}

function formatValue(value: number, format: Stat['format']): string {
  switch (format) {
    case 'currency':
      return formatCompactCurrency(value);
    case 'percent':
      return `${Math.round(value)}%`;
    case 'number':
      return formatNumber(Math.round(value));
    default:
      return String(Math.round(value));
  }
}

/** Inline sparkline drawn as a single SVG path — no chart library needed. */
function Sparkline({ points, tone }: { points: number[]; tone: string }) {
  if (points.length < 2) return null;

  const width = 72;
  const height = 24;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      // SVG y grows downward, so invert.
      const y = height - ((point - min) / range) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.75}
        strokeLinecap="round" strokeLinejoin="round" className={tone} opacity={0.85} />
    </svg>
  );
}

const ACCENTS = {
  brand: {
    ring: 'ring-brand-500/25',
    glow: 'from-brand-500/[0.10]',
    icon: 'bg-brand-500/12 text-brand-600',
    spark: 'text-brand-500',
  },
  success: {
    ring: 'ring-success/25',
    glow: 'from-success/[0.10]',
    icon: 'bg-success/12 text-success',
    spark: 'text-success',
  },
  warning: {
    ring: 'ring-warning/25',
    glow: 'from-warning/[0.12]',
    icon: 'bg-warning/12 text-warning',
    spark: 'text-warning',
  },
  danger: {
    ring: 'ring-danger/30',
    glow: 'from-danger/[0.14]',
    icon: 'bg-danger/12 text-danger',
    spark: 'text-danger',
  },
  neutral: {
    ring: 'ring-transparent',
    glow: 'from-transparent',
    icon: 'bg-surface-sunken text-ink-subtle',
    spark: 'text-brand-500',
  },
} as const;

export function StatCard({
  stat,
  icon,
  accent = 'neutral',
  onClick,
  index = 0,
}: {
  stat: Stat;
  icon?: ReactNode;
  accent?: keyof typeof ACCENTS;
  onClick?: () => void;
  /** Stagger position, so a row of tiles reveals in sequence. */
  index?: number;
}) {
  const numeric = typeof stat.value === 'number' ? stat.value : Number.NaN;
  const animated = useCountUp(numeric);
  const display = Number.isFinite(numeric)
    ? formatValue(animated, stat.format)
    : String(stat.value);

  const TrendIcon =
    stat.trend === 'up' ? TrendingUp : stat.trend === 'down' ? TrendingDown : Minus;

  // A rising number is not automatically good — "fees outstanding" going up is
  // bad. Callers set `trend` to the sentiment, not the raw direction.
  const trendClass =
    stat.trend === 'up' ? 'text-success' : stat.trend === 'down' ? 'text-danger' : 'text-ink-subtle';

  const palette = ACCENTS[accent];
  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      style={{ animationDelay: `${index * 60}ms` }}
      className={cn(
        'group relative w-full overflow-hidden rounded-xl border border-hairline bg-surface p-4 text-left',
        'shadow-sm ring-1 animate-slide-up [animation-fill-mode:backwards]',
        palette.ring,
        onClick && 'card-interactive cursor-pointer hover:border-brand-500/40',
      )}
    >
      {/* Corner wash — carries the accent without tinting the whole tile. */}
      <div
        className={cn(
          'pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br to-transparent blur-2xl',
          palette.glow,
        )}
        aria-hidden="true"
      />

      <div className="relative flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{stat.label}</p>
        {icon && (
          <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-110', palette.icon)}>
            {icon}
          </span>
        )}
      </div>

      <div className="relative mt-2 flex items-end justify-between gap-3">
        <p className="text-2xl font-semibold tracking-tight text-ink nums">{display}</p>
        {stat.series && stat.series.length > 1 && (
          <Sparkline points={stat.series} tone={palette.spark} />
        )}
      </div>

      <div className="relative mt-1 flex items-center gap-2">
        {stat.delta !== undefined && (
          <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium nums', trendClass)}>
            <TrendIcon className="h-3 w-3" aria-hidden="true" />
            {Math.abs(stat.delta)}%
          </span>
        )}
        {stat.hint && <span className="truncate text-xs text-ink-subtle">{stat.hint}</span>}
        {onClick && (
          <ArrowUpRight
            className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-subtle opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        )}
      </div>
    </Wrapper>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-4 shadow-sm">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-20" />
      <Skeleton className="mt-2 h-3 w-28" />
    </div>
  );
}

/**
 * Responsive grid for KPI tiles.
 *
 * `auto-fit` with a minimum track width rather than fixed column counts: tiles
 * reflow to whatever the container can fit, so the same grid works in a full
 * page and inside a narrow card without breakpoint juggling.
 */
export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 13rem), 1fr))' }}
    >
      {children}
    </div>
  );
}
