/**
 * Student home.
 *
 * A student's day is structured by the timetable, so that is what leads: what
 * is on now, what is next. Everything else — homework due, results, library —
 * follows underneath.
 *
 * Deliberately *not* a copy of the parent home. A student does not need a fee
 * balance headline or a bus map; they need to know which room to be in and
 * what is due tonight.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { academicApi, communicationApi, dashboardApi, examinationApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { useAuth } from '@/core/auth/AuthProvider';
import { daysUntil, formatClock, formatDueLabel, fullName } from '@/core/utils/format';
import { useSubjectStudent } from '@/features/shared/useSubjectStudent';
import { useTheme } from '@/design/ThemeProvider';
import { radii, spacing } from '@/design/tokens';
import {
  Avatar,
  Badge,
  Card,
  ErrorState,
  Icon,
  ListSkeleton,
  Screen,
  SectionHeader,
  StatGrid,
  StatGridSkeleton,
  Text,
  type IconName,
} from '@/design/components';
import type { TimetableSlotRow } from '@/core/api/types';

export interface StudentHomeActions {
  onOpenTimetable: () => void;
  onOpenHomework: () => void;
  onOpenAssignment: (assignmentId: string) => void;
  onOpenResults: () => void;
  onOpenAttendance: () => void;
  onOpenLibrary: () => void;
  onOpenFees: () => void;
  onOpenCalendar: () => void;
  onOpenAnnouncements: () => void;
  onOpenNotifications: () => void;
}

export function StudentHomeScreen(actions: StudentHomeActions) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const subject = useSubjectStudent();

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const dashboard = useQuery({
    queryKey: qk.dashboard(),
    queryFn: () => dashboardApi.get(),
  });

  const timetable = useQuery({
    queryKey: qk.timetable(subject.sectionId ?? 'none'),
    queryFn: () => academicApi.timetable(subject.sectionId!),
    enabled: Boolean(subject.sectionId),
    staleTime: 30 * 60_000,
  });

  const homework = useQuery({
    queryKey: qk.assignments(subject.sectionId ?? subject.classId ?? 'all'),
    queryFn: () =>
      examinationApi.assignments({
        limit: 20,
        ...(subject.sectionId ? { sectionId: subject.sectionId } : {}),
      }),
    enabled: !subject.isPending,
  });

  const notifications = useQuery({
    queryKey: qk.notifications(),
    queryFn: () => communicationApi.notifications(1, 5, true),
  });

  const onRefresh = useCallback(() => {
    void dashboard.refetch();
    void timetable.refetch();
    void homework.refetch();
    void notifications.refetch();
  }, [dashboard, timetable, homework, notifications]);

  /** Today's periods, with the current one and the next one picked out. */
  const { today, current, next } = useMemo(() => {
    const isoDay = now.getDay() === 0 ? 7 : now.getDay();
    const slots = (timetable.data?.grid?.[String(isoDay)] ?? [])
      .filter((slot) => !slot.isBreak)
      .sort((a, b) => a.periodNumber - b.periodNumber);

    const minutes = now.getHours() * 60 + now.getMinutes();

    const currentSlot = slots.find(
      (slot) => inWindow(minutes, slot.startTime, slot.endTime),
    );
    const nextSlot = slots.find((slot) => (toMinutes(slot.startTime) ?? 0) > minutes);

    return { today: slots, current: currentSlot, next: nextSlot };
  }, [timetable.data, now]);

  const dueSoon = useMemo(() => {
    const items = homework.data?.items ?? [];
    return items
      .filter((a) => {
        const days = daysUntil(a.dueAt);
        return days !== null && days >= -7 && days <= 7;
      })
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
      .slice(0, 3);
  }, [homework.data]);

  const unreadCount = notifications.data?.items.length ?? 0;

  return (
    <Screen
      scroll
      padded={false}
      onRefresh={onRefresh}
      refreshing={dashboard.isFetching}
      contentContainerStyle={{ paddingTop: 0 }}
    >
      <LinearGradient
        colors={[colors.brand700, colors.brand500]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + spacing.lg }]}
      >
        <View style={styles.headerTop}>
          <Avatar name={user?.fullName ?? 'Student'} uri={user?.avatarUrl} size="md" />

          <View style={styles.flex}>
            <Text variant="caption" tone="inherit" style={styles.greeting}>
              {greeting()}
            </Text>
            <Text variant="title3" tone="inherit" style={styles.headerName} numberOfLines={1}>
              {user?.firstName ?? 'Student'}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            onPress={actions.onOpenNotifications}
            hitSlop={8}
            style={styles.bell}
          >
            <Icon name="bell" size={20} color="#FFFFFF" />
            {unreadCount > 0 ? (
              <View style={[styles.bellBadge, { backgroundColor: colors.danger }]}>
                <Text variant="micro" tone="inherit" style={{ color: '#FFFFFF' }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        {subject.className ? (
          <View style={styles.classChip}>
            <Icon name="timetable" size={14} color="#FFFFFF" />
            <Text variant="caption" tone="inherit" style={styles.classChipText}>
              {subject.className} · {subject.sectionName}
              {subject.enrollment?.rollNumber ? ` · Roll ${subject.enrollment.rollNumber}` : ''}
            </Text>
          </View>
        ) : null}
      </LinearGradient>

      <View style={styles.body}>
        {/* Where to be, right now. */}
        <Card
          elevation="md"
          onPress={actions.onOpenTimetable}
          accentColor={current?.subject.colorHex || colors.brand500}
        >
          {timetable.isPending ? (
            <ListSkeleton rows={1} />
          ) : current ? (
            <PeriodSummary slot={current} label="ON NOW" live />
          ) : next ? (
            <PeriodSummary slot={next} label="UP NEXT" />
          ) : (
            <View style={styles.freeDay}>
              <Icon name="success" size={20} tone="success" />
              <View style={styles.flex}>
                <Text variant="bodyStrong">
                  {today.length === 0 ? 'No classes today' : 'Classes are done for today'}
                </Text>
                <Text variant="caption" tone="muted">
                  {today.length > 0 ? `${today.length} periods completed` : 'Enjoy the day off'}
                </Text>
              </View>
            </View>
          )}
        </Card>

        <View style={styles.section}>
          {dashboard.isPending ? (
            <StatGridSkeleton />
          ) : dashboard.isError ? (
            <ErrorState error={dashboard.error} onRetry={onRefresh} compact />
          ) : (
            <StatGrid
              stats={dashboard.data?.stats ?? []}
              onSelect={(stat) => {
                if (stat.key === 'attendance') actions.onOpenAttendance();
                else if (stat.key === 'dues') actions.onOpenFees();
                else if (stat.key === 'homework') actions.onOpenHomework();
                else if (stat.key === 'unread') actions.onOpenNotifications();
              }}
            />
          )}
        </View>

        {dueSoon.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader
              title="Homework"
              subtitle="Due this week"
              actionLabel="See all"
              onAction={actions.onOpenHomework}
            />
            <View style={styles.stack}>
              {dueSoon.map((assignment) => {
                const days = daysUntil(assignment.dueAt);
                const overdue = days !== null && days < 0;

                return (
                  <Card
                    key={assignment.id}
                    elevation="none"
                    onPress={() => actions.onOpenAssignment(assignment.id)}
                    accentColor={assignment.subject.colorHex || colors.brand500}
                  >
                    <View style={styles.homeworkRow}>
                      <View style={styles.flex}>
                        <Text variant="bodyStrong" numberOfLines={1}>
                          {assignment.title}
                        </Text>
                        <Text variant="caption" tone="muted" numberOfLines={1}>
                          {assignment.subject.name} ·{' '}
                          {fullName(assignment.teacher.firstName, assignment.teacher.lastName)}
                        </Text>
                      </View>

                      <Badge
                        label={formatDueLabel(assignment.dueAt)}
                        tone={overdue ? 'danger' : days !== null && days <= 1 ? 'warning' : 'neutral'}
                      />
                    </View>
                  </Card>
                );
              })}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionHeader title="Quick access" />
          <View style={styles.quickGrid}>
            <QuickAction icon="timetable" label="Timetable" onPress={actions.onOpenTimetable} />
            <QuickAction icon="homework" label="Homework" onPress={actions.onOpenHomework} />
            <QuickAction icon="results" label="Results" onPress={actions.onOpenResults} />
            <QuickAction icon="attendance" label="Attendance" onPress={actions.onOpenAttendance} />
            <QuickAction icon="library" label="Library" onPress={actions.onOpenLibrary} />
            <QuickAction icon="fees" label="Fees" onPress={actions.onOpenFees} />
            <QuickAction icon="clock" label="Calendar" onPress={actions.onOpenCalendar} />
            <QuickAction icon="megaphone" label="Notices" onPress={actions.onOpenAnnouncements} />
          </View>
        </View>
      </View>
    </Screen>
  );
}

function PeriodSummary({
  slot,
  label,
  live = false,
}: {
  slot: TimetableSlotRow;
  label: string;
  live?: boolean;
}) {
  const { colors } = useTheme();
  const accent = slot.subject.colorHex || colors.brand500;

  return (
    <View>
      <View style={styles.periodLabelRow}>
        <Text variant="micro" tone="subtle">
          {label}
        </Text>
        {live ? (
          <View style={[styles.livePill, { backgroundColor: accent }]}>
            <Text variant="micro" tone="inherit" style={{ color: '#FFFFFF' }}>
              LIVE
            </Text>
          </View>
        ) : null}
      </View>

      <Text variant="title2" numberOfLines={1} style={{ marginTop: 2 }}>
        {slot.subject.name}
      </Text>

      <View style={styles.periodMeta}>
        <Icon name="clock" size={14} tone="subtle" />
        <Text variant="caption" tone="muted">
          {formatClock(slot.startTime)} – {formatClock(slot.endTime)}
        </Text>

        {slot.room ? (
          <>
            <Icon name="pin" size={14} tone="subtle" />
            <Text variant="caption" tone="muted">
              {slot.room.name}
            </Text>
          </>
        ) : null}

        {slot.teacher ? (
          <>
            <Icon name="profile" size={14} tone="subtle" />
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {fullName(slot.teacher.firstName, slot.teacher.lastName)}
            </Text>
          </>
        ) : null}
      </View>
    </View>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();

  return (
    <Card elevation="none" padded={false} onPress={onPress} style={styles.quickTile}>
      <View style={[styles.quickIcon, { backgroundColor: colors.brand50 }]}>
        <Icon name={icon} size={19} tone="brand" />
      </View>
      <Text variant="caption" weight="600" numberOfLines={1} align="center">
        {label}
      </Text>
    </Card>
  );
}

function toMinutes(value: string): number | null {
  const time = value.includes('T') ? value.slice(11, 16) : value.slice(0, 5);
  const [h, m] = time.split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function inWindow(minutes: number, start: string, end: string): boolean {
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === null || to === null) return false;
  return minutes >= from && minutes < to;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: radii['2xl'],
    borderBottomRightRadius: radii['2xl'],
    borderCurve: 'continuous',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  greeting: {
    color: 'rgba(255,255,255,0.8)',
  },
  headerName: {
    color: '#FFFFFF',
  },
  bell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  classChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs + 2,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  classChipText: {
    color: '#FFFFFF',
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  section: {
    marginTop: spacing.xl,
  },
  stack: {
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  periodLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  livePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  periodMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs + 2,
    marginTop: spacing.sm,
  },
  freeDay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  homeworkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  quickTile: {
    flexGrow: 1,
    flexBasis: '21%',
    minWidth: 76,
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  quickIcon: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
