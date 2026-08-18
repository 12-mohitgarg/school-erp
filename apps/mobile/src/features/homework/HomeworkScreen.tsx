/**
 * Homework.
 *
 * Shared by both family apps, with one difference that matters: a **student**
 * can submit, a **parent** cannot. That is not a UI preference — the API grants
 * `examination:submit` to STUDENT only, deliberately kept separate from
 * `examination:create` so a student who can hand in work cannot also author
 * exams. The screen mirrors the permission rather than inventing its own rule.
 *
 * Sorting is by urgency, not by date posted: overdue first, then due soonest.
 * A list of homework ordered by when the teacher happened to publish it is a
 * list nobody can act on.
 */

import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { examinationApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { useAuth } from '@/core/auth/AuthProvider';
import { daysUntil, formatDueLabel, fullName, toAmount } from '@/core/utils/format';
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
  Screen,
  SegmentedControl,
  Text,
} from '@/design/components';
import type { AssignmentRow } from '@/core/api/types';

type Filter = 'due' | 'all';

export function HomeworkScreen({
  onOpen,
}: {
  onOpen: (assignmentId: string) => void;
}) {
  const subject = useSubjectStudent();
  const [filter, setFilter] = useState<Filter>('due');

  /**
   * Scoped to the student's own section where we know it. Without a section
   * filter the API would return the whole class group, which for a parent is
   * homework their child was never set.
   */
  const scope = subject.sectionId ?? subject.classId ?? 'all';

  const query = useQuery({
    queryKey: qk.assignments(scope),
    queryFn: () =>
      examinationApi.assignments({
        limit: 60,
        ...(subject.sectionId ? { sectionId: subject.sectionId } : {}),
        ...(!subject.sectionId && subject.classId ? { classId: subject.classId } : {}),
      }),
    // Waiting for the profile avoids a first fetch that pulls the whole school.
    enabled: !subject.isPending,
  });

  const onRefresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  const { due, all } = useMemo(() => {
    const items = [...(query.data?.items ?? [])];

    items.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

    const stillDue = items.filter((a) => {
      const days = daysUntil(a.dueAt);
      return days !== null && days >= 0;
    });

    // Overdue work belongs at the top of "due", not hidden in history.
    const overdue = items
      .filter((a) => {
        const days = daysUntil(a.dueAt);
        return days !== null && days < 0;
      })
      .reverse();

    return { due: [...overdue, ...stillDue], all: [...items].reverse() };
  }, [query.data]);

  const visible = filter === 'due' ? due : all;

  if (query.isPending || subject.isPending) {
    return (
      <Screen scroll>
        <ListSkeleton rows={5} />
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

  return (
    <Screen padded>
      <View style={styles.toolbar}>
        <SegmentedControl<Filter>
          segments={[
            { value: 'due', label: 'Due', count: due.length },
            { value: 'all', label: 'All' },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        refreshing={query.isFetching}
        onRefresh={onRefresh}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <EmptyState
            icon="homework"
            title={filter === 'due' ? 'Nothing due' : 'No homework yet'}
            message={
              filter === 'due'
                ? 'All caught up. New homework will appear here as teachers publish it.'
                : 'Homework published by your teachers will appear here.'
            }
          />
        }
        renderItem={({ item }) => (
          <AssignmentCard assignment={item} onPress={() => onOpen(item.id)} />
        )}
      />
    </Screen>
  );
}

export function AssignmentCard({
  assignment,
  onPress,
}: {
  assignment: AssignmentRow;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { role } = useAuth();

  const days = daysUntil(assignment.dueAt);
  const overdue = days !== null && days < 0;
  const urgent = days !== null && days >= 0 && days <= 1;

  return (
    <Card
      onPress={onPress}
      accentColor={assignment.subject.colorHex || colors.brand500}
      elevation={overdue || urgent ? 'sm' : 'none'}
    >
      <View style={styles.cardTop}>
        <Badge
          label={assignment.subject.name}
          tone="neutral"
          style={{
            backgroundColor: `${assignment.subject.colorHex || colors.brand500}1F`,
          }}
        />
        <View style={styles.flex} />
        <Text
          variant="micro"
          tone={overdue ? 'danger' : urgent ? 'warning' : 'subtle'}
          weight="600"
        >
          {formatDueLabel(assignment.dueAt).toUpperCase()}
        </Text>
      </View>

      <Text variant="title3" numberOfLines={2} style={{ marginTop: spacing.md }}>
        {assignment.title}
      </Text>

      <Text variant="callout" tone="muted" numberOfLines={2} style={{ marginTop: spacing.xs }}>
        {assignment.description}
      </Text>

      <View style={styles.cardFooter}>
        <Icon name="profile" size={13} tone="subtle" />
        <Text variant="caption" tone="subtle" numberOfLines={1} style={styles.flex}>
          {fullName(assignment.teacher.firstName, assignment.teacher.lastName)}
        </Text>

        <Icon name="results" size={13} tone="subtle" />
        <Text variant="caption" tone="subtle">
          {toAmount(assignment.maxMarks)} marks
        </Text>

        {assignment.attachmentUrls.length > 0 ? (
          <>
            <Icon name="attach" size={13} tone="subtle" />
            <Text variant="caption" tone="subtle">
              {assignment.attachmentUrls.length}
            </Text>
          </>
        ) : null}
      </View>

      {/* A parent sees the same card but no call to action — they cannot submit
          on their child's behalf, and a button that 403s would be worse than
          no button. */}
      {role === 'PARENT' && overdue ? (
        <View style={[styles.parentNote, { backgroundColor: colors.warningSoft }]}>
          <Icon name="alert" size={14} tone="warning" />
          <Text variant="caption" tone="warning" style={styles.flex}>
            Past its due date. Your child submits this from their own app.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    paddingTop: spacing.md,
  },
  list: {
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    marginTop: spacing.lg,
  },
  parentNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radii.sm,
    marginTop: spacing.md,
  },
});
