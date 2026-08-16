import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Lock, Save, UserX, Clock, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  useAttendanceRegisterQuery, useMarkAttendanceMutation,
  useClassesQuery, useAttendanceSummaryQuery, useAttendanceDefaultersQuery,
} from '@/features/api/endpoints';
import { useAuth } from '@/features/auth/useAuth';
import { errorMessage } from '@/lib/api';
import {
  Alert, Avatar, Badge, Button, Card, CardHeader, EmptyState,
  PageHeader, Select, Tabs, StatusBadge,
} from '@/components/ui';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { TrendChart } from '@/components/charts/Charts';
import { cn, formatDate, percentage } from '@/lib/utils';

type Status = 'PRESENT' | 'ABSENT' | 'LATE' | 'HALF_DAY' | 'EXCUSED';

const STATUS_OPTIONS: Array<{ value: Status; label: string; short: string; tone: string }> = [
  { value: 'PRESENT', label: 'Present', short: 'P', tone: 'bg-success text-white' },
  { value: 'ABSENT', label: 'Absent', short: 'A', tone: 'bg-danger text-white' },
  { value: 'LATE', label: 'Late', short: 'L', tone: 'bg-warning text-white' },
  { value: 'HALF_DAY', label: 'Half day', short: 'H', tone: 'bg-info text-white' },
  { value: 'EXCUSED', label: 'Excused', short: 'E', tone: 'bg-ink-subtle text-white' },
];

const today = () => new Date().toISOString().slice(0, 10);

export default function AttendancePage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'register' | 'trend' | 'defaulters'>('register');

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Take the daily register, review trends and follow up on low attendance."
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'register', label: 'Daily register' },
          { value: 'trend', label: 'Trends' },
          { value: 'defaulters', label: 'Below threshold' },
        ]}
        className="mb-5"
      />

      {tab === 'register' && <Register canMark={can('attendance:create')} />}
      {tab === 'trend' && <Trends />}
      {tab === 'defaulters' && <Defaulters />}
    </>
  );
}

// ---------------------------------------------------------------------------

function Register({ canMark }: { canMark: boolean }) {
  const { data: classes } = useClassesQuery();
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState(today);
  const [marks, setMarks] = useState<Record<string, Status>>({});

  const [markAttendance, { isLoading: saving }] = useMarkAttendanceMutation();

  const { data: register, isFetching } = useAttendanceRegisterQuery(
    { sectionId, date },
    { skip: !sectionId },
  );

  // Reset local edits whenever a different register is loaded, otherwise marks
  // from the previous section would bleed into this one.
  useEffect(() => {
    if (!register) return;
    setMarks(
      Object.fromEntries(register.students.map((s) => [s.studentId, s.status as Status])),
    );
  }, [register]);

  const sectionOptions = useMemo(
    () =>
      (classes ?? []).flatMap((cls) =>
        cls.sections.map((section) => ({
          value: section.id,
          label: `${cls.name} — Section ${section.name} (${section.enrolled})`,
        })),
      ),
    [classes],
  );

  const tally = useMemo(() => {
    const values = Object.values(marks);
    return {
      total: values.length,
      present: values.filter((v) => v === 'PRESENT').length,
      absent: values.filter((v) => v === 'ABSENT').length,
      late: values.filter((v) => v === 'LATE').length,
    };
  }, [marks]);

  function setAll(status: Status) {
    if (!register) return;
    setMarks(Object.fromEntries(register.students.map((s) => [s.studentId, status])));
  }

  async function save() {
    if (!register) return;

    try {
      const result = await markAttendance({
        sectionId,
        date,
        source: 'TEACHER',
        records: Object.entries(marks).map(([studentId, status]) => ({ studentId, status })),
      }).unwrap();

      toast.success('Attendance saved', {
        description: `${result.marked} marked · ${result.absent} absent · ${result.late} late. Guardians of absentees have been notified.`,
      });
    } catch (err) {
      toast.error('Could not save attendance', { description: errorMessage(err) });
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <Select
            label="Class & section"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            placeholder="Select a section"
            options={[{ value: '', label: 'Select a section' }, ...sectionOptions]}
            wrapperClassName="min-w-[260px] flex-1"
          />
          <div className="w-44">
            <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="att-date">
              Date
            </label>
            <input
              id="att-date"
              type="date"
              value={date}
              max={today()}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 w-full rounded-lg border border-hairline bg-surface px-3 text-sm text-ink hover:border-ink-subtle/60 focus:border-brand-500"
            />
          </div>
        </div>
      </Card>

      {!sectionId ? (
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />}
            title="Choose a section to begin"
            description="Pick a class and section above to load its register for the selected date."
          />
        </Card>
      ) : isFetching ? (
        <Card>
          <EmptyState title="Loading register…" />
        </Card>
      ) : register ? (
        <>
          <StatGrid>
            <StatCard stat={{ key: 'total', label: 'On roll', value: tally.total, format: 'number' }} />
            <StatCard stat={{ key: 'present', label: 'Present', value: tally.present, format: 'number' }} />
            <StatCard stat={{ key: 'absent', label: 'Absent', value: tally.absent, format: 'number' }} accent={tally.absent > 0 ? 'warning' : undefined} />
            <StatCard
              stat={{
                key: 'pct',
                label: 'Attendance',
                value: `${percentage(tally.present + tally.late, tally.total)}%`,
              }}
            />
          </StatGrid>

          <Card>
            <CardHeader
              title={`${register.section.class.name} — Section ${register.section.name}`}
              description={formatDate(date, 'long')}
              action={
                register.isLocked ? (
                  <Badge tone="neutral">
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    Locked
                  </Badge>
                ) : register.isMarked ? (
                  <Badge tone="success" dot>
                    Already marked
                  </Badge>
                ) : (
                  <Badge tone="warning" dot>
                    Not marked
                  </Badge>
                )
              }
            />

            {canMark && !register.isLocked && (
              <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3">
                <span className="text-xs font-medium text-ink-muted">Mark all:</span>
                {STATUS_OPTIONS.slice(0, 3).map((option) => (
                  <Button
                    key={option.value}
                    size="xs"
                    variant="outline"
                    onClick={() => setAll(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            )}

            <ul className="divide-y divide-hairline">
              {register.students.map((student) => (
                <li key={student.studentId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="w-7 shrink-0 text-xs text-ink-subtle nums">
                    {student.rollNumber ?? '—'}
                  </span>
                  <Avatar name={student.fullName} src={student.photoUrl} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{student.fullName}</p>
                    <p className="truncate text-xs text-ink-subtle">{student.admissionNo}</p>
                  </div>

                  {canMark && !register.isLocked ? (
                    <div
                      className="flex shrink-0 gap-1"
                      role="radiogroup"
                      aria-label={`Attendance for ${student.fullName}`}
                    >
                      {STATUS_OPTIONS.map((option) => {
                        const active = marks[student.studentId] === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            title={option.label}
                            onClick={() =>
                              setMarks((prev) => ({ ...prev, [student.studentId]: option.value }))
                            }
                            className={cn(
                              'h-7 w-7 rounded-md text-xs font-semibold transition-all',
                              active
                                ? option.tone
                                : 'bg-surface-sunken text-ink-subtle hover:bg-hairline hover:text-ink',
                            )}
                          >
                            {option.short}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <StatusBadge status={marks[student.studentId] ?? student.status} />
                  )}
                </li>
              ))}
            </ul>

            {canMark && !register.isLocked && register.students.length > 0 && (
              <div className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-3">
                <p className="text-xs text-ink-muted">
                  Guardians of absent students are notified automatically.
                </p>
                <Button onClick={save} loading={saving} leftIcon={<Save className="h-3.5 w-3.5" />}>
                  Save register
                </Button>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Trends() {
  const [groupBy, setGroupBy] = useState<'day' | 'month' | 'class'>('day');
  const { data } = useAttendanceSummaryQuery({ groupBy });

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard stat={{ key: 'marked', label: 'Records marked', value: data?.totals.total ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'present', label: 'Present', value: data?.totals.present ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'absent', label: 'Absent', value: data?.totals.absent ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'pct', label: 'Overall attendance', value: `${data?.totals.attendancePercent ?? 0}%` }} />
      </StatGrid>

      <TrendChart
        title="Attendance over time"
        data={(data?.series ?? []).map((point) => ({
          label: groupBy === 'day' ? formatDate(point.label, 'short') : point.label,
          Attendance: point.attendancePercent,
        }))}
        series={[{ key: 'Attendance', name: 'Attendance %' }]}
        valueFormatter={(v) => `${v}%`}
        height={300}
        action={
          <Select
            aria-label="Group by"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
            options={[
              { value: 'day', label: 'By day' },
              { value: 'month', label: 'By month' },
              { value: 'class', label: 'By class' },
            ]}
            wrapperClassName="w-32"
          />
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Defaulters() {
  const { data } = useAttendanceDefaultersQuery({});

  return (
    <Card>
      <CardHeader
        title="Students below the attendance threshold"
        description={data ? `Threshold: ${data.threshold}% · ${data.students.length} students` : undefined}
      />
      {!data || data.students.length === 0 ? (
        <EmptyState
          icon={<Check className="h-5 w-5 text-success" aria-hidden="true" />}
          title="Everyone is above the threshold"
          description="No student is currently below the minimum attendance requirement."
        />
      ) : (
        <ul className="divide-y divide-hairline">
          {data.students.map((student) => (
            <li key={student.studentId} className="flex items-center gap-3 px-5 py-3">
              <Avatar name={student.fullName} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{student.fullName}</p>
                <p className="truncate text-xs text-ink-subtle">
                  {student.admissionNo}
                  {student.className ? ` · ${student.className}-${student.sectionName}` : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={cn(
                    'text-sm font-semibold nums',
                    student.attendancePercent < data.threshold - 15 ? 'text-danger' : 'text-warning',
                  )}
                >
                  {student.attendancePercent}%
                </p>
                <p className="text-xs text-ink-subtle nums">{student.daysMarked} days</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
