import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCheck, MessageSquare, Plus, Search, Send, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import {
  useConversationsQuery, useMessagesQuery, useSendMessageMutation,
  useContactsQuery, useStartConversationMutation,
} from '@/features/communication/communicationApi';
import { useConversationStream } from '@/lib/useRealtime';
import { useAppSelector } from '@/store';
import { errorMessage } from '@/lib/api';
import { Combobox } from '@/components/forms/Combobox';
import { Avatar, Button, Card, EmptyState, Modal, Spinner } from '@/components/ui';
import { cn, initials, relativeTime } from '@/lib/utils';

interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  conversationId?: string;
  sender: { id: string; firstName: string; lastName: string; role: string; avatarUrl: string | null };
  /** Set on optimistic messages until the server confirms them. */
  pending?: boolean;
}

/** "Today", "Yesterday", or a date — the separator between message groups. */
function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';

  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function ChatPanel() {
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? '');

  const { data: conversations, isLoading: loadingThreads } = useConversationsQuery();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [threadSearch, setThreadSearch] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [contactId, setContactId] = useState('');
  /** Messages that arrived over the socket or were sent optimistically. */
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);

  const [send, { isLoading: sending }] = useSendMessageMutation();
  const [startConversation, { isLoading: starting }] = useStartConversationMutation();

  const { data: contacts } = useContactsQuery(undefined, { skip: !composeOpen });
  const { data: fetched, isFetching: loadingMessages } = useMessagesQuery(
    { conversationId: activeId ?? '' },
    { skip: !activeId },
  );

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Switching threads clears anything appended for the previous one.
  useEffect(() => {
    setLiveMessages([]);
  }, [activeId]);

  useConversationStream(activeId, (incoming) => {
    const message = incoming as unknown as ChatMessage;
    setLiveMessages((prev) => {
      // The socket echoes our own send back; replace the optimistic copy
      // rather than showing the message twice.
      const withoutPending = prev.filter(
        (m) => !(m.pending && m.sender.id === message.sender.id && m.body === message.body),
      );
      if (withoutPending.some((m) => m.id === message.id)) return withoutPending;
      return [...withoutPending, message];
    });
  });

  const messages = useMemo<ChatMessage[]>(() => {
    const persisted = (fetched?.items ?? []) as unknown as ChatMessage[];
    const seen = new Set(persisted.map((m) => m.id));
    return [...persisted, ...liveMessages.filter((m) => !seen.has(m.id))];
  }, [fetched, liveMessages]);

  // Keep the newest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: messages.length > 0 ? 'smooth' : 'auto' });
  }, [messages.length]);

  const threads = useMemo(() => {
    const list = (conversations ?? []) as Array<Record<string, unknown>>;
    const q = threadSearch.trim().toLowerCase();
    if (!q) return list;

    return list.filter((c) => {
      const people = (c['participants'] ?? []) as Array<{ firstName: string; lastName: string }>;
      const name = people.map((p) => `${p.firstName} ${p.lastName}`).join(' ').toLowerCase();
      return name.includes(q) || String(c['lastMessagePreview'] ?? '').toLowerCase().includes(q);
    });
  }, [conversations, threadSearch]);

  const activeThread = (conversations ?? []).find(
    (c) => String((c as Record<string, unknown>)['id']) === activeId,
  ) as Record<string, unknown> | undefined;

  const counterpart = (() => {
    const people = (activeThread?.['participants'] ?? []) as Array<{
      firstName: string; lastName: string; role: string;
    }>;
    return people[0];
  })();

  async function submit() {
    const body = draft.trim();
    if (!activeId || !body) return;

    // Show it immediately; a 300ms round trip before the bubble appears makes
    // the app feel broken next to any real messenger.
    const optimistic: ChatMessage = {
      id: `pending-${Date.now()}`,
      body,
      createdAt: new Date().toISOString(),
      sender: { id: currentUserId, firstName: 'You', lastName: '', role: '', avatarUrl: null },
      pending: true,
    };

    setLiveMessages((prev) => [...prev, optimistic]);
    setDraft('');
    inputRef.current?.focus();

    try {
      await send({ conversationId: activeId, body }).unwrap();
    } catch (err) {
      setLiveMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(body);
      toast.error('Message not sent', { description: errorMessage(err) });
    }
  }

  async function beginConversation() {
    if (!contactId) return;
    try {
      const conversation = await startConversation({ participantUserIds: [contactId] }).unwrap();
      setActiveId(conversation.id);
      setComposeOpen(false);
      setContactId('');
    } catch (err) {
      toast.error('Could not start the conversation', { description: errorMessage(err) });
    }
  }

  const composeDialog = (
    <Modal
      open={composeOpen}
      onClose={() => setComposeOpen(false)}
      title="New conversation"
      description="You can message the teachers and guardians connected to you."
      footer={
        <>
          <Button variant="ghost" onClick={() => setComposeOpen(false)}>Cancel</Button>
          <Button onClick={beginConversation} loading={starting} disabled={!contactId}>
            Start conversation
          </Button>
        </>
      }
    >
      <Combobox
        label="Send to"
        required
        value={contactId}
        onChange={setContactId}
        items={(contacts ?? []).map((c) => ({ value: c.userId, label: c.name, detail: c.detail }))}
        placeholder="Search by name…"
        emptyMessage="Nobody is connected to you yet"
        loading={!contacts}
      />
    </Modal>
  );

  return (
    <>
      {composeDialog}

      {/*
        `dvh` rather than `vh` so the panel accounts for mobile browser chrome
        that appears and disappears on scroll. No `min-h` on small screens —
        forcing one taller than the viewport made the whole page scroll.
      */}
      <Card className="grid h-[calc(100dvh-12rem)] grid-cols-1 overflow-hidden sm:min-h-[26rem] md:grid-cols-[18rem_1fr] lg:grid-cols-[20rem_1fr]">
        {/* Thread list — hidden on mobile once a thread is open. */}
        <aside
          className={cn(
            'flex min-h-0 flex-col border-hairline md:border-r',
            activeId && 'hidden md:flex',
          )}
        >
          <div className="shrink-0 space-y-3 border-b border-hairline p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">Conversations</h2>
              <Button size="xs" onClick={() => setComposeOpen(true)} leftIcon={<Plus className="h-3 w-3" />}>
                New
              </Button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
              <input
                type="search"
                value={threadSearch}
                onChange={(e) => setThreadSearch(e.target.value)}
                placeholder="Search conversations"
                className="h-8 w-full rounded-lg border border-hairline bg-surface-sunken/60 pl-8 pr-2 text-sm text-ink placeholder:text-ink-subtle focus:border-brand-500 focus:bg-surface"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingThreads ? (
              <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
            ) : threads.length === 0 ? (
              <EmptyState
                icon={<MessageSquare className="h-5 w-5" aria-hidden="true" />}
                title={threadSearch ? 'No matches' : 'No conversations yet'}
                description={threadSearch ? undefined : 'Start a thread with a teacher or guardian.'}
              />
            ) : (
              <ul className="divide-y divide-hairline">
                {threads.map((thread) => {
                  const id = String(thread['id']);
                  const people = (thread['participants'] ?? []) as Array<{ firstName: string; lastName: string; role: string }>;
                  const name = people[0]
                    ? `${people[0].firstName} ${people[0].lastName}`
                    : String(thread['title'] ?? 'Conversation');
                  const unread = Number(thread['unreadCount'] ?? 0);
                  const active = activeId === id;

                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => setActiveId(id)}
                        className={cn(
                          'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                          active ? 'bg-brand-500/10' : 'hover:bg-surface-sunken',
                        )}
                      >
                        <Avatar name={name} size="md" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className={cn('truncate text-sm', unread > 0 ? 'font-semibold text-ink' : 'font-medium text-ink')}>
                              {name}
                            </p>
                            {thread['lastMessageAt'] ? (
                              <span className="shrink-0 text-2xs text-ink-subtle">
                                {relativeTime(String(thread['lastMessageAt']))}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <p className={cn('truncate text-xs', unread > 0 ? 'text-ink' : 'text-ink-subtle')}>
                              {String(thread['lastMessagePreview'] ?? 'No messages yet')}
                            </p>
                            {unread > 0 && (
                              <span className="ml-auto flex h-4.5 min-w-[1.125rem] shrink-0 items-center justify-center rounded-full bg-brand-600 px-1 text-2xs font-semibold text-white nums" style={{ height: '1.125rem' }}>
                                {unread > 99 ? '99+' : unread}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Thread */}
        <section className={cn('flex min-h-0 flex-col', !activeId && 'hidden md:flex')}>
          {!activeId ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={<MessageSquare className="h-5 w-5" aria-hidden="true" />}
                title="Select a conversation"
                description="Choose a thread on the left, or start a new one."
              />
            </div>
          ) : (
            <>
              {/* Header */}
              <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  className="-ml-1 rounded-lg p-1.5 text-ink-muted hover:bg-surface-sunken md:hidden"
                  aria-label="Back to conversations"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <Avatar name={counterpart ? `${counterpart.firstName} ${counterpart.lastName}` : 'Conversation'} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {counterpart ? `${counterpart.firstName} ${counterpart.lastName}` : 'Conversation'}
                  </p>
                  <p className="truncate text-2xs text-ink-subtle">
                    {counterpart?.role ? counterpart.role.replace('_', ' ').toLowerCase() : ''}
                  </p>
                </div>
              </header>

              {/* Messages */}
              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-surface-sunken/30 px-4 py-4">
                {loadingMessages && messages.length === 0 ? (
                  <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
                ) : messages.length === 0 ? (
                  <p className="py-10 text-center text-sm text-ink-subtle">
                    No messages yet. Say hello.
                  </p>
                ) : (
                  messages.map((message, index) => {
                    const mine = message.sender.id === currentUserId;
                    const previous = messages[index - 1];

                    const newDay =
                      !previous || dayLabel(previous.createdAt) !== dayLabel(message.createdAt);
                    // Consecutive messages from the same person are grouped:
                    // only the last in a run shows the tail and timestamp.
                    const next = messages[index + 1];
                    const endsRun = !next || next.sender.id !== message.sender.id;

                    return (
                      <div key={message.id}>
                        {newDay && (
                          <div className="my-3 flex justify-center">
                            <span className="rounded-full bg-surface px-2.5 py-0.5 text-2xs font-medium text-ink-subtle ring-1 ring-hairline">
                              {dayLabel(message.createdAt)}
                            </span>
                          </div>
                        )}

                        <div className={cn('flex items-end gap-2', mine ? 'justify-end' : 'justify-start')}>
                          {!mine && (
                            <span className={cn('w-6 shrink-0', !endsRun && 'invisible')}>
                              {endsRun && (
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500/15 text-2xs font-semibold text-brand-600">
                                  {initials(`${message.sender.firstName} ${message.sender.lastName}`)}
                                </span>
                              )}
                            </span>
                          )}

                          <div
                            className={cn(
                              'max-w-[75%] px-3 py-1.5 text-sm shadow-xs animate-slide-up',
                              mine
                                ? 'bg-brand-600 text-white'
                                : 'bg-surface text-ink ring-1 ring-hairline',
                              // Rounded on three corners, squared at the tail.
                              mine
                                ? endsRun ? 'rounded-2xl rounded-br-md' : 'rounded-2xl'
                                : endsRun ? 'rounded-2xl rounded-bl-md' : 'rounded-2xl',
                              message.pending && 'opacity-70',
                            )}
                          >
                            <p className="whitespace-pre-wrap break-words">{message.body}</p>
                            <span
                              className={cn(
                                'mt-0.5 flex items-center justify-end gap-1 text-[10px] leading-none',
                                mine ? 'text-white/70' : 'text-ink-subtle',
                              )}
                            >
                              {clockTime(message.createdAt)}
                              {mine &&
                                (message.pending ? (
                                  <Check className="h-3 w-3" aria-label="Sending" />
                                ) : (
                                  <CheckCheck className="h-3 w-3" aria-label="Sent" />
                                ))}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              {/* Composer */}
              <form
                className="flex shrink-0 items-end gap-2 border-t border-hairline p-3"
                onSubmit={(e) => { e.preventDefault(); void submit(); }}
              >
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter sends; Shift+Enter starts a new line, as in every
                    // messenger people already know.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                  placeholder="Write a message…"
                  className="max-h-32 min-h-[2.25rem] flex-1 resize-none rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-brand-500"
                />
                <Button
                  type="submit"
                  size="icon"
                  loading={sending}
                  disabled={!draft.trim()}
                  aria-label="Send message"
                  className="h-9 w-9 shrink-0 rounded-xl"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                </Button>
              </form>
            </>
          )}
        </section>
      </Card>
    </>
  );
}
