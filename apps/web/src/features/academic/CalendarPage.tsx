import { useState } from 'react';
import { CalendarDays, Plus } from 'lucide-react';
import { useCalendarQuery } from '@/features/api/endpoints';
import { useCreateCalendarEventMutation } from '@/features/api/mutations';
import { useAuth } from '@/features/auth/useAuth';
import { FormModal, type Field } from '@/components/forms/FormModal';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { formatDate, groupBy } from '@/lib/utils';

export default function CalendarPage() {
  const { can } = useAuth();
  const { data } = useCalendarQuery({});
  const [createEvent] = useCreateCalendarEventMutation();
  const [open, setOpen] = useState(false);

  const events = (data ?? []) as Array<Record<string, unknown>>;

  const byMonth = groupBy(events, (e) =>
    new Date(String(e['startDate'])).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
  );

  const fields: Field[] = [
    { name: 'title', label: 'Title', required: true, placeholder: 'Annual Sports Day' },
    { name: 'eventType', label: 'Type', type: 'select', required: true,
      options: ['HOLIDAY', 'EXAM', 'EVENT', 'PTM', 'SPORTS', 'CULTURAL', 'ADMIN'].map((v) => ({
        value: v, label: v.charAt(0) + v.slice(1).toLowerCase(),
      })), half: true },
    { name: 'colorHex', label: 'Colour', type: 'color', defaultValue: '#4F46E5', half: true },
    { name: 'startDate', label: 'Start date', type: 'date', required: true, half: true },
    { name: 'endDate', label: 'End date', type: 'date', required: true, half: true,
      hint: 'Same as start for a single-day event' },
    { name: 'location', label: 'Location', placeholder: 'Main ground (optional)' },
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Details for parents and staff' },
    { name: 'rsvpEnabled', label: 'Collect RSVPs', type: 'checkbox' },
  ];

  return (
    <>
      <PageHeader
        title="Academic Calendar"
        description="Holidays, examinations, events and parent-teacher meetings."
        actions={can('academic:create') && <Button size="sm" onClick={() => setOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>Add event</Button>}
      />

      {events.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />}
            title="No events scheduled"
            description="Add holidays, exams and events to publish the academic calendar."
            action={can('academic:create') && <Button size="sm" onClick={() => setOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>Add event</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {[...byMonth.entries()].map(([month, monthEvents]) => (
            <Card key={month}>
              <CardHeader title={month} description={`${monthEvents.length} event${monthEvents.length === 1 ? '' : 's'}`} />
              <ul className="divide-y divide-hairline">
                {monthEvents.map((event) => (
                  <li key={String(event['id'])} className="flex items-start gap-3 px-5 py-3">
                    <span
                      className="mt-1 h-8 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: String(event['colorHex'] ?? '#4F46E5') }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{String(event['title'])}</p>
                      {event['description'] ? (
                        <p className="line-clamp-2 text-xs text-ink-muted">{String(event['description'])}</p>
                      ) : null}
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {formatDate(String(event['startDate']))}
                        {event['location'] ? ` · ${String(event['location'])}` : ''}
                      </p>
                    </div>
                    <Badge tone="neutral">{String(event['eventType'])}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <FormModal
        open={open}
        onClose={() => setOpen(false)}
        title="Add calendar event"
        fields={fields}
        submitLabel="Add event"
        successMessage="Event added to the calendar"
        onSubmit={async (values) => {
          // The API expects full datetimes; the date inputs give plain dates.
          await createEvent({
            ...values,
            startDate: new Date(`${String(values['startDate'])}T00:00:00`).toISOString(),
            endDate: new Date(`${String(values['endDate'])}T23:59:59`).toISOString(),
            audienceType: 'INSTITUTION',
            audienceIds: [],
          }).unwrap();
        }}
      />
    </>
  );
}
