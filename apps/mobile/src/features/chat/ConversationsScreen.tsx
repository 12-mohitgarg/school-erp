/**
 * Parent–teacher chat: thread list.
 *
 * The contact list the API returns is *derived from relationships that already
 * exist* — a parent can only reach the teachers who actually teach their
 * children. That means this screen never needs a directory search, and cannot
 * be used to enumerate staff.
 */

import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WS_EVENTS } from '@erp/shared';
import { communicationApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { useSocketEvent } from '@/core/realtime/SocketProvider';
import { formatRelative, fullName, humanise, truncate } from '@/core/utils/format';
import { useTheme } from '@/design/ThemeProvider';
import { radii, spacing } from '@/design/tokens';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ListSkeleton,
  Screen,
  Sheet,
  Text,
} from '@/design/components';
import type { ConversationRow, MessageRow } from '@/core/api/types';

export function ConversationsScreen({
  onOpenThread,
}: {
  onOpenThread: (conversationId: string, title: string) => void;
}) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);

  const query = useQuery({
    queryKey: qk.conversations(),
    queryFn: () => communicationApi.conversations(),
  });

  // A reply landing while the list is open should move the thread to the top.
  useSocketEvent<MessageRow>(WS_EVENTS.CHAT_MESSAGE, () => {
    void queryClient.invalidateQueries({ queryKey: qk.conversations() });
  });

  const onRefresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  if (query.isPending) {
    return (
      <Screen scroll>
        <ListSkeleton rows={5} showAvatar />
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

  const conversations = query.data ?? [];

  return (
    <Screen padded>
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        refreshing={query.isFetching}
        onRefresh={onRefresh}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <EmptyState
            icon="chat"
            title="No conversations yet"
            message="Start a conversation with your child's class teacher or a subject teacher."
            actionLabel="New message"
            onAction={() => setPickerOpen(true)}
          />
        }
        renderItem={({ item }) => (
          <ConversationCard
            conversation={item}
            onPress={() => onOpenThread(item.id, threadTitle(item))}
          />
        )}
      />

      {conversations.length > 0 ? (
        <Button
          label="New message"
          leading={<Icon name="send" size={16} tone="onBrand" />}
          onPress={() => setPickerOpen(true)}
          style={[styles.fab, { shadowColor: colors.shadow }]}
        />
      ) : null}

      <ContactPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onStarted={(conversationId, title) => {
          setPickerOpen(false);
          onOpenThread(conversationId, title);
        }}
      />
    </Screen>
  );
}

function threadTitle(conversation: ConversationRow): string {
  if (conversation.title) return conversation.title;
  const other = conversation.participants[0];
  return other ? fullName(other.firstName, other.lastName) : 'Conversation';
}

function ConversationCard({
  conversation,
  onPress,
}: {
  conversation: ConversationRow;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const other = conversation.participants[0];
  const title = threadTitle(conversation);
  const hasUnread = conversation.unreadCount > 0;

  return (
    <Card onPress={onPress} elevation={hasUnread ? 'sm' : 'none'}>
      <View style={styles.row}>
        <Avatar name={title} uri={other?.avatarUrl} size="md" />

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text variant={hasUnread ? 'bodyStrong' : 'body'} numberOfLines={1} style={styles.flex}>
              {title}
            </Text>
            <Text variant="micro" tone="subtle">
              {conversation.lastMessageAt
                ? formatRelative(conversation.lastMessageAt).toUpperCase()
                : ''}
            </Text>
          </View>

          {other ? (
            <Text variant="micro" tone="subtle" style={{ marginTop: 1 }}>
              {humanise(other.role).toUpperCase()}
            </Text>
          ) : null}

          <View style={styles.previewRow}>
            <Text
              variant="caption"
              tone={hasUnread ? 'default' : 'muted'}
              numberOfLines={1}
              style={styles.flex}
            >
              {conversation.lastMessagePreview
                ? truncate(conversation.lastMessagePreview, 70)
                : 'No messages yet'}
            </Text>

            {hasUnread ? (
              <View style={[styles.unreadPill, { backgroundColor: colors.brand600 }]}>
                <Text variant="micro" tone="inherit" style={{ color: colors.onBrand }}>
                  {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                </Text>
              </View>
            ) : null}

            {conversation.isLocked ? <Icon name="lock" size={13} tone="subtle" /> : null}
          </View>
        </View>
      </View>
    </Card>
  );
}

/**
 * Contact picker.
 *
 * `POST /conversations` reuses an existing 1:1 thread rather than creating a
 * duplicate, so tapping the same teacher twice reopens the conversation
 * instead of splitting the history in two.
 */
function ContactPickerSheet({
  visible,
  onClose,
  onStarted,
}: {
  visible: boolean;
  onClose: () => void;
  onStarted: (conversationId: string, title: string) => void;
}) {
  const queryClient = useQueryClient();

  const contacts = useQuery({
    queryKey: qk.contacts(),
    queryFn: () => communicationApi.contacts(),
    enabled: visible,
  });

  const start = useMutation({
    mutationFn: (userId: string) => communicationApi.startConversation([userId]),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.conversations() });
    },
  });

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="New message"
      subtitle="You can message the teachers connected to your child"
    >
      {contacts.isPending ? (
        <ListSkeleton rows={4} showAvatar />
      ) : contacts.isError ? (
        <ErrorState error={contacts.error} onRetry={() => void contacts.refetch()} compact />
      ) : (contacts.data ?? []).length === 0 ? (
        <EmptyState
          icon="chat"
          title="No contacts available"
          message="Your school has not linked any teachers to this account yet."
          compact
        />
      ) : (
        (contacts.data ?? []).map((contact) => (
          <Card
            key={contact.userId}
            elevation="none"
            onPress={() => {
              start.mutate(contact.userId, {
                onSuccess: (conversation) => onStarted(conversation.id, contact.name),
              });
            }}
          >
            <View style={styles.row}>
              <Avatar name={contact.name} size="sm" />
              <View style={styles.body}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {contact.name}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {contact.detail || humanise(contact.role)}
                </Text>
              </View>
              <Icon name="forward" size={16} tone="subtle" />
            </View>
          </Card>
        ))
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingTop: spacing.lg,
    paddingBottom: spacing['5xl'] + spacing['3xl'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  body: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  unreadPill: {
    minWidth: 20,
    height: 20,
    borderRadius: radii.pill,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xl,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 6,
  },
});
