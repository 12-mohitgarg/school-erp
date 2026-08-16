import { useState } from 'react';
import { Megaphone, Pin, Plus, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useAnnouncementsQuery, useCreateAnnouncementMutation } from '@/features/communication/communicationApi';
import { useAuth } from '@/features/auth/useAuth';
import { errorMessage } from '@/lib/api';
import { Avatar, Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Textarea, Checkbox } from '@/components/ui';
import { relativeTime } from '@/lib/utils';
import { CardSkeleton } from '@/components/ui/Skeletons';

export default function AnnouncementsPage() {
  const { can } = useAuth();
  const { data, isLoading } = useAnnouncementsQuery({ limit: 30 });
  const [create, { isLoading: creating }] = useCreateAnnouncementMutation();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: '', body: '', category: 'GENERAL', priority: 'NORMAL',
    audienceType: 'INSTITUTION', isPinned: false, sendPush: true,
  });

  async function submit() {
    if (!form.title.trim() || !form.body.trim()) {
      toast.error('Title and message are required');
      return;
    }

    try {
      await create({
        title: form.title,
        body: form.body,
        category: form.category,
        priority: form.priority,
        audienceType: form.audienceType,
        audienceIds: [],
        channels: form.sendPush ? ['IN_APP', 'PUSH'] : ['IN_APP'],
        isPinned: form.isPinned,
        publish: true,
      }).unwrap();

      toast.success('Announcement published');
      setOpen(false);
      setForm({ title: '', body: '', category: 'GENERAL', priority: 'NORMAL', audienceType: 'INSTITUTION', isPinned: false, sendPush: true });
    } catch (err) {
      toast.error('Could not publish', { description: errorMessage(err) });
    }
  }

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Institution-wide notices, delivered in-app and by push."
        actions={can('communication:create') && <Button size="sm" onClick={() => setOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>New announcement</Button>}
      />

      {isLoading ? (
        <div className="space-y-3">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={3} />
        </div>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <EmptyState icon={<Megaphone className="h-5 w-5" aria-hidden="true" />} title="No announcements yet" description="Publish a notice to reach parents, students and staff." />
        </Card>
      ) : (
        <div className="space-y-3">
          {data.items.map((announcement) => (
            <Card key={announcement.id} className={announcement.isPinned ? 'border-brand-500/40' : undefined}>
              <div className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {announcement.isPinned && <Pin className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden="true" />}
                    <h3 className="truncate text-base font-semibold text-ink">{announcement.title}</h3>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge tone="neutral">{announcement.category}</Badge>
                    {announcement.priority === 'HIGH' && <Badge tone="warning" dot>High</Badge>}
                    {announcement.priority === 'EMERGENCY' && <Badge tone="danger" dot>Emergency</Badge>}
                  </div>
                </div>

                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-muted">{announcement.body}</p>

                <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-3">
                  <Avatar name={`${announcement.author.firstName} ${announcement.author.lastName}`} src={announcement.author.avatarUrl} size="xs" />
                  <p className="text-xs text-ink-subtle">
                    {announcement.author.firstName} {announcement.author.lastName} · {relativeTime(announcement.publishAt ?? announcement.createdAt)}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New announcement"
        description="Published immediately to the selected audience."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} loading={creating} leftIcon={<Send className="h-3.5 w-3.5" />}>Publish</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Annual Sports Day — 15 September" />
          <Textarea label="Message" required rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Write the announcement…" />

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Category"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              options={['GENERAL', 'URGENT', 'ACADEMIC', 'EVENT', 'HOLIDAY', 'EXAM', 'FEE'].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))}
            />
            <Select
              label="Priority"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
              options={['LOW', 'NORMAL', 'HIGH'].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))}
            />
          </div>

          <Select
            label="Audience"
            value={form.audienceType}
            onChange={(e) => setForm({ ...form, audienceType: e.target.value })}
            options={[
              { value: 'INSTITUTION', label: 'Everyone in the institution' },
              { value: 'ROLE', label: 'Specific roles' },
              { value: 'CLASS', label: 'Specific classes' },
            ]}
          />

          <div className="space-y-2.5">
            <Checkbox label="Pin to the top" checked={form.isPinned} onChange={(e) => setForm({ ...form, isPinned: e.target.checked })} />
            <Checkbox label="Also send a push notification" description="Respects each recipient's quiet hours and channel preferences." checked={form.sendPush} onChange={(e) => setForm({ ...form, sendPush: e.target.checked })} />
          </div>
        </div>
      </Modal>
    </>
  );
}
