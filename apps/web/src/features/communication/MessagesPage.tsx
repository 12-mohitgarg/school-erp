import { useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  useNotificationsQuery, useMarkNotificationsReadMutation,
} from '@/features/communication/communicationApi';
import { errorMessage } from '@/lib/api';
import { Button, Card, CardHeader, EmptyState, PageHeader, Tabs } from '@/components/ui';
import { ChatPanel } from './ChatPanel';
import { cn, relativeTime } from '@/lib/utils';

export default function MessagesPage() {
  const [tab, setTab] = useState<'chat' | 'inbox'>('chat');
  const { data: notifications } = useNotificationsQuery({});

  return (
    <>
      <PageHeader
        title="Messages"
        description="Parent-teacher conversations and your notification inbox."
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'chat', label: 'Conversations' },
          { value: 'inbox', label: 'Notifications', count: notifications?.unreadCount },
        ]}
        className="mb-4"
      />

      {tab === 'chat' ? <ChatPanel /> : <Inbox />}
    </>
  );
}

function Inbox() {
  const { data, isLoading } = useNotificationsQuery({});
  const [markRead, { isLoading: marking }] = useMarkNotificationsReadMutation();

  async function markAll() {
    try {
      await markRead({}).unwrap();
      toast.success('All notifications marked as read');
    } catch (err) {
      toast.error('Could not update', { description: errorMessage(err) });
    }
  }

  if (isLoading) return <Card><EmptyState title="Loading…" /></Card>;

  if (!data || data.items.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Bell className="h-5 w-5" aria-hidden="true" />}
          title="No notifications"
          description="Attendance alerts, fee reminders and announcements land here."
        />
      </Card>
    );
  }

  const PRIORITY_TONE: Record<string, string> = {
    EMERGENCY: 'bg-danger',
    HIGH: 'bg-warning',
    NORMAL: 'bg-brand-600',
    LOW: 'bg-ink-subtle',
  };

  return (
    <Card>
      <CardHeader
        title="Notifications"
        description={`${data.unreadCount} unread`}
        action={
          data.unreadCount > 0 && (
            <Button size="sm" variant="outline" loading={marking} onClick={markAll}
              leftIcon={<CheckCheck className="h-3.5 w-3.5" />}>
              Mark all read
            </Button>
          )
        }
      />
      <ul className="divide-y divide-hairline">
        {data.items.map((notification, index) => (
          <li
            key={notification.id}
            style={index < 12 ? { animationDelay: `${index * 25}ms` } : undefined}
            className={cn(
              'flex gap-3 px-5 py-3.5 transition-colors hover:bg-surface-sunken/50',
              index < 12 && 'animate-fade-in [animation-fill-mode:backwards]',
              !notification.readAt && 'bg-brand-500/[0.04]',
            )}
          >
            {/* The marker keeps its column so rows never shift when read. */}
            <span
              className={cn(
                'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                notification.readAt
                  ? 'bg-transparent'
                  : (PRIORITY_TONE[notification.priority] ?? 'bg-brand-600'),
              )}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{notification.title}</p>
              <p className="mt-0.5 text-sm text-ink-muted">{notification.body}</p>
              <p className="mt-1 text-xs text-ink-subtle">{relativeTime(notification.createdAt)}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
