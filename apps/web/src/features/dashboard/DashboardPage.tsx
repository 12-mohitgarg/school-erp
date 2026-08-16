import { Link } from 'react-router-dom';
import {
  AlertTriangle, BadgeIndianRupee, Bus, ClipboardCheck, GraduationCap,
  Library, ShieldAlert, TrendingUp, Users, UserCog, Wallet, Clock,
  ArrowRight, Sparkles, CalendarDays, Megaphone,
} from 'lucide-react';
import { ROLE_LABELS } from '@erp/shared';
import { useAuth } from '@/features/auth/useAuth';
import {
  useDashboardQuery, useAttendanceSummaryQuery, useCollectionReportQuery,
} from '@/features/api/endpoints';
import { useAnnouncementsQuery } from '@/features/communication/communicationApi';
import { StatCard, StatCardSkeleton, StatGrid, type Stat } from '@/components/ui/StatCard';
import { TrendChart, ComparisonChart } from '@/components/charts/Charts';
import {
  Alert, Avatar, Badge, Card, CardBody, CardHeader, EmptyState,
  ErrorState, PageHeader, Skeleton, StatusBadge,
} from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { cn, formatCompactCurrency, formatDate, relativeTime } from '@/lib/utils';

/** Icon per KPI key, so tiles are recognisable at a glance across roles. */
const STAT_ICONS: Record<string, typeof Users> = {
  students: Users, staff: UserCog, attendance: ClipboardCheck,
  collected: BadgeIndianRupee, outstanding: Wallet, trips: Bus, sos: ShieldAlert,
  sections: GraduationCap, pending: ClipboardCheck, periods: Clock,
  ungraded: ClipboardCheck, titles: Library, issued: Library,
  overdue: AlertTriangle, billed: BadgeIndianRupee, month: TrendingUp,
  headcount: UserCog, present: ClipboardCheck, onLeave: CalendarDays,
  dues: Wallet, homework: ClipboardCheck, unread: Megaphone,
};

export default function DashboardPage() {
  const { user, can } = useAuth();
  const { data, isLoading, error, refetch } = useDashboardQuery();

  const canSeeAttendanceTrend = can('attendance:view');
  const canSeeFinance = can('fees:view');

  const { data: attendance } = useAttendanceSummaryQuery(
    { groupBy: 'day' },
    { skip: !canSeeAttendanceTrend },
  );
  const { data: collection } = useCollectionReportQuery({}, { skip: !canSeeFinance });
  const { data: announcements } = useAnnouncementsQuery({ limit: 4 });

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Recent attendance percentages, used as the sparkline on the attendance tile.
  const attendanceSeries = (attendance?.series ?? []).slice(-14).map((p) => p.attendancePercent);

  const sosCount = Number(data?.stats.find((s) => s.key === 'sos')?.value ?? 0);

  /** Outstanding money and open alerts going *up* is bad news, not good. */
  function withSentiment(stat: Stat): Stat {
    const inverted = ['outstanding', 'overdue', 'sos', 'dues', 'pending', 'ungraded'];
    const enriched: Stat = { ...stat };

    if (stat.key === 'attendance' && attendanceSeries.length > 1) {
      enriched.series = attendanceSeries;
    }
    if (inverted.includes(stat.key)) {
      enriched.trend = Number(stat.value) > 0 ? 'down' : 'flat';
    }
    return enriched;
  }

  function accentFor(key: string): 'brand' | 'danger' | 'warning' | 'success' | 'neutral' {
    const value = Number(data?.stats.find((s) => s.key === key)?.value ?? 0);
    if (key === 'sos') return value > 0 ? 'danger' : 'success';
    if (key === 'pending' || key === 'overdue' || key === 'outstanding') {
      return value > 0 ? 'warning' : 'neutral';
    }
    if (key === 'collected' || key === 'students') return 'brand';
    return 'neutral';
  }

  return (
    <>
      <PageHeader
        aurora
        title={`${greeting}, ${user?.firstName ?? ''}`}
        description={
          user ? `${ROLE_LABELS[user.role]} · ${user.branchName ?? user.tenantName}` : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-hairline bg-surface px-2.5 py-1 text-xs text-ink-muted sm:inline-flex">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-success opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
              </span>
              Live
            </span>
            {data?.updatedAt && (
              <Badge tone="neutral">Updated {relativeTime(data.updatedAt)}</Badge>
            )}
          </div>
        }
      />

      {sosCount > 0 && (
        <Alert tone="danger" title="Active emergency alert" className="mb-5">
          {sosCount} SOS alert{sosCount === 1 ? '' : 's'} open and unacknowledged.{' '}
          <Link to="/tracking" className="font-medium underline underline-offset-2">
            Open Live Tracking
          </Link>
        </Alert>
      )}

      <StatGrid>
        {isLoading
          ? Array.from({ length: 6 }, (_, i) => <StatCardSkeleton key={i} />)
          : data?.stats.map((stat, index) => {
              const Icon = STAT_ICONS[stat.key];
              return (
                <StatCard
                  key={stat.key}
                  index={index}
                  stat={withSentiment(stat as Stat)}
                  accent={accentFor(stat.key)}
                  icon={Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : undefined}
                />
              );
            })}
      </StatGrid>

      {/* Charts */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {canSeeAttendanceTrend && attendance && (
          <TrendChart
            title="Attendance trend"
            description="Daily attendance across marked sections"
            data={attendance.series.slice(-30).map((point) => ({
              label: formatDate(point.label, 'short'),
              Attendance: point.attendancePercent,
            }))}
            series={[{ key: 'Attendance', name: 'Attendance %' }]}
            valueFormatter={(v) => `${v}%`}
          />
        )}

        {canSeeFinance && collection && (
          <ComparisonChart
            title="Fee collection by mode"
            description="How families are paying"
            data={collection.byMode.map((mode) => ({
              label: mode.mode.replace('_', ' '),
              Amount: mode.amount,
            }))}
            series={[{ key: 'Amount', name: 'Collected' }]}
            valueFormatter={formatCompactCurrency}
            horizontal
          />
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Teacher: today's periods */}
        {data?.timetable && (
          <Card accent className="lg:col-span-2">
            <CardHeader
              title="Today's schedule"
              description={`${data.timetable.length} period${data.timetable.length === 1 ? '' : 's'}`}
              action={
                <Link to="/academic/timetable" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
                  Full timetable <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              }
            />
            {data.timetable.length === 0 ? (
              <EmptyState title="No classes scheduled today" description="Enjoy the quiet." />
            ) : (
              <ul className="divide-y divide-hairline">
                {data.timetable.map((period, index) => (
                  <li
                    key={period.periodNumber}
                    style={{ animationDelay: `${index * 40}ms` }}
                    className="flex animate-slide-up items-center gap-3 px-5 py-3 transition-colors [animation-fill-mode:backwards] hover:bg-surface-sunken/50"
                  >
                    <span
                      className="h-9 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: period.subject.colorHex }}
                      aria-hidden="true"
                    />
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-xs font-semibold text-ink-muted nums">
                      {period.periodNumber}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{period.subject.name}</p>
                      <p className="truncate text-xs text-ink-muted">
                        {period.section.class.name}-{period.section.name}
                        {period.room ? ` · ${period.room.name}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md bg-surface-sunken px-2 py-1 text-xs text-ink-muted nums">
                      {period.startTime}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {/* Accountant: recent receipts */}
        {data?.recentPayments && (
          <Card accent className="lg:col-span-2">
            <CardHeader
              title="Recent payments"
              action={
                <Link to="/fees/payments" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
                  View all <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              }
            />
            {data.recentPayments.length === 0 ? (
              <EmptyState title="No payments recorded yet" />
            ) : (
              <ul className="divide-y divide-hairline">
                {data.recentPayments.slice(0, 6).map((payment, index) => (
                  <li
                    key={payment.id}
                    style={{ animationDelay: `${index * 40}ms` }}
                    className="flex animate-slide-up items-center gap-3 px-5 py-3 transition-colors [animation-fill-mode:backwards] hover:bg-surface-sunken/50"
                  >
                    <Avatar name={`${payment.student.firstName} ${payment.student.lastName}`} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {payment.student.firstName} {payment.student.lastName}
                      </p>
                      <p className="truncate text-xs text-ink-muted">
                        {payment.receiptNo} · {payment.mode}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-success nums">
                        +{formatCompactCurrency(payment.amount)}
                      </p>
                      <p className="text-xs text-ink-subtle">{relativeTime(payment.paidAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {/* Safety alerts */}
        {data?.alerts && data.alerts.length > 0 && (
          <Card>
            <CardHeader
              title="Safety alerts"
              description="Last 24 hours"
              action={<Badge tone="warning">{data.alerts.length}</Badge>}
            />
            <ul className="divide-y divide-hairline">
              {data.alerts.slice(0, 6).map((alert) => (
                <li key={alert.id} className="px-5 py-3 transition-colors hover:bg-surface-sunken/50">
                  <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                        alert.severity === 'CRITICAL' ? 'bg-danger' : 'bg-warning',
                      )}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="text-sm text-ink">{alert.message}</p>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {alert.vehicle?.registrationNo ?? '—'} · {relativeTime(alert.occurredAt)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Announcements */}
        <Card>
          <CardHeader
            title="Announcements"
            action={
              <Link to="/communication/announcements" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
                All <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            }
          />
          {!announcements ? (
            <CardBody className="space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </CardBody>
          ) : announcements.items.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
              title="No announcements"
              description="School-wide notices will appear here."
            />
          ) : (
            <ul className="divide-y divide-hairline">
              {announcements.items.map((announcement) => (
                <li key={announcement.id} className="px-5 py-3 transition-colors hover:bg-surface-sunken/50">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 text-sm font-medium text-ink">
                      {announcement.title}
                    </p>
                    {announcement.priority === 'HIGH' && <StatusBadge status="HIGH" />}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{announcement.body}</p>
                  <p className="mt-1.5 text-2xs text-ink-subtle">
                    {relativeTime(announcement.publishAt ?? announcement.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
