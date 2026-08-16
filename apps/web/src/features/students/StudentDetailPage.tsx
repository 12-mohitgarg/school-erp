import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Mail, Phone, MapPin, Users } from 'lucide-react';
import { useStudentQuery, useStudentFeeSummaryQuery, useStudentAttendanceQuery } from '@/features/api/endpoints';
import { Avatar, Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from '@/components/ui';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { errorMessage } from '@/lib/api';
import { formatCompactCurrency, formatDate } from '@/lib/utils';

export default function StudentDetailPage() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = useStudentQuery(id, { skip: !id });
  const { data: fees } = useStudentFeeSummaryQuery(id, { skip: !id });
  const { data: attendance } = useStudentAttendanceQuery({ id }, { skip: !id });

  if (error) return <ErrorState message={errorMessage(error)} />;

  if (isLoading || !data) {
    return (
      <>
        <Skeleton className="h-8 w-52" />
        <Skeleton className="mt-4 h-40" />
      </>
    );
  }

  const student = data as Record<string, unknown>;
  const fullName = String(student['fullName'] ?? '');
  const enrollments = (student['enrollments'] ?? []) as Array<Record<string, unknown>>;
  const current = enrollments.find((e) => e['isCurrent']);
  const guardians = (student['guardianLinks'] ?? []) as Array<Record<string, unknown>>;
  const summary = student['summary'] as Record<string, unknown> | undefined;
  const transport = (student['transportAllocations'] ?? []) as Array<Record<string, unknown>>;

  return (
    <>
      <Link to="/students" className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to students
      </Link>

      <PageHeader
        title={fullName}
        description={`${String(student['admissionNo'])}${current ? ` · ${String((current['class'] as Record<string, unknown>)['name'])}-${String((current['section'] as Record<string, unknown>)['name'])}` : ''}`}
        actions={<StatusBadge status={String(student['status'])} />}
      />

      <StatGrid>
        <StatCard stat={{ key: 'att', label: 'Attendance', value: attendance ? `${attendance.summary.attendancePercent}%` : '—', hint: attendance ? `${attendance.summary.total} days marked` : undefined }} />
        <StatCard stat={{ key: 'billed', label: 'Fees billed', value: Number(summary?.['feesBilled'] ?? 0), format: 'currency' }} />
        <StatCard stat={{ key: 'paid', label: 'Fees paid', value: Number(summary?.['feesPaid'] ?? 0), format: 'currency' }} />
        <StatCard stat={{ key: 'due', label: 'Outstanding', value: Number(summary?.['feesOutstanding'] ?? 0), format: 'currency' }} accent={Number(summary?.['feesOutstanding'] ?? 0) > 0 ? 'warning' : undefined} />
      </StatGrid>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Profile" />
          <CardBody className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={fullName} src={student['photoUrl'] as string | null} size="xl" />
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{fullName}</p>
                <p className="text-xs text-ink-subtle">{String(student['gender'])} · {String(student['bloodGroup'] ?? '—')}</p>
              </div>
            </div>

            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-subtle">Date of birth</dt>
                <dd className="text-ink">{formatDate(student['dateOfBirth'] as string)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-subtle">Admitted</dt>
                <dd className="text-ink">{formatDate(student['admissionDate'] as string)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-subtle">Roll number</dt>
                <dd className="text-ink nums">{String(current?.['rollNumber'] ?? '—')}</dd>
              </div>
              {student['phone'] ? (
                <div className="flex items-center gap-2 pt-1 text-ink-muted">
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="nums">{String(student['phone'])}</span>
                </div>
              ) : null}
              {student['city'] ? (
                <div className="flex items-center gap-2 text-ink-muted">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{String(student['city'])}, {String(student['state'] ?? '')}</span>
                </div>
              ) : null}
            </dl>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Guardians" description={`${guardians.length} linked`} />
          {guardians.length === 0 ? (
            <EmptyState icon={<Users className="h-5 w-5" aria-hidden="true" />} title="No guardians linked" />
          ) : (
            <ul className="divide-y divide-hairline">
              {guardians.map((link) => {
                const g = link['guardian'] as Record<string, unknown>;
                const name = `${String(g['firstName'])} ${String(g['lastName'])}`;
                return (
                  <li key={String(link['id'])} className="flex items-center gap-3 px-5 py-3">
                    <Avatar name={name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{name}</p>
                      <p className="truncate text-xs text-ink-subtle">
                        {String(link['relation'])} · {String(g['phone'])}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {link['isPrimaryContact'] ? <Badge tone="brand">Primary</Badge> : null}
                      {link['canViewLocation'] ? <Badge tone="success">Location</Badge> : <Badge tone="neutral">No location</Badge>}
                      {g['inviteAcceptedAt'] ? <Badge tone="info">On app</Badge> : <Badge tone="warning">Not invited</Badge>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Invoices" description={fees ? `${fees.summary.overdueCount} overdue` : undefined} />
          {!fees || fees.invoices.length === 0 ? (
            <EmptyState title="No invoices raised" />
          ) : (
            <ul className="divide-y divide-hairline">
              {fees.invoices.slice(0, 8).map((invoice) => (
                <li key={invoice.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{invoice.invoiceNo}</p>
                    <p className="text-xs text-ink-subtle">Due {formatDate(invoice.dueDate, 'short')}</p>
                  </div>
                  <span className="shrink-0 text-sm nums text-ink">{formatCompactCurrency(invoice.balanceAmount)}</span>
                  <StatusBadge status={invoice.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Transport" />
          {transport.length === 0 ? (
            <EmptyState title="Not using school transport" />
          ) : (
            <CardBody className="space-y-2 text-sm">
              {transport.map((allocation) => {
                const route = allocation['route'] as Record<string, unknown>;
                const stop = allocation['pickupStop'] as Record<string, unknown> | null;
                return (
                  <div key={String(allocation['id'])}>
                    <p className="font-medium text-ink">{String(route['name'])}</p>
                    <p className="text-xs text-ink-subtle">Pickup: {stop ? String(stop['name']) : '—'}</p>
                  </div>
                );
              })}
            </CardBody>
          )}
        </Card>
      </div>
    </>
  );
}
