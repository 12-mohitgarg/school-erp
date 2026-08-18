/**
 * Parent home.
 *
 * The aggregator the workflow diagram describes: *"Build Parent App as an
 * aggregator — parent consumes verified data from attendance, academics, fees,
 * communication and transport/GPS."*
 *
 * The layout answers, in order, the four things a guardian opens the app for:
 * where is the bus, what does the school need from me, how is my child doing,
 * and what is new. Anything that is not one of those is a tap away, not on the
 * screen.
 */

import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { WS_EVENTS, type LiveVehicleState } from '@erp/shared';
import { communicationApi, dashboardApi, trackingApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { useAuth } from '@/core/auth/AuthProvider';
import { useSocket, useSocketEvent } from '@/core/realtime/SocketProvider';
import { formatDuration, formatTime } from '@/core/utils/format';
import { ChildSwitcherSheet } from '@/features/account/ChildSwitcherSheet';
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

export interface ParentHomeActions {
  onOpenTracking: () => void;
  onOpenAttendance: () => void;
  onOpenResults: () => void;
  onOpenHomework: () => void;
  onOpenFees: () => void;
  onOpenMessages: () => void;
  onOpenAnnouncements: () => void;
  onOpenNotifications: () => void;
  onOpenTimetable: () => void;
  onOpenLibrary: () => void;
}

export function ParentHomeScreen(actions: ParentHomeActions) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, activeChild, children, subjectStudentId } = useAuth();
  const { connection } = useSocket();

  const [switcherOpen, setSwitcherOpen] = useState(false);

  const dashboard = useQuery({
    queryKey: qk.dashboard(),
    queryFn: () => dashboardApi.get(),
  });

  const notifications = useQuery({
    queryKey: qk.notifications(),
    queryFn: () => communicationApi.notifications(1, 5, true),
  });

  /** A compact live card, so the bus is visible without opening the map tab. */
  const live = useQuery({
    queryKey: qk.live(subjectStudentId ?? 'none'),
    queryFn: () => trackingApi.studentLive(subjectStudentId!),
    enabled: Boolean(subjectStudentId) && (activeChild?.canViewLocation ?? false),
    refetchInterval: 60_000,
  });

  useSocketEvent<LiveVehicleState>(WS_EVENTS.LOCATION_UPDATE, () => {
    void live.refetch();
  }, Boolean(subjectStudentId));

  const onRefresh = useCallback(() => {
    void dashboard.refetch();
    void notifications.refetch();
    void live.refetch();
  }, [dashboard, notifications, live]);

  const tracked = live.data?.tracked ? live.data : null;
  const myStop = tracked?.stops.find((s) => s.stopId === tracked.myStop?.id);
  const unreadCount = notifications.data?.items.length ?? 0;

  return (
    <Screen
      scroll
      padded={false}
      onRefresh={onRefresh}
      refreshing={dashboard.isFetching}
      contentContainerStyle={{ paddingTop: 0 }}
    >
      {/* Greeting + child selector. The selected child is stated at the top of
          the app at all times, because every figure below depends on it and a
          guardian reading the wrong child's attendance is a real failure. */}
      <LinearGradient
        colors={[colors.brand700, colors.brand500]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + spacing.lg }]}
      >
        <View style={styles.headerTop}>
          <View style={styles.flex}>
            <Text variant="caption" tone="inherit" style={styles.greeting}>
              {greeting()}
            </Text>
            <Text variant="title2" tone="inherit" style={styles.headerName} numberOfLines={1}>
              {user?.firstName ?? 'Welcome'}
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

        {activeChild ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Viewing ${activeChild.fullName}. Tap to switch child.`}
            onPress={children.length > 1 ? () => setSwitcherOpen(true) : undefined}
            style={styles.childCard}
          >
            <Avatar name={activeChild.fullName} uri={activeChild.avatarUrl} size="md" />

            <View style={styles.flex}>
              <Text variant="bodyStrong" tone="inherit" style={styles.childName} numberOfLines={1}>
                {activeChild.fullName}
              </Text>
              <Text variant="caption" tone="inherit" style={styles.childClass} numberOfLines={1}>
                {activeChild.className} · {activeChild.sectionName} · {activeChild.admissionNo}
              </Text>
            </View>

            {children.length > 1 ? (
              <View style={styles.switchChip}>
                <Icon name="swap" size={14} color="#FFFFFF" />
                <Text variant="micro" tone="inherit" style={{ color: '#FFFFFF' }}>
                  SWITCH
                </Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
      </LinearGradient>

      <View style={styles.body}>
        {/* Where is the bus — the first question, so the first card. */}
        {activeChild?.canViewLocation ? (
          <Card
            elevation="md"
            onPress={actions.onOpenTracking}
            accentColor={tracked?.trip ? colors.success : colors.brand500}
          >
            <View style={styles.liveHeader}>
              <View style={[styles.livePuck, { backgroundColor: colors.brand50 }]}>
                <Icon name="trip" size={20} tone="brand" />
              </View>

              <View style={styles.flex}>
                <Text variant="bodyStrong">
                  {tracked?.trip
                    ? tracked.trip.direction === 'PICKUP'
                      ? 'On the way to school'
                      : 'On the way home'
                    : tracked
                      ? 'No trip running'
                      : 'Bus tracking'}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {tracked?.vehicle
                    ? `${tracked.vehicle.registrationNo} · ${tracked.route.name}`
                    : live.isPending
                      ? 'Checking…'
                      : 'Not allocated to a route'}
                </Text>
              </View>

              {tracked?.trip ? (
                <Badge
                  label={connection === 'live' ? 'Live' : 'Reconnecting'}
                  tone={connection === 'live' ? 'success' : 'warning'}
                  variant="solid"
                  dot
                />
              ) : null}
            </View>

            {myStop && !myStop.reached && myStop.etaMinutes !== null ? (
              <View style={[styles.etaStrip, { backgroundColor: colors.brand50 }]}>
                <Icon name="clock" size={15} tone="brand" />
                <Text variant="callout" tone="brand" weight="600" style={styles.flex}>
                  {`Arriving at ${myStop.stopName} in ${formatDuration(myStop.etaMinutes)}`}
                </Text>
                <Text variant="caption" tone="brand">
                  {formatTime(myStop.etaAt)}
                </Text>
              </View>
            ) : myStop?.reached ? (
              <View style={[styles.etaStrip, { backgroundColor: colors.successSoft }]}>
                <Icon name="success" size={15} tone="success" />
                <Text variant="callout" tone="success" weight="600" style={styles.flex}>
                  {`Reached ${myStop.stopName} at ${formatTime(myStop.reachedAt)}`}
                </Text>
              </View>
            ) : null}
          </Card>
        ) : null}

        {/* The KPI row the server chose for this role. */}
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

        <View style={styles.section}>
          <SectionHeader title="Quick access" />
          <View style={styles.quickGrid}>
            <QuickAction icon="attendance" label="Attendance" onPress={actions.onOpenAttendance} />
            <QuickAction icon="results" label="Results" onPress={actions.onOpenResults} />
            <QuickAction icon="homework" label="Homework" onPress={actions.onOpenHomework} />
            <QuickAction icon="fees" label="Fees" onPress={actions.onOpenFees} />
            <QuickAction icon="timetable" label="Timetable" onPress={actions.onOpenTimetable} />
            <QuickAction icon="chat" label="Messages" onPress={actions.onOpenMessages} />
            <QuickAction icon="library" label="Library" onPress={actions.onOpenLibrary} />
            <QuickAction
              icon="megaphone"
              label="Notices"
              onPress={actions.onOpenAnnouncements}
            />
          </View>
        </View>

        {/* What is new — unread only, capped. A home screen that lists every
            notification is a second inbox. */}
        <View style={styles.section}>
          <SectionHeader
            title="Needs your attention"
            actionLabel={unreadCount > 0 ? 'See all' : undefined}
            onAction={unreadCount > 0 ? actions.onOpenNotifications : undefined}
          />

          {notifications.isPending ? (
            <ListSkeleton rows={2} />
          ) : unreadCount === 0 ? (
            <Card elevation="none">
              <View style={styles.allClear}>
                <Icon name="success" size={18} tone="success" />
                <Text variant="callout" tone="muted" style={styles.flex}>
                  Nothing needs your attention right now.
                </Text>
              </View>
            </Card>
          ) : (
            <View style={styles.stack}>
              {(notifications.data?.items ?? []).slice(0, 4).map((item) => (
                <Card key={item.id} elevation="none" onPress={actions.onOpenNotifications}>
                  <View style={styles.notificationRow}>
                    <View
                      style={[
                        styles.notificationDot,
                        {
                          backgroundColor:
                            item.priority === 'EMERGENCY' ? colors.danger : colors.brand500,
                        },
                      ]}
                    />
                    <View style={styles.flex}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text variant="caption" tone="muted" numberOfLines={2}>
                        {item.body}
                      </Text>
                    </View>
                  </View>
                </Card>
              ))}
            </View>
          )}
        </View>
      </View>

      <ChildSwitcherSheet visible={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </Screen>
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
  childCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  childName: {
    color: '#FFFFFF',
  },
  childClass: {
    color: 'rgba(255,255,255,0.82)',
    marginTop: 1,
  },
  switchChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.22)',
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
  liveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  livePuck: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  etaStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    marginTop: spacing.md,
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
  allClear: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  notificationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
});
