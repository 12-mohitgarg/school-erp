/**
 * Notification inbox.
 *
 * The in-app inbox is the *reliable* channel — push can be declined, delayed
 * by the OS, or silenced by a Do-Not-Disturb schedule, and the server's own
 * notification service treats IN_APP as always-delivered for exactly that
 * reason. So this screen is the source of truth, and it is where a deep link
 * from a push lands.
 */

import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WS_EVENTS, type NotificationPayload } from '@erp/shared';
import { communicationApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { useSocketEvent } from '@/core/realtime/SocketProvider';
import { setBadgeCount } from '@/core/push/push';
import { formatRelative } from '@/core/utils/format';
import { useTheme } from '@/design/ThemeProvider';
import { radii, spacing } from '@/design/tokens';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ListSkeleton,
  Screen,
  SegmentedControl,
  Text,
  type IconName,
} from '@/design/components';
import type { NotificationRow } from '@/core/api/types';

type Filter = 'all' | 'unread';

/** Maps the notification's originating module onto its icon and accent. */
const MODULE_STYLE: Record<string, { icon: IconName; tone: 'brand' | 'warning' | 'danger' | 'success' | 'info' }> = {
  tracking: { icon: 'map', tone: 'brand' },
  transport: { icon: 'trip', tone: 'brand' },
  attendance: { icon: 'attendance', tone: 'warning' },
  fees: { icon: 'fees', tone: 'warning' },
  examination: { icon: 'results', tone: 'info' },
  communication: { icon: 'megaphone', tone: 'info' },
  library: { icon: 'library', tone: 'info' },
};

export function NotificationsScreen({
  onOpen,
}: {
  /** Deep-links into the screen a notification refers to. */
  onOpen?: (notification: NotificationRow) => void;
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');

  const query = useQuery({
    queryKey: qk.notifications(),
    queryFn: () => communicationApi.notifications(1, 50),
  });

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => communicationApi.markNotificationsRead(ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.notifications() });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard() });
    },
  });

  /**
   * A notification that arrives while this screen is open should appear, not
   * wait for the next pull-to-refresh — that is the whole promise of the live
   * socket, and it is a two-line refetch.
   */
  useSocketEvent<NotificationPayload>(WS_EVENTS.NOTIFICATION, () => {
    void queryClient.invalidateQueries({ queryKey: qk.notifications() });
  });

  /**
   * Memoised on `query.data` rather than on a `?? []` fallback: the fallback
   * is a fresh array literal on every render, so it would defeat the memo and
   * re-filter the whole list on each keystroke elsewhere on the screen.
   */
  const all = useMemo(() => query.data?.items ?? [], [query.data]);
  const unread = useMemo(() => all.filter((n) => !n.readAt), [all]);
  const visible = filter === 'unread' ? unread : all;

  const onRefresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  const openOne = useCallback(
    (notification: NotificationRow) => {
      if (!notification.readAt) {
        markRead.mutate([notification.id]);
        void setBadgeCount(Math.max(0, unread.length - 1));
      }
      onOpen?.(notification);
    },
    [markRead, onOpen, unread.length],
  );

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

  return (
    <Screen padded>
      <View style={styles.toolbar}>
        <SegmentedControl<Filter>
          segments={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: 'Unread', count: unread.length },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>

      {unread.length > 0 ? (
        <Button
          label={`Mark all ${unread.length} as read`}
          variant="ghost"
          size="sm"
          onPress={() => {
            markRead.mutate(undefined);
            void setBadgeCount(0);
          }}
          loading={markRead.isPending}
          style={styles.markAll}
        />
      ) : null}

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
            icon="bell"
            title={filter === 'unread' ? 'Nothing unread' : 'No notifications yet'}
            message={
              filter === 'unread'
                ? 'You are all caught up.'
                : 'Attendance alerts, fee reminders, bus updates and school announcements will appear here.'
            }
          />
        }
        renderItem={({ item }) => (
          <NotificationCard notification={item} onPress={() => openOne(item)} />
        )}
      />
    </Screen>
  );
}

function NotificationCard({
  notification,
  onPress,
}: {
  notification: NotificationRow;
  onPress: () => void;
}) {
  const { colors } = useTheme();

  const isEmergency = notification.priority === 'EMERGENCY';
  const style = MODULE_STYLE[notification.module ?? ''] ?? { icon: 'bell' as IconName, tone: 'brand' as const };

  const accent = isEmergency
    ? colors.danger
    : notification.readAt
      ? undefined
      : colors.brand500;

  return (
    <Card onPress={onPress} accentColor={accent} elevation={notification.readAt ? 'none' : 'sm'}>
      <View style={styles.row}>
        <View
          style={[
            styles.puck,
            { backgroundColor: isEmergency ? colors.dangerSoft : colors.surfaceSunken },
          ]}
        >
          <Icon
            name={isEmergency ? 'sos' : style.icon}
            size={18}
            tone={isEmergency ? 'danger' : style.tone}
          />
        </View>

        <View style={styles.body}>
          <Text variant={notification.readAt ? 'body' : 'bodyStrong'} numberOfLines={2}>
            {notification.title}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={3} style={styles.snippet}>
            {notification.body}
          </Text>

          <View style={styles.metaRow}>
            <Text variant="micro" tone="subtle">
              {formatRelative(notification.createdAt).toUpperCase()}
            </Text>
            {isEmergency ? (
              <Text variant="micro" tone="danger">
                EMERGENCY
              </Text>
            ) : null}
          </View>
        </View>

        {!notification.readAt ? (
          <View style={[styles.unreadDot, { backgroundColor: colors.brand500 }]} />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    paddingTop: spacing.md,
  },
  markAll: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
  },
  list: {
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  puck: {
    width: 38,
    height: 38,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  snippet: {
    marginTop: 3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
});
