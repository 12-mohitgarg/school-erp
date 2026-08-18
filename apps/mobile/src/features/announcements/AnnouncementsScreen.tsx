/**
 * School announcements.
 *
 * Distinct from the notification inbox: a notification is addressed to *you*
 * and can be cleared, an announcement is published to an audience and stays.
 * Pinned items hold the top of the list because that is what pinning is for,
 * and the API already sorts them first.
 */

import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { communicationApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { formatDayLabel, fullName, humanise } from '@/core/utils/format';
import { useTheme } from '@/design/ThemeProvider';
import { spacing } from '@/design/tokens';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ListSkeleton,
  Screen,
  Sheet,
  Text,
  statusTone,
} from '@/design/components';
import type { AnnouncementRow } from '@/core/api/types';

/** Category → badge tone. Urgent and fee notices should not look like an event. */
function categoryTone(category: string): Parameters<typeof Badge>[0]['tone'] {
  switch (category) {
    case 'URGENT':
      return 'danger';
    case 'FEE':
      return 'warning';
    case 'EXAM':
    case 'ACADEMIC':
      return 'info';
    case 'EVENT':
    case 'HOLIDAY':
      return 'success';
    default:
      return 'neutral';
  }
}

export function AnnouncementsScreen() {
  const [selected, setSelected] = useState<AnnouncementRow | null>(null);

  const query = useQuery({
    queryKey: qk.announcements(),
    queryFn: () => communicationApi.announcements(1, 30),
  });

  /**
   * Read receipts. Fire-and-forget: the school wants to know an announcement
   * was opened, but a failed receipt must never stop the parent reading it.
   */
  const markRead = useMutation({
    mutationFn: (id: string) => communicationApi.markAnnouncementRead(id),
  });

  const open = useCallback(
    (announcement: AnnouncementRow) => {
      setSelected(announcement);
      markRead.mutate(announcement.id);
    },
    [markRead],
  );

  const onRefresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  if (query.isPending) {
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

  const items = query.data?.items ?? [];

  return (
    <Screen padded>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshing={query.isFetching}
        onRefresh={onRefresh}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <EmptyState
            icon="megaphone"
            title="No announcements"
            message="Notices from the school office and your class teachers will appear here."
          />
        }
        renderItem={({ item }) => (
          <AnnouncementCard announcement={item} onPress={() => open(item)} />
        )}
      />

      <AnnouncementSheet announcement={selected} onClose={() => setSelected(null)} />
    </Screen>
  );
}

function AnnouncementCard({
  announcement,
  onPress,
}: {
  announcement: AnnouncementRow;
  onPress: () => void;
}) {
  const { colors } = useTheme();

  const accent =
    announcement.priority === 'EMERGENCY' || announcement.category === 'URGENT'
      ? colors.danger
      : announcement.isPinned
        ? colors.brand500
        : undefined;

  return (
    <Card onPress={onPress} accentColor={accent}>
      <View style={styles.cardHeader}>
        <Badge label={humanise(announcement.category)} tone={categoryTone(announcement.category)} />
        {announcement.isPinned ? (
          <View style={styles.pinned}>
            <Icon name="pin" size={12} tone="brand" />
            <Text variant="micro" tone="brand">
              PINNED
            </Text>
          </View>
        ) : null}
        <View style={styles.flexSpacer} />
        <Text variant="micro" tone="subtle">
          {formatDayLabel(announcement.publishAt ?? announcement.createdAt).toUpperCase()}
        </Text>
      </View>

      <Text variant="title3" numberOfLines={2} style={{ marginTop: spacing.md }}>
        {announcement.title}
      </Text>

      <Text variant="callout" tone="muted" numberOfLines={3} style={{ marginTop: spacing.xs }}>
        {announcement.body}
      </Text>

      <View style={styles.cardFooter}>
        <Icon name="profile" size={13} tone="subtle" />
        <Text variant="caption" tone="subtle" numberOfLines={1}>
          {announcement.author
            ? `${fullName(announcement.author.firstName, announcement.author.lastName)} · ${humanise(announcement.author.role)}`
            : 'School office'}
        </Text>

        {announcement.attachmentUrls.length > 0 ? (
          <>
            <View style={styles.flexSpacer} />
            <Icon name="attach" size={13} tone="subtle" />
            <Text variant="caption" tone="subtle">
              {announcement.attachmentUrls.length}
            </Text>
          </>
        ) : null}
      </View>
    </Card>
  );
}

/**
 * Full text in a sheet rather than a pushed route: an announcement is read and
 * dismissed, and a modal returns the reader to their place in the list without
 * a navigation animation in each direction.
 */
function AnnouncementSheet({
  announcement,
  onClose,
}: {
  announcement: AnnouncementRow | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      visible={announcement !== null}
      onClose={onClose}
      title={announcement?.title}
      subtitle={
        announcement
          ? `${formatDayLabel(announcement.publishAt ?? announcement.createdAt)} · ${humanise(announcement.category)}`
          : undefined
      }
    >
      {announcement ? (
        <>
          <View style={styles.sheetMeta}>
            <Badge
              label={humanise(announcement.priority)}
              tone={statusTone(announcement.priority)}
            />
            <Badge label={humanise(announcement.audienceType)} tone="neutral" />
          </View>

          <Text variant="body" style={{ marginTop: spacing.lg }}>
            {announcement.body}
          </Text>

          {announcement.author ? (
            <Text variant="caption" tone="subtle" style={{ marginTop: spacing.xl }}>
              Posted by {fullName(announcement.author.firstName, announcement.author.lastName)} ·{' '}
              {humanise(announcement.author.role)}
            </Text>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pinned: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  flexSpacer: {
    flex: 1,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    marginTop: spacing.lg,
  },
  sheetMeta: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
