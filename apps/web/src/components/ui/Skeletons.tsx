/**
 * Loading skeletons.
 *
 * The rule this file exists to enforce: a screen that is waiting must show the
 * *shape* of what is coming, not a spinner and not the words "Loading…". A
 * placeholder that matches the final layout means nothing jumps when the data
 * lands, and the user can start reading the page structure immediately —
 * against a hosted database 200-400ms away, that is the difference between an
 * app that feels instant and one that feels broken.
 *
 * Each skeleton mirrors a real composition used elsewhere in the app, so they
 * stay accurate: `TableCardSkeleton` matches `ResourceList`, `StatRowSkeleton`
 * matches `StatGrid`, and so on.
 *
 * Accessibility: containers carry `aria-busy` and a label, and the bars
 * themselves are `aria-hidden` so a screen reader announces "loading" once
 * rather than reading out forty empty boxes.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card } from './index';

/** One shimmering bar. The `skeleton` class carries the animation. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />;
}

/** Wraps a skeleton tree so assistive tech announces a single busy region. */
export function SkeletonRegion({
  label = 'Loading',
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {children}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

/**
 * Several lines of body text.
 *
 * The last line is deliberately shorter — uniform bars read as a UI glitch,
 * whereas a ragged final line reads as a paragraph.
 */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  );
}

/** Matches `StatCard`'s internal layout. */
export function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-4 shadow-sm">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-20" />
      <Skeleton className="mt-2 h-3 w-28" />
    </div>
  );
}

/** A row of KPI tiles, laid out on the same auto-fit grid as `StatGrid`. */
export function StatRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <SkeletonRegion label="Loading statistics">
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 13rem), 1fr))' }}
      >
        {Array.from({ length: count }, (_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    </SkeletonRegion>
  );
}

/**
 * Table body placeholder.
 *
 * Column widths vary rather than being equal thirds, because a real table's
 * columns never are — a uniform grid is the tell that makes a skeleton look
 * like a broken layout instead of pending content.
 */
export function TableSkeleton({
  columns = 5,
  rows = 6,
  header = true,
}: {
  columns?: number;
  rows?: number;
  header?: boolean;
}) {
  const widths = ['w-2/3', 'w-1/2', 'w-3/4', 'w-1/3', 'w-2/5', 'w-1/2', 'w-3/5'];

  return (
    <SkeletonRegion label="Loading table" className="px-3 py-2 sm:px-4">
      {header && (
        <div className="flex gap-3 border-b border-hairline pb-2.5">
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} className="flex-1">
              <Skeleton className={cn('h-2.5', widths[c % widths.length])} />
            </div>
          ))}
        </div>
      )}
      <div className="divide-y divide-hairline">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-3 py-3">
            {Array.from({ length: columns }, (_, c) => (
              <div key={c} className="flex-1">
                <Skeleton className={cn('h-3.5', widths[(r + c) % widths.length])} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** A full list screen: header, filter bar and table, inside a card. */
export function TableCardSkeleton({
  columns = 5,
  rows = 6,
  withHeader = true,
}: {
  columns?: number;
  rows?: number;
  withHeader?: boolean;
}) {
  return (
    <>
      {withHeader && <PageHeaderSkeleton />}
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-hairline p-3 sm:p-4">
          <Skeleton className="h-9 min-w-[220px] flex-1 rounded-lg" />
          <Skeleton className="h-9 w-40 rounded-lg" />
        </div>
        <TableSkeleton columns={columns} rows={rows} header={false} />
      </Card>
    </>
  );
}

export function PageHeaderSkeleton({ withActions = true }: { withActions?: boolean }) {
  return (
    <SkeletonRegion label="Loading page" className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <Skeleton className="h-7 w-56 max-w-full" />
        <Skeleton className="mt-2 h-3.5 w-80 max-w-full" />
      </div>
      {withActions && <Skeleton className="h-9 w-32 shrink-0 rounded-lg" />}
    </SkeletonRegion>
  );
}

/** Card with a title bar and body lines — for a panel of prose or key/values. */
export function CardSkeleton({
  lines = 4,
  title = true,
  className,
}: {
  lines?: number;
  title?: boolean;
  className?: string;
}) {
  return (
    <Card className={className}>
      {title && (
        <div className="border-b border-hairline px-5 py-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-56" />
        </div>
      )}
      <div className="p-5">
        <SkeletonText lines={lines} />
      </div>
    </Card>
  );
}

/** Repeating avatar + two-line rows, for feeds, fleets and message lists. */
export function ListSkeleton({
  rows = 5,
  avatar = true,
  className,
}: {
  rows?: number;
  avatar?: boolean;
  className?: string;
}) {
  return (
    <SkeletonRegion label="Loading list" className={cn('divide-y divide-hairline', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3">
          {avatar && <Skeleton className="h-9 w-9 shrink-0 rounded-full" />}
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-5 w-16 shrink-0 rounded-md" />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/**
 * Chart placeholder drawn as bars of varying height.
 *
 * A flat grey rectangle where a chart will appear reads as a rendering
 * failure; a rough silhouette of bars reads as a chart on its way.
 */
export function ChartSkeleton({ height = 240, bars = 12 }: { height?: number; bars?: number }) {
  // Fixed pseudo-random heights: a real `Math.random()` would reshuffle on
  // every re-render and make the placeholder flicker.
  const heights = [45, 70, 55, 85, 40, 65, 90, 50, 75, 60, 80, 35, 68, 52];

  return (
    <SkeletonRegion label="Loading chart" className="p-5">
      <div className="flex items-end gap-2" style={{ height }}>
        {Array.from({ length: bars }, (_, i) => (
          <div key={i} className="flex-1" style={{ height: `${heights[i % heights.length]}%` }}>
            <Skeleton className="h-full w-full rounded-t" />
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
      </div>
    </SkeletonRegion>
  );
}

/** Map placeholder — a tinted panel with a pin silhouette. */
export function MapSkeleton({ height = 520 }: { height?: number }) {
  return (
    <SkeletonRegion label="Loading map">
      <div
        className="relative w-full overflow-hidden rounded-lg bg-surface-sunken"
        style={{ height }}
      >
        <div className="grid-texture absolute inset-0 opacity-60" aria-hidden="true" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** Form placeholder — label + control pairs on the two-column grid. */
export function FormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <SkeletonRegion label="Loading form" className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className={i % 3 === 2 ? 'sm:col-span-2' : ''}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-1.5 h-9 w-full rounded-lg" />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/**
 * Whole-page fallback, used as the Suspense boundary for every lazy route.
 *
 * Replaces a bare centred spinner: on a slow connection the chunk fetch is the
 * longest wait in the app, and a spinner there makes the whole product feel
 * sluggish even when the data is fast.
 */
export function PageSkeleton() {
  return (
    <>
      <PageHeaderSkeleton />
      <StatRowSkeleton />
      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-3 border-b border-hairline p-3 sm:p-4">
          <Skeleton className="h-9 min-w-[220px] flex-1 rounded-lg" />
          <Skeleton className="h-9 w-40 rounded-lg" />
        </div>
        <TableSkeleton columns={5} rows={6} header={false} />
      </Card>
    </>
  );
}

/** Detail-screen fallback: profile header beside a two-column body. */
export function DetailSkeleton() {
  return (
    <SkeletonRegion label="Loading details">
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-4 p-5">
          <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-3.5 w-72 max-w-full" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-9 w-28 shrink-0 rounded-lg" />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <CardSkeleton className="lg:col-span-2" lines={6} />
        <div className="space-y-4">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </div>
      </div>
    </SkeletonRegion>
  );
}
