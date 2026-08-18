/**
 * A conversation.
 *
 * Messages arrive over the socket, so an open thread updates without polling.
 * Sending is optimistic — the bubble appears immediately and is reconciled
 * when the server answers — because a chat that waits 300ms per message before
 * showing anything feels broken even when it is working perfectly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WS_EVENTS } from '@erp/shared';
import { communicationApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { useSocketEvent } from '@/core/realtime/SocketProvider';
import { useAuth } from '@/core/auth/AuthProvider';
import { formatDayLabel, formatTime, fullName } from '@/core/utils/format';
import { useTheme } from '@/design/ThemeProvider';
import { radii, spacing } from '@/design/tokens';
import {
  Avatar,
  Banner,
  EmptyState,
  ErrorState,
  Icon,
  ListSkeleton,
  Screen,
  Text,
} from '@/design/components';
import type { ConversationRow, MessageRow } from '@/core/api/types';

/** A message the user has sent but the server has not yet confirmed. */
interface PendingMessage {
  localId: string;
  body: string;
  createdAt: string;
  failed: boolean;
}

export function ChatThreadScreen({ conversationId }: { conversationId: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const listRef = useRef<FlatList<ChatItem>>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingMessage[]>([]);

  const query = useQuery({
    queryKey: qk.messages(conversationId),
    queryFn: () => communicationApi.messages(conversationId, 1, 60),
  });

  /** Joins the socket room so replies arrive without a refetch. */
  useEffect(() => {
    void communicationApi.subscribeConversation(conversationId).catch(() => undefined);
  }, [conversationId]);

  useSocketEvent<MessageRow>(
    WS_EVENTS.CHAT_MESSAGE,
    (message) => {
      if (message.conversationId !== conversationId) return;
      void queryClient.invalidateQueries({ queryKey: qk.messages(conversationId) });
      void queryClient.invalidateQueries({ queryKey: qk.conversations() });
    },
    true,
  );

  const send = useMutation({
    mutationFn: (body: string) => communicationApi.sendMessage(conversationId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.messages(conversationId) });
      void queryClient.invalidateQueries({ queryKey: qk.conversations() });
    },
  });

  const submit = useCallback(() => {
    const body = draft.trim();
    if (body.length === 0 || send.isPending) return;

    const localId = `local-${Date.now()}`;
    setPending((prev) => [
      ...prev,
      { localId, body, createdAt: new Date().toISOString(), failed: false },
    ]);
    setDraft('');

    send.mutate(body, {
      onSuccess: () => setPending((prev) => prev.filter((p) => p.localId !== localId)),
      onError: () =>
        setPending((prev) =>
          prev.map((p) => (p.localId === localId ? { ...p, failed: true } : p)),
        ),
    });
  }, [draft, send]);

  const retry = useCallback(
    (message: PendingMessage) => {
      setPending((prev) =>
        prev.map((p) => (p.localId === message.localId ? { ...p, failed: false } : p)),
      );
      send.mutate(message.body, {
        onSuccess: () =>
          setPending((prev) => prev.filter((p) => p.localId !== message.localId)),
        onError: () =>
          setPending((prev) =>
            prev.map((p) => (p.localId === message.localId ? { ...p, failed: true } : p)),
          ),
      });
    },
    [send],
  );

  /**
   * Server messages plus anything still in flight, with a date separator
   * inserted whenever the day changes. Built once per data change rather than
   * per render — a 60-message thread re-deriving on every keystroke is the
   * classic reason a chat input drops characters.
   */
  const items = useMemo<ChatItem[]>(
    () => buildChatItems(query.data?.items ?? [], pending),
    [query.data, pending],
  );

  /**
   * Whether a moderator has closed the thread. Read from the already-cached
   * conversation list rather than fetched again — the server rejects a post to
   * a locked thread regardless, so this only decides whether we show a
   * composer the user cannot use.
   */
  const locked = useMemo(() => {
    const cached = queryClient.getQueryData<ConversationRow[]>(qk.conversations());
    return cached?.find((c) => c.id === conversationId)?.isLocked ?? false;
  }, [queryClient, conversationId]);

  if (query.isPending) {
    return (
      <Screen scroll>
        <ListSkeleton rows={6} showAvatar />
      </Screen>
    );
  }

  if (query.isError) {
    return (
      <Screen scroll>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
    >
      <Screen padded={false}>
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(item) => item.key}
          // `inverted` keeps the newest message pinned to the bottom without a
          // scrollToEnd race every time the keyboard opens.
          inverted
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="chat"
                title="No messages yet"
                message="Send the first message. Your school moderates these conversations."
              />
            </View>
          }
          renderItem={({ item }) =>
            item.kind === 'separator' ? (
              <View style={styles.separator}>
                <Text variant="micro" tone="subtle">
                  {item.label.toUpperCase()}
                </Text>
              </View>
            ) : (
              <MessageBubble
                item={item}
                isOwn={item.senderId === user?.id}
                onRetry={item.pending?.failed ? () => retry(item.pending!) : undefined}
              />
            )
          }
        />

        <View
          style={[
            styles.composer,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.hairline,
              paddingBottom: insets.bottom + spacing.sm,
            },
          ]}
        >
          {locked ? (
            <Banner
              tone="warning"
              icon="lock"
              title="This conversation is closed"
              message="A moderator has locked the thread. Contact the school office."
            />
          ) : (
            <View style={styles.composerRow}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Write a message…"
                placeholderTextColor={colors.inkSubtle}
                selectionColor={colors.brand500}
                multiline
                maxLength={5000}
                accessibilityLabel="Message"
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.surfaceSunken,
                    color: colors.ink,
                  },
                ]}
              />

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                accessibilityState={{ disabled: draft.trim().length === 0 }}
                disabled={draft.trim().length === 0 || send.isPending}
                onPress={submit}
                style={({ pressed }) => [
                  styles.sendButton,
                  {
                    backgroundColor:
                      draft.trim().length === 0 ? colors.surfaceSunken : colors.brand600,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Icon
                  name="send"
                  size={18}
                  color={draft.trim().length === 0 ? colors.inkSubtle : colors.onBrand}
                />
              </Pressable>
            </View>
          )}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Message list model
// ---------------------------------------------------------------------------

type ChatItem =
  | { kind: 'separator'; key: string; label: string }
  | {
      kind: 'message';
      key: string;
      body: string;
      createdAt: string;
      senderId: string | null;
      senderName: string;
      avatarUrl: string | null;
      pending?: PendingMessage;
    };

function buildChatItems(messages: MessageRow[], pending: PendingMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  let lastDay: string | null = null;

  for (const message of messages) {
    const day = message.createdAt.slice(0, 10);
    if (day !== lastDay) {
      items.push({
        kind: 'separator',
        key: `sep-${day}`,
        label: formatDayLabel(message.createdAt),
      });
      lastDay = day;
    }

    items.push({
      kind: 'message',
      key: message.id,
      body: message.body,
      createdAt: message.createdAt,
      senderId: message.sender.id,
      senderName: fullName(message.sender.firstName, message.sender.lastName),
      avatarUrl: message.sender.avatarUrl,
    });
  }

  for (const p of pending) {
    items.push({
      kind: 'message',
      key: p.localId,
      body: p.body,
      createdAt: p.createdAt,
      // Null marks it as ours without needing the user object here.
      senderId: null,
      senderName: 'You',
      avatarUrl: null,
      pending: p,
    });
  }

  // The list renders inverted, so newest must come first.
  return items.reverse();
}

function MessageBubble({
  item,
  isOwn,
  onRetry,
}: {
  item: Extract<ChatItem, { kind: 'message' }>;
  isOwn: boolean;
  onRetry?: () => void;
}) {
  const { colors } = useTheme();
  const own = isOwn || item.pending !== undefined;

  return (
    <View style={[styles.bubbleRow, own ? styles.bubbleRowOwn : null]}>
      {!own ? <Avatar name={item.senderName} uri={item.avatarUrl} size="xs" /> : null}

      <View style={styles.bubbleColumn}>
        {!own ? (
          <Text variant="micro" tone="subtle" style={styles.senderName}>
            {item.senderName}
          </Text>
        ) : null}

        <View
          style={[
            styles.bubble,
            own
              ? { backgroundColor: colors.brand600, borderBottomRightRadius: 4 }
              : {
                  backgroundColor: colors.surface,
                  borderBottomLeftRadius: 4,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.hairline,
                },
          ]}
        >
          <Text
            variant="body"
            tone="inherit"
            style={{ color: own ? colors.onBrand : colors.ink }}
          >
            {item.body}
          </Text>
        </View>

        <View style={[styles.bubbleMeta, own ? styles.bubbleMetaOwn : null]}>
          <Text variant="micro" tone="subtle">
            {item.pending && !item.pending.failed ? 'Sending…' : formatTime(item.createdAt)}
          </Text>

          {onRetry ? (
            <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8}>
              <Text variant="micro" tone="danger" weight="600">
                NOT SENT · TAP TO RETRY
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  emptyWrap: {
    // The list is inverted, so an empty state has to be flipped back upright.
    transform: [{ scaleY: -1 }],
    paddingVertical: spacing['3xl'],
  },
  separator: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    maxWidth: '100%',
  },
  bubbleRowOwn: {
    justifyContent: 'flex-end',
  },
  bubbleColumn: {
    maxWidth: '82%',
  },
  senderName: {
    marginBottom: 3,
    marginLeft: spacing.xs,
  },
  bubble: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
  },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 3,
    marginLeft: spacing.xs,
  },
  bubbleMetaOwn: {
    justifyContent: 'flex-end',
    marginRight: spacing.xs,
  },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 130,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.sm + 2,
    fontSize: 15,
    lineHeight: 21,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
