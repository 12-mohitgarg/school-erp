/**
 * Scheduler — what runs in the background, why, and how it went.
 *
 * The client asked what the schedulers relate to. This screen is the answer in
 * the product rather than in a document: every job states the PRD clause it
 * satisfies, its cadence, when it last ran, what it touched, and whether it
 * failed. Anything that can be triggered by hand has a "Run now", so a fix can
 * be verified without waiting six hours for the next tick.
 */

import { useState } from 'react';
import {
  Clock, Play, CheckCircle2, XCircle, AlertTriangle, MinusCircle, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useSchedulerQuery, useRunJobMutation, type SchedulerJob } from '@/features/api/endpoints';
import { useAuth } from '@/features/auth/useAuth';
import {
  Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader,
} from '@/components/ui';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { StatRowSkeleton, ListSkeleton, SkeletonRegion, Skeleton } from '@/components/ui/Skeletons';
import { errorMessage } from '@/lib/api';
import { cn, formatDateTime, relativeTime } from '@/lib/utils';

/** `21600000` reads as noise; `every 6 hours` reads as a schedule. */
function formatInterval(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `every ${minutes} minute${minutes === 1 ? '' : 's'}`;

  const hours = minutes / 60;
  if (hours < 24) return `every ${hours} hour${hours === 1 ? '' : 's'}`;

  const days = hours / 24;
  return `every ${days} day${days === 1 ? '' : 's'}`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

const STATUS_STYLE: Record<string, { tone: string; Icon: typeof CheckCircle2; label: string }> = {
  SUCCESS: { tone: 'text-success bg-success/10', Icon: CheckCircle2, label: 'Succeeded' },
  FAILED: { tone: 'text-danger bg-danger/10', Icon: XCircle, label: 'Failed' },
  RUNNING: { tone: 'text-info bg-info/10', Icon: RefreshCw, label: 'Running' },
  SKIPPED: { tone: 'text-ink-subtle bg-surface-sunken', Icon: MinusCircle, label: 'Skipped' },
};

export default function SchedulerPage() {
  const { can } = useAuth();
  // Poll while the page is open: a manual run and the timer both change what
  // is on screen, and a stale scheduler view is actively misleading.
  const { data, isLoading, refetch, isFetching } = useSchedulerQuery(undefined, {
    pollingInterval: 60_000,
  });

  const canRun = can('settings:update');

  if (isLoading) {
    return (
      <>
        <PageHeader title="Scheduler" description="Background jobs and their run history" />
        <StatRowSkeleton count={3} />
        <Card className="mt-4">
          <ListSkeleton rows={6} avatar={false} />
        </Card>
      </>
    );
  }

  const jobs = data?.jobs ?? [];
  const failing = jobs.filter((j) => j.lastRun?.status === 'FAILED' || j.failures24h > 0);
  const neverRun = jobs.filter((j) => !j.lastRun);

  return (
    <>
      <PageHeader
        title="Scheduler"
        description="Every background job, the PRD clause it satisfies, and how its last run went."
        actions={
          <Button
            size="sm"
            variant="outline"
            loading={isFetching}
            onClick={() => void refetch()}
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Refresh
          </Button>
        }
      />

      <StatGrid>
        <StatCard
          index={0}
          accent="brand"
          icon={<Clock className="h-3.5 w-3.5" />}
          stat={{ key: 'jobs', label: 'Scheduled jobs', value: jobs.length, format: 'number' }}
        />
        <StatCard
          index={1}
          accent={failing.length > 0 ? 'danger' : 'success'}
          icon={failing.length > 0 ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          stat={{
            key: 'failing',
            label: 'Failing',
            value: failing.length,
            format: 'number',
            hint: failing.length > 0 ? 'In the last 24 hours' : 'All healthy',
          }}
        />
        <StatCard
          index={2}
          accent={neverRun.length > 0 ? 'warning' : 'neutral'}
          stat={{
            key: 'pending',
            label: 'Not yet run',
            value: neverRun.length,
            format: 'number',
            hint: neverRun.length > 0 ? 'First tick is staggered after boot' : 'All have run',
          }}
        />
      </StatGrid>

      {failing.length > 0 && (
        <Alert tone="danger" title="Some jobs are failing" className="mt-4">
          {failing.map((j) => j.label).join(', ')} — see the error on each card below.
        </Alert>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {jobs.map((job, index) => (
          <JobCard key={job.name} job={job} index={index} canRun={canRun} />
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Recent runs"
          description="The last 40 executions across every job"
        />
        {(data?.recentRuns.length ?? 0) === 0 ? (
          <EmptyState
            title="No runs recorded yet"
            description="The first tick of each job is staggered for 30 seconds or more after the API starts."
          />
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left">
                  {['Job', 'Status', 'Started', 'Duration', 'Affected', 'Result'].map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {data?.recentRuns.map((run) => {
                  const style = STATUS_STYLE[run.status] ?? STATUS_STYLE['SKIPPED']!;
                  return (
                    <tr key={run.id}>
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-ink">{run.job}</span>
                        {run.manual && (
                          <Badge tone="info" className="ml-2">
                            Manual
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium',
                            style.tone,
                          )}
                        >
                          <style.Icon className="h-3 w-3" aria-hidden="true" />
                          {style.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted">
                        {relativeTime(run.startedAt)}
                      </td>
                      <td className="px-3 py-2.5 text-ink-muted nums">
                        {formatDuration(run.durationMs)}
                      </td>
                      <td className="px-3 py-2.5 text-ink nums">{run.affected}</td>
                      <td className="max-w-[280px] truncate px-3 py-2.5 text-ink-muted">
                        {run.error ?? run.summary ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------

function JobCard({
  job,
  index,
  canRun,
}: {
  job: SchedulerJob;
  index: number;
  canRun: boolean;
}) {
  const [run, { isLoading }] = useRunJobMutation();
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);

  const last = job.lastRun;
  const style = last ? (STATUS_STYLE[last.status] ?? STATUS_STYLE['SKIPPED']!) : null;
  const unhealthy = last?.status === 'FAILED' || job.failures24h > 0;

  async function trigger() {
    try {
      const outcome = await run(job.name).unwrap();

      if (outcome.status === 'FAILED') {
        toast.error(`${job.label} failed`, { description: outcome.error ?? undefined });
      } else if (outcome.status === 'SKIPPED') {
        toast.info(`${job.label} was already running`);
      } else {
        toast.success(`${job.label} finished`, {
          description: outcome.summary ?? `${outcome.affected} records affected`,
        });
      }

      setLastOutcome(outcome.summary ?? outcome.error);
    } catch (err) {
      toast.error('Could not run the job', { description: errorMessage(err) });
    }
  }

  return (
    <div
      style={{ animationDelay: `${index * 35}ms` }}
      className={cn(
        'flex flex-col rounded-xl border bg-surface p-4 shadow-sm',
        'animate-slide-up [animation-fill-mode:backwards]',
        unhealthy ? 'border-danger/40' : 'border-hairline',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{job.label}</p>
          <p className="mt-0.5 text-xs text-ink-subtle">{formatInterval(job.intervalMs)}</p>
        </div>

        {style && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium',
              style.tone,
            )}
          >
            <style.Icon className="h-3 w-3" aria-hidden="true" />
            {style.label}
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-ink-muted">{job.description}</p>

      {/* The point of this screen: the job says what it is for. */}
      <p className="mt-2 rounded-lg bg-brand-500/[0.06] px-2.5 py-1.5 text-2xs text-brand-600">
        {job.relatesTo}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-ink-subtle">Last run</dt>
        <dd className="truncate text-ink">
          {last ? relativeTime(last.startedAt) : 'Not yet'}
        </dd>

        <dt className="text-ink-subtle">Duration</dt>
        <dd className="text-ink nums">{formatDuration(last?.durationMs ?? null)}</dd>

        <dt className="text-ink-subtle">Affected</dt>
        <dd className="text-ink nums">{last?.affected ?? 0}</dd>

        <dt className="text-ink-subtle">Next tick</dt>
        <dd className="truncate text-ink">
          {job.nextRunAt ? formatDateTime(job.nextRunAt) : 'On the next interval'}
        </dd>
      </dl>

      {last?.error && (
        <p className="mt-2 rounded-lg bg-danger/5 px-2.5 py-1.5 text-2xs text-danger">
          {last.error}
        </p>
      )}

      {!last?.error && (lastOutcome ?? last?.summary) && (
        <p className="mt-2 truncate text-2xs text-ink-subtle">{lastOutcome ?? last?.summary}</p>
      )}

      {job.failures24h > 0 && (
        <p className="mt-2 inline-flex items-center gap-1 text-2xs text-warning">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          {job.failures24h} failure{job.failures24h === 1 ? '' : 's'} in the last 24 hours
        </p>
      )}

      <div className="mt-auto pt-3">
        {job.manualRunnable && canRun ? (
          <Button
            size="xs"
            variant="outline"
            loading={isLoading}
            onClick={() => void trigger()}
            leftIcon={<Play className="h-3 w-3" />}
          >
            Run now
          </Button>
        ) : (
          <p className="text-2xs text-ink-subtle">
            {job.manualRunnable ? 'Requires settings:update' : 'Runs on its timer only'}
          </p>
        )}
      </div>
    </div>
  );
}

/** Exported for the settings tab shell to reuse while the page code-splits. */
export function SchedulerSkeleton() {
  return (
    <SkeletonRegion label="Loading scheduler" className="grid gap-3 lg:grid-cols-2">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="rounded-xl border border-hairline bg-surface p-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-24" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-1.5 h-3 w-4/5" />
          <Skeleton className="mt-3 h-7 w-full rounded-lg" />
        </div>
      ))}
    </SkeletonRegion>
  );
}
