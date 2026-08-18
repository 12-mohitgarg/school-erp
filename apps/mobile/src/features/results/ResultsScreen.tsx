/**
 * Results.
 *
 * Only published report cards are returned by the API, which is the right
 * boundary: a parent must never see a provisional mark that the school is
 * still moderating, and enforcing that server-side means no client can leak it.
 *
 * The subject breakdown is rendered from the `subjectResults` JSON column, and
 * degrades to the headline figures if a school's grading configuration does not
 * populate it — a report card with no per-subject detail is still a report card.
 */

import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { GRADING_SYSTEM } from '@erp/shared';
import { examinationApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { formatDate, toAmount } from '@/core/utils/format';
import { useSubjectStudent } from '@/features/shared/useSubjectStudent';
import { useTheme } from '@/design/ThemeProvider';
import { radii, spacing } from '@/design/tokens';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ListSkeleton,
  ProgressBar,
  ProgressRing,
  Screen,
  SectionHeader,
  Text,
  animateNextLayout,
} from '@/design/components';
import type { ReportCardRow, SubjectResult } from '@/core/api/types';

export function ResultsScreen() {
  const subject = useSubjectStudent();

  const query = useQuery({
    queryKey: qk.reportCards(subject.studentId ?? 'none'),
    queryFn: () => examinationApi.reportCards(subject.studentId!),
    enabled: Boolean(subject.studentId),
  });

  const onRefresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  if (!subject.studentId) {
    return (
      <Screen scroll>
        <EmptyState
          icon="results"
          title="No student selected"
          message="Choose a child from the home screen to see their results."
        />
      </Screen>
    );
  }

  if (query.isPending) {
    return (
      <Screen scroll>
        <ListSkeleton rows={3} />
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

  const cards = query.data ?? [];

  if (cards.length === 0) {
    return (
      <Screen scroll onRefresh={onRefresh} refreshing={query.isFetching}>
        <EmptyState
          icon="results"
          title="No results published yet"
          message="Report cards appear here once the school publishes them at the end of a term."
        />
      </Screen>
    );
  }

  const [latest, ...earlier] = cards;

  return (
    <Screen scroll onRefresh={onRefresh} refreshing={query.isFetching}>
      {latest ? (
        <>
          <SectionHeader
            title="Latest result"
            subtitle={`${latest.examTerm.name} · ${latest.examTerm.academicYear.name}`}
          />
          <ReportCard card={latest} defaultExpanded />
        </>
      ) : null}

      {earlier.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Earlier terms" subtitle={`${earlier.length} published`} />
          <View style={styles.stack}>
            {earlier.map((card) => (
              <ReportCard key={card.id} card={card} />
            ))}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

/**
 * One report card, collapsed to its headline and expandable to the subject
 * breakdown. Collapsed by default for earlier terms because the list is a
 * history, and expanding all of them makes it unscannable.
 */
export function ReportCard({
  card,
  defaultExpanded = false,
}: {
  card: ReportCardRow;
  defaultExpanded?: boolean;
}) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const percentage = toAmount(card.percentage);
  const subjects = useMemo(() => normaliseSubjects(card.subjectResults), [card.subjectResults]);

  const gradingLabel = card.gpa
    ? GRADING_SYSTEM.GPA
    : card.grade
      ? GRADING_SYSTEM.LETTER
      : GRADING_SYSTEM.PERCENTAGE;

  return (
    <Card elevation="sm">
      <View style={styles.cardHeader}>
        <View style={styles.flex}>
          <Text variant="title3" numberOfLines={1}>
            {card.examTerm.name}
          </Text>
          <Text variant="caption" tone="muted">
            {card.examTerm.academicYear.name}
            {card.publishedAt ? ` · Published ${formatDate(card.publishedAt)}` : ''}
          </Text>

          <View style={styles.headlineRow}>
            {card.grade ? <Badge label={`Grade ${card.grade}`} tone="brand" variant="solid" /> : null}
            {card.gpa ? <Badge label={`GPA ${toAmount(card.gpa).toFixed(2)}`} tone="info" /> : null}
            {card.rank ? <Badge label={`Rank ${card.rank}`} tone="success" /> : null}
            <Badge label={gradingLabel} tone="neutral" />
          </View>
        </View>

        <ProgressRing value={percentage} size={78} thickness={7} />
      </View>

      <View style={[styles.marksRow, { borderTopColor: colors.hairline }]}>
        <MarkFigure label="Obtained" value={card.obtainedMarks} />
        <MarkFigure label="Total" value={card.totalMarks} />
        <MarkFigure
          label="Attendance"
          value={card.attendancePercentage ? `${toAmount(card.attendancePercentage).toFixed(0)}%` : null}
        />
      </View>

      {subjects.length > 0 ? (
        <>
          <Card
            elevation="none"
            padded={false}
            onPress={() => {
              animateNextLayout();
              setExpanded((v) => !v);
            }}
            style={styles.expandToggle}
          >
            <Text variant="callout" tone="brand" weight="600">
              {expanded ? 'Hide subject breakdown' : `Subject breakdown (${subjects.length})`}
            </Text>
            <Icon name={expanded ? 'up' : 'down'} size={16} tone="brand" />
          </Card>

          {expanded ? (
            <View style={styles.subjects}>
              {subjects.map((result) => (
                <SubjectRow key={result.subjectName} result={result} />
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      {card.remarks ? (
        <View style={[styles.remarks, { backgroundColor: colors.surfaceSunken }]}>
          <Icon name="chat" size={15} tone="subtle" />
          <Text variant="caption" tone="muted" style={styles.flex}>
            {card.remarks}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

function MarkFigure({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.markFigure}>
      <Text variant="micro" tone="subtle">
        {label.toUpperCase()}
      </Text>
      <Text variant="title3" tabular style={{ marginTop: 2 }}>
        {value === null ? '—' : typeof value === 'string' && value.includes('%') ? value : toAmount(value).toFixed(0)}
      </Text>
    </View>
  );
}

function SubjectRow({ result }: { result: SubjectResult }) {
  const pct = result.maxMarks > 0 ? (result.obtainedMarks / result.maxMarks) * 100 : 0;

  return (
    <View style={styles.subjectRow}>
      <View style={styles.subjectHeader}>
        <Text variant="callout" weight="600" numberOfLines={1} style={styles.flex}>
          {result.subjectName}
        </Text>
        <Text variant="callout" tabular tone="muted">
          {result.obtainedMarks} / {result.maxMarks}
        </Text>
        {result.grade ? <Badge label={result.grade} tone="neutral" /> : null}
      </View>

      <ProgressBar value={pct} height={6} />

      {result.remarks ? (
        <Text variant="caption" tone="subtle" numberOfLines={2}>
          {result.remarks}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * `subjectResults` is a JSON column, so the server does not guarantee its
 * shape. Anything that is not a usable row is dropped rather than rendered as
 * `undefined / NaN`.
 */
function normaliseSubjects(raw: SubjectResult[] | null): SubjectResult[] {
  if (!Array.isArray(raw)) return [];

  return raw.filter(
    (row): row is SubjectResult =>
      typeof row?.subjectName === 'string' &&
      Number.isFinite(Number(row.obtainedMarks)) &&
      Number.isFinite(Number(row.maxMarks)),
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing['2xl'],
  },
  stack: {
    gap: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  flex: {
    flex: 1,
  },
  headlineRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
    marginTop: spacing.sm,
  },
  marksRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  markFigure: {
    flex: 1,
  },
  expandToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  subjects: {
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  subjectRow: {
    gap: spacing.sm,
  },
  subjectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  remarks: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    marginTop: spacing.lg,
  },
});
