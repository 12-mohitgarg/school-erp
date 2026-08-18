/**
 * Timetable.
 *
 * Opens on today, because on a phone the timetable is consulted between
 * periods, not planned around. Sunday opens on Monday instead — a blank grid
 * on the day you check tomorrow's lessons is the wrong default.
 *
 * The "now" marker is the one piece of state the printed timetable on the
 * classroom wall cannot have, so it earns its place.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { academicApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { formatClock, fullName } from '@/core/utils/format';
import { useSubjectStudent } from '@/features/shared/useSubjectStudent';
import { useTheme } from '@/design/ThemeProvider';
import { radii, spacing } from '@/design/tokens';
import {
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ListSkeleton,
  Screen,
  Text,
} from '@/design/components';
import type { TimetableSlotRow } from '@/core/api/types';

/** The API uses ISO weekday numbering: Monday = 1 … Sunday = 7. */
const DAYS = [
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
] as const;

function todayIso(): number {
  const day = new Date().getDay();
  // Sunday (0) has no timetable in an Indian school week; show Monday.
  return day === 0 ? 1 : day;
}

export function TimetableScreen() {
  const { colors } = useTheme();
  const subject = useSubjectStudent();

  const [selectedDay, setSelectedDay] = useState(todayIso);
  const [now, setNow] = useState(() => new Date());

  /** Recompute the "now" marker each minute; a stale one is worse than none. */
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const query = useQuery({
    queryKey: qk.timetable(subject.sectionId ?? 'none'),
    queryFn: () => academicApi.timetable(subject.sectionId!),
    enabled: Boolean(subject.sectionId),
    staleTime: 30 * 60_000,
  });

  const slots = useMemo<TimetableSlotRow[]>(() => {
    const grid = query.data?.grid;
    const forDay = grid?.[String(selectedDay)] ?? [];
    return [...forDay].sort((a, b) => a.periodNumber - b.periodNumber);
  }, [query.data, selectedDay]);

  const onRefresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  const isToday = selectedDay === todayIso();

  if (subject.isPending || query.isPending) {
    return (
      <Screen scroll>
        <ListSkeleton rows={6} />
      </Screen>
    );
  }

  if (!subject.sectionId) {
    return (
      <Screen scroll>
        <EmptyState
          icon="timetable"
          title="No class assigned"
          message="A timetable appears once the school enrols this student into a section."
        />
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
    <Screen padded={false}>
      {/* Day strip. Horizontal rather than a dropdown: switching days is the
          main interaction on this screen and should cost one tap. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.dayStrip}
      >
        {DAYS.map((day) => {
          const selected = day.value === selectedDay;
          const today = day.value === todayIso();

          return (
            <Card
              key={day.value}
              elevation="none"
              padded={false}
              onPress={() => setSelectedDay(day.value)}
              style={[
                styles.dayChip,
                {
                  backgroundColor: selected ? colors.brand600 : colors.surface,
                  borderColor: selected ? colors.brand600 : colors.hairline,
                },
              ]}
            >
              <Text
                variant="callout"
                weight="600"
                tone="inherit"
                style={{ color: selected ? colors.onBrand : colors.inkMuted }}
              >
                {day.short}
              </Text>
              {today ? (
                <View
                  style={[
                    styles.todayDot,
                    { backgroundColor: selected ? colors.onBrand : colors.brand500 },
                  ]}
                />
              ) : null}
            </Card>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.listHeader}>
          <Text variant="title3">
            {DAYS.find((d) => d.value === selectedDay)?.long ?? ''}
          </Text>
          <Text variant="caption" tone="muted">
            {subject.className} {subject.sectionName}
            {slots.length > 0 ? ` · ${slots.length} periods` : ''}
          </Text>
        </View>

        {slots.length === 0 ? (
          <EmptyState
            icon="timetable"
            title="No periods scheduled"
            message="Nothing is timetabled for this day."
          />
        ) : (
          slots.map((slot) => (
            <PeriodRow
              key={slot.id}
              slot={slot}
              live={isToday && isCurrentPeriod(slot, now)}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

/** True when `now` falls inside the slot's start/end time. */
function isCurrentPeriod(slot: TimetableSlotRow, now: Date): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(slot.startTime);
  const end = toMinutes(slot.endTime);
  if (start === null || end === null) return false;
  return minutes >= start && minutes < end;
}

function toMinutes(value: string): number | null {
  // The column may serialise as `HH:mm:ss` or as a full ISO timestamp.
  const time = value.includes('T') ? value.slice(11, 16) : value.slice(0, 5);
  const [h, m] = time.split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function PeriodRow({ slot, live }: { slot: TimetableSlotRow; live: boolean }) {
  const { colors } = useTheme();
  const accent = slot.subject.colorHex || colors.brand500;

  if (slot.isBreak) {
    return (
      <View style={[styles.breakRow, { borderColor: colors.hairline }]}>
        <Text variant="micro" tone="subtle">
          {`BREAK · ${formatClock(slot.startTime)} – ${formatClock(slot.endTime)}`}
        </Text>
      </View>
    );
  }

  return (
    <Card
      elevation={live ? 'md' : 'none'}
      accentColor={accent}
      style={live ? { borderColor: accent, borderWidth: 1 } : undefined}
    >
      <View style={styles.periodRow}>
        <View style={styles.periodTime}>
          <Text variant="bodyStrong" tabular>
            {formatClock(slot.startTime)}
          </Text>
          <Text variant="micro" tone="subtle" tabular>
            {formatClock(slot.endTime)}
          </Text>
        </View>

        <View style={[styles.periodBar, { backgroundColor: accent }]} />

        <View style={styles.flex}>
          <View style={styles.periodTitleRow}>
            <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
              {slot.subject.name}
            </Text>
            {live ? (
              <View style={[styles.livePill, { backgroundColor: accent }]}>
                <Text variant="micro" tone="inherit" style={{ color: '#FFFFFF' }}>
                  NOW
                </Text>
              </View>
            ) : null}
          </View>

          <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
            {[
              `Period ${slot.periodNumber}`,
              slot.teacher ? fullName(slot.teacher.firstName, slot.teacher.lastName) : null,
              slot.room?.name,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>

        <Icon name="clock" size={15} tone={live ? 'brand' : 'subtle'} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  dayStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  dayChip: {
    minWidth: 62,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 3,
  },
  todayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['4xl'],
    gap: spacing.sm,
  },
  listHeader: {
    marginBottom: spacing.sm,
  },
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  periodTime: {
    width: 62,
  },
  periodBar: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
  },
  periodTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  livePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  breakRow: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  flex: {
    flex: 1,
  },
});
