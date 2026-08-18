/**
 * Attendance.
 *
 * Shared by the Parent and Student apps — same records, same question. The
 * headline is the percentage because that is what determines exam eligibility
 * in most Indian schools, and the ring's thresholds are set at the 75% mark
 * that eligibility actually turns on rather than at arbitrary thirds.
 *
 * Absences are listed first under a filter, not buried in a chronological
 * list, because "which days did they miss?" is the follow-up question every
 * single time.
 */

import { useCallback, useMemo, useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { subMonths } from 'date-fns';
import { attendanceApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { formatDayLabel, humanise } from '@/core/utils/format';
import { useSubjectStudent } from '@/features/shared/useSubjectStudent';
import { useTheme } from '@/design/ThemeProvider';
import { spacing } from '@/design/tokens';
import {
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ListSkeleton,
  ProgressRing,
  Screen,
  SegmentedControl,
  StatusBadge,
  Text,
  statusTone,
  useToneColors,
} from '@/design/components';
import type { AttendanceRecordRow } from '@/core/api/types';

type Range = '1m' | '3m' | 'year';
type Filter = 'all' | 'absences';

const RANGE_MONTHS: Record<Range, number> = { '1m': 1, '3m': 3, year: 12 };

export function AttendanceScreen() {
  const { colors } = useTheme();
  const subject = useSubjectStudent();

  const [range, setRange] = useState<Range>('3m');
  const [filter, setFilter] = useState<Filter>('all');

  const from = useMemo(
    () => subMonths(new Date(), RANGE_MONTHS[range]).toISOString().slice(0, 10),
    [range],
  );

  const query = useQuery({
    queryKey: qk.attendance(subject.studentId ?? 'none', from),
    queryFn: () => attendanceApi.forStudent(subject.studentId!, { from }),
    enabled: Boolean(subject.studentId),
  });

  const onRefresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  /** Records grouped by month, newest first — the shape a SectionList wants. */
  const sections = useMemo(() => {
    const records = query.data?.records ?? [];
    const visible =
      filter === 'absences'
        ? records.filter((r) => r.status === 'ABSENT' || r.status === 'HALF_DAY')
        : records;

    const byMonth = new Map<string, AttendanceRecordRow[]>();

    for (const record of visible) {
      const month = record.session.date.slice(0, 7);
      const bucket = byMonth.get(month);
      if (bucket) bucket.push(record);
      else byMonth.set(month, [record]);
    }

    return [...byMonth.entries()].map(([month, data]) => ({
      title: new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', {
        month: 'long',
        year: 'numeric',
      }),
      data,
    }));
  }, [query.data, filter]);

  if (!subject.studentId) {
    return (
      <Screen scroll>
        <EmptyState
          icon="attendance"
          title="No student selected"
          message="Choose a child from the home screen to see their attendance."
        />
      </Screen>
    );
  }

  if (query.isPending) {
    return (
      <Screen scroll>
        <ListSkeleton rows={6} />
      </Screen>
    );
  }

  if (query.isError) {
    return (
      <Screen scroll>
        <ErrorState error={query.error} onRetry={onRefresh} />
      </Screen>
    );
  }

  const summary = query.data?.summary;
  const absences = (query.data?.records ?? []).filter(
    (r) => r.status === 'ABSENT' || r.status === 'HALF_DAY',
  ).length;

  return (
    <Screen padded>
      <SectionList
        sections={sections}
        keyExtractor={(item, index) => `${item.session.date}-${item.session.periodNumber ?? 'day'}-${index}`}
        refreshing={query.isFetching}
        onRefresh={onRefresh}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            {summary ? (
              <Card elevation="sm">
                <View style={styles.summaryRow}>
                  <ProgressRing value={summary.attendancePercent} size={104} label="Present" />

                  <View style={styles.summaryStats}>
                    <SummaryLine label="Days marked" value={summary.total} />
                    <SummaryLine label="Present" value={summary.present} tone="success" />
                    <SummaryLine label="Late" value={summary.late} tone="warning" />
                    <SummaryLine label="Absent" value={summary.absent} tone="danger" />
                    {summary.halfDay > 0 ? (
                      <SummaryLine label="Half day" value={summary.halfDay} tone="warning" />
                    ) : null}
                    {summary.excused > 0 ? (
                      <SummaryLine label="Excused" value={summary.excused} tone="info" />
                    ) : null}
                  </View>
                </View>

                {summary.attendancePercent < 75 && summary.total > 0 ? (
                  <View style={[styles.warning, { backgroundColor: colors.warningSoft }]}>
                    <Icon name="alert" size={16} tone="warning" />
                    <Text variant="caption" tone="warning" style={styles.flex}>
                      Below the 75% many schools require for exam eligibility. Speak
                      to the class teacher if this is unexpected.
                    </Text>
                  </View>
                ) : null}
              </Card>
            ) : null}

            <View style={styles.controls}>
              <SegmentedControl<Range>
                segments={[
                  { value: '1m', label: '1 month' },
                  { value: '3m', label: '3 months' },
                  { value: 'year', label: 'Year' },
                ]}
                value={range}
                onChange={setRange}
              />

              <SegmentedControl<Filter>
                segments={[
                  { value: 'all', label: 'All days' },
                  { value: 'absences', label: 'Absences', count: absences },
                ]}
                value={filter}
                onChange={setFilter}
              />
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text variant="micro" tone="subtle" style={styles.sectionHeader}>
            {section.title.toUpperCase()}
          </Text>
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        SectionSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => <AttendanceRow record={item} />}
        ListEmptyComponent={
          <EmptyState
            icon="attendance"
            title={filter === 'absences' ? 'No absences' : 'Nothing recorded yet'}
            message={
              filter === 'absences'
                ? 'A perfect record for this period.'
                : 'Attendance for this period has not been marked.'
            }
          />
        }
      />
    </Screen>
  );
}

function SummaryLine({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: Parameters<typeof useToneColors>[0];
}) {
  const { fg } = useToneColors(tone);

  return (
    <View style={styles.summaryLine}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text
        variant="bodyStrong"
        tabular
        tone={tone === 'neutral' ? 'default' : 'inherit'}
        style={tone === 'neutral' ? undefined : { color: fg }}
      >
        {value}
      </Text>
    </View>
  );
}

function AttendanceRow({ record }: { record: AttendanceRecordRow }) {
  const tone = statusTone(record.status);
  const { fg, soft } = useToneColors(tone);

  /**
   * The source matters when a record is disputed: an attendance mark that came
   * from a bus boarding scan or the school gate is evidence of a different kind
   * from one a teacher keyed in, and a parent querying an absence should be
   * able to see which they are arguing with.
   */
  const sourceLabel =
    record.source === 'TEACHER'
      ? null
      : record.source === 'BUS_BOARDING'
        ? 'Recorded on the bus'
        : record.source === 'GPS_GATE'
          ? 'Recorded at the school gate'
          : `Recorded by ${humanise(record.source).toLowerCase()}`;

  return (
    <Card elevation="none" padded={false} style={styles.recordCard}>
      <View style={styles.recordRow}>
        <View style={[styles.recordMark, { backgroundColor: soft }]}>
          <Icon
            name={
              record.status === 'PRESENT'
                ? 'success'
                : record.status === 'ABSENT'
                  ? 'absent'
                  : 'clock'
            }
            size={17}
            color={fg}
          />
        </View>

        <View style={styles.flex}>
          <Text variant="bodyStrong">{formatDayLabel(record.session.date)}</Text>

          <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 1 }}>
            {[
              record.session.subject?.name,
              record.session.periodNumber ? `Period ${record.session.periodNumber}` : null,
              record.lateByMinutes ? `${record.lateByMinutes} min late` : null,
              sourceLabel,
            ]
              .filter(Boolean)
              .join(' · ') || 'Full day'}
          </Text>

          {record.remarks ? (
            <Text variant="caption" tone="subtle" numberOfLines={2} style={{ marginTop: 2 }}>
              {record.remarks}
            </Text>
          ) : null}
        </View>

        <StatusBadge status={record.status} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  header: {
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
  },
  summaryStats: {
    flex: 1,
    gap: spacing.xs + 2,
  },
  summaryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 10,
    marginTop: spacing.lg,
  },
  controls: {
    gap: spacing.md,
  },
  sectionHeader: {
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  recordCard: {
    padding: spacing.md,
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  recordMark: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
  },
});
