/**
 * Driver — boarding list.
 *
 * PRD §2.8: *marks student attendance on boarding and de-boarding the bus.*
 * Recording a boarding also fires the guardian notification ("Child boarded the
 * bus") and feeds BUS_BOARDING attendance, so it is the single highest-value
 * action in the driver app.
 *
 * Two things it gets right that a naive implementation would not:
 *
 *  * **It works with no signal.** Marking writes through the offline queue, so
 *    the row updates instantly and the server catches up later. A driver at a
 *    stop with no bars must not be blocked, and must not have to remember who
 *    they already scanned.
 *
 *  * **It is grouped by stop, in route order.** A flat alphabetical list is
 *    useless at a stop — the driver needs "who is getting on *here*".
 */

import { useCallback, useMemo, useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { transportApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { useNetwork } from '@/core/offline/NetworkProvider';
import { enqueueBoarding } from '@/core/offline/queue';
import { useTheme } from '@/design/ThemeProvider';
import { radii, spacing } from '@/design/tokens';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ListSkeleton,
  Screen,
  SegmentedControl,
  Sheet,
  Text,
} from '@/design/components';
import type { BoardingEvent, ManifestStudent, TripManifest } from '@/core/api/types';

type Filter = 'pending' | 'all';

export function ManifestScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { isOnline, pendingActions } = useNetwork();

  const [filter, setFilter] = useState<Filter>('pending');
  const [selected, setSelected] = useState<ManifestStudent | null>(null);

  const tripQuery = useQuery({
    queryKey: qk.myTrip(),
    queryFn: () => transportApi.myTrip(),
  });

  const tripId = tripQuery.data?.id ?? null;
  const direction = tripQuery.data?.direction ?? 'PICKUP';

  const manifestQuery = useQuery({
    queryKey: qk.manifest(tripId ?? 'none'),
    queryFn: () => transportApi.manifest(tripId!),
    enabled: Boolean(tripId),
  });

  /**
   * Marking is optimistic *and* offline-safe.
   *
   * The cache is updated first so the row flips instantly — a driver tapping
   * twenty names at a stop cannot wait for twenty round trips. If the send
   * fails, the event goes to the durable queue rather than being rolled back,
   * because the boarding *did* happen and the record must survive.
   */
  const mark = useMutation({
    mutationFn: async ({
      student,
      event,
    }: {
      student: ManifestStudent;
      event: BoardingEvent;
    }) => {
      if (!tripId) throw new Error('No trip in progress');

      const payload = {
        studentId: student.studentId,
        event,
        ...(student.stop ? { stopId: student.stop.id } : {}),
        method: 'MANUAL' as const,
      };

      try {
        await transportApi.recordBoarding(tripId, payload);
      } catch {
        await enqueueBoarding(tripId, payload);
      }
    },
    onMutate: async ({ student, event }) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const key = qk.manifest(tripId ?? 'none');
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<TripManifest>(key);

      if (previous) {
        queryClient.setQueryData<TripManifest>(key, {
          ...previous,
          students: previous.students.map((s) =>
            s.studentId === student.studentId ? { ...s, status: event } : s,
          ),
        });
      }

      return { previous };
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.myTrip() });
    },
  });

  const onRefresh = useCallback(() => {
    void manifestQuery.refetch();
  }, [manifestQuery]);

  /** Grouped by stop, in route order — the order the driver meets them in. */
  const sections = useMemo(() => {
    const students = manifestQuery.data?.students ?? [];

    const visible =
      filter === 'pending' ? students.filter((s) => s.status === 'PENDING') : students;

    const byStop = new Map<string, { title: string; sequence: number; data: ManifestStudent[] }>();

    for (const student of visible) {
      const key = student.stop?.id ?? 'unassigned';
      const existing = byStop.get(key);

      if (existing) {
        existing.data.push(student);
      } else {
        byStop.set(key, {
          title: student.stop ? `${student.stop.sequence}. ${student.stop.name}` : 'No stop assigned',
          sequence: student.stop?.sequence ?? 999,
          data: [student],
        });
      }
    }

    return [...byStop.values()].sort((a, b) => a.sequence - b.sequence);
  }, [manifestQuery.data, filter]);

  const counts = useMemo(() => {
    const students = manifestQuery.data?.students ?? [];
    return {
      total: students.length,
      pending: students.filter((s) => s.status === 'PENDING').length,
      boarded: students.filter((s) => s.status === 'BOARDED').length,
      alighted: students.filter((s) => s.status === 'ALIGHTED').length,
      absent: students.filter((s) => s.status === 'ABSENT').length,
    };
  }, [manifestQuery.data]);

  if (tripQuery.isPending) {
    return (
      <Screen scroll>
        <ListSkeleton rows={5} showAvatar />
      </Screen>
    );
  }

  if (!tripId) {
    return (
      <Screen scroll>
        <EmptyState
          icon="manifest"
          title="No trip running"
          message="Start a trip from the Trip tab to see who is expected at each stop."
        />
      </Screen>
    );
  }

  if (manifestQuery.isPending) {
    return (
      <Screen scroll>
        <ListSkeleton rows={6} showAvatar />
      </Screen>
    );
  }

  if (manifestQuery.isError) {
    return (
      <Screen scroll>
        <ErrorState error={manifestQuery.error} onRetry={onRefresh} />
      </Screen>
    );
  }

  return (
    <Screen padded>
      <View style={styles.header}>
        <View style={styles.counts}>
          <Count label="Expected" value={counts.total} />
          <Count label={direction === 'PICKUP' ? 'On board' : 'Dropped'} value={direction === 'PICKUP' ? counts.boarded : counts.alighted} tone="success" />
          <Count label="Pending" value={counts.pending} tone="warning" />
          <Count label="Absent" value={counts.absent} tone="danger" />
        </View>

        <SegmentedControl<Filter>
          segments={[
            { value: 'pending', label: 'To mark', count: counts.pending },
            { value: 'all', label: 'Everyone', count: counts.total },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>

      {!isOnline || pendingActions > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner
            tone={isOnline ? 'info' : 'warning'}
            icon={isOnline ? 'refresh' : 'offline'}
            title={
              isOnline
                ? `${pendingActions} boarding record${pendingActions === 1 ? '' : 's'} syncing`
                : 'Working offline'
            }
            message="Keep marking as normal — everything is saved on this phone and sent automatically once you have signal."
          />
        </View>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.studentId}
        refreshing={manifestQuery.isFetching}
        onRefresh={onRefresh}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        SectionSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderSectionHeader={({ section }) => (
          <View style={[styles.stopHeader, { backgroundColor: colors.canvas }]}>
            <Icon name="pin" size={14} tone="brand" />
            <Text variant="micro" tone="brand" weight="700">
              {section.title.toUpperCase()}
            </Text>
            <View style={styles.flex} />
            <Text variant="micro" tone="subtle">
              {section.data.length}
            </Text>
          </View>
        )}
        renderItem={({ item }) => (
          <StudentRow
            student={item}
            direction={direction}
            onQuickMark={(event) => mark.mutate({ student: item, event })}
            onOpenOptions={() => setSelected(item)}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="success"
            title={filter === 'pending' ? 'Everyone is marked' : 'Nobody allocated'}
            message={
              filter === 'pending'
                ? 'Every student on this run has been accounted for.'
                : 'No students are allocated to this route.'
            }
          />
        }
      />

      <BoardingSheet
        student={selected}
        direction={direction}
        onClose={() => setSelected(null)}
        onMark={(event) => {
          if (selected) mark.mutate({ student: selected, event });
          setSelected(null);
        }}
      />
    </Screen>
  );
}

function Count({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const { colors } = useTheme();

  const color =
    tone === 'success'
      ? colors.success
      : tone === 'warning'
        ? colors.warning
        : tone === 'danger'
          ? colors.danger
          : colors.ink;

  return (
    <View style={styles.count}>
      <Text variant="title2" tabular tone="inherit" style={{ color }}>
        {value}
      </Text>
      <Text variant="micro" tone="subtle" numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

function StudentRow({
  student,
  direction,
  onQuickMark,
  onOpenOptions,
}: {
  student: ManifestStudent;
  direction: 'PICKUP' | 'DROP';
  onQuickMark: (event: BoardingEvent) => void;
  onOpenOptions: () => void;
}) {
  const pending = student.status === 'PENDING';

  /** The action the driver will want 95% of the time, given the run. */
  const primaryEvent: BoardingEvent = direction === 'PICKUP' ? 'BOARDED' : 'ALIGHTED';

  return (
    <Card elevation={pending ? 'sm' : 'none'} onPress={onOpenOptions}>
      <View style={styles.studentRow}>
        <Avatar name={student.fullName} uri={student.photoUrl} size="md" />

        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {student.fullName}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {[student.className, student.sectionName].filter(Boolean).join(' ')} ·{' '}
            {student.admissionNo}
          </Text>
        </View>

        {pending ? (
          <Button
            label={primaryEvent === 'BOARDED' ? 'On' : 'Off'}
            size="sm"
            variant="success"
            onPress={() => onQuickMark(primaryEvent)}
          />
        ) : (
          <Badge
            label={student.status === 'ABSENT' ? 'Absent' : student.status === 'BOARDED' ? 'On board' : 'Dropped'}
            tone={student.status === 'ABSENT' ? 'danger' : 'success'}
            variant="soft"
            dot
          />
        )}
      </View>
    </Card>
  );
}

/**
 * The full set of outcomes, including corrections. A driver who taps the wrong
 * row needs to be able to fix it — the server upserts on
 * `(tripId, studentId, event)`, so re-marking is safe.
 */
function BoardingSheet({
  student,
  direction,
  onClose,
  onMark,
}: {
  student: ManifestStudent | null;
  direction: 'PICKUP' | 'DROP';
  onClose: () => void;
  onMark: (event: BoardingEvent) => void;
}) {
  return (
    <Sheet
      visible={student !== null}
      onClose={onClose}
      title={student?.fullName}
      subtitle={
        student
          ? `${[student.className, student.sectionName].filter(Boolean).join(' ')} · ${student.stop?.name ?? 'No stop'}`
          : undefined
      }
    >
      <Button
        label={direction === 'PICKUP' ? 'Boarded the bus' : 'Got off the bus'}
        variant="success"
        size="lg"
        fullWidth
        leading={
          <Icon name={direction === 'PICKUP' ? 'boarding' : 'alighting'} size={18} color="#FFFFFF" />
        }
        onPress={() => onMark(direction === 'PICKUP' ? 'BOARDED' : 'ALIGHTED')}
      />

      <Button
        label={direction === 'PICKUP' ? 'Got off the bus' : 'Boarded the bus'}
        variant="secondary"
        size="lg"
        fullWidth
        onPress={() => onMark(direction === 'PICKUP' ? 'ALIGHTED' : 'BOARDED')}
      />

      <Button
        label="Not travelling today"
        variant="secondary"
        size="lg"
        fullWidth
        leading={<Icon name="absent" size={18} tone="danger" />}
        onPress={() => onMark('ABSENT')}
      />

      <Text variant="caption" tone="subtle" align="center">
        Marking a student sends their guardian a notification straight away.
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  counts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  count: {
    flex: 1,
  },
  list: {
    paddingTop: spacing.md,
    paddingBottom: spacing['4xl'],
  },
  stopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
  },
  studentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  flex: {
    flex: 1,
  },
});
