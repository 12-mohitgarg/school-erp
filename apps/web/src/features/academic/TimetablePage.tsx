import { useMemo, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { useClassesQuery, useTimetableQuery } from '@/features/api/endpoints';
import { Card, EmptyState, PageHeader, Select } from '@/components/ui';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Slot {
  id: string; dayOfWeek: number; periodNumber: number;
  startTime: string; endTime: string;
  subject: { name: string; code: string; colorHex: string };
  teacher: { firstName: string; lastName: string } | null;
  room: { name: string } | null;
}

export default function TimetablePage() {
  const { data: classes } = useClassesQuery();
  const [sectionId, setSectionId] = useState('');

  const { data } = useTimetableQuery({ sectionId }, { skip: !sectionId });

  const sectionOptions = useMemo(
    () =>
      (classes ?? []).flatMap((cls) =>
        cls.sections.map((s) => ({ value: s.id, label: `${cls.name} — Section ${s.name}` })),
      ),
    [classes],
  );

  const slots = (data?.slots ?? []) as unknown as Slot[];
  // Period numbers vary by school, so derive the grid rows from the data.
  const periods = [...new Set(slots.map((s) => s.periodNumber))].sort((a, b) => a - b);

  return (
    <>
      <PageHeader title="Timetable" description="Weekly schedule by section, with teacher and room allocation." />

      <Card className="mb-4">
        <div className="p-4">
          <Select
            label="Class & section"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            options={[{ value: '', label: 'Select a section' }, ...sectionOptions]}
            wrapperClassName="max-w-sm"
          />
        </div>
      </Card>

      {!sectionId ? (
        <Card>
          <EmptyState icon={<CalendarRange className="h-5 w-5" aria-hidden="true" />} title="Choose a section" description="Select a class and section to view its weekly timetable." />
        </Card>
      ) : periods.length === 0 ? (
        <Card><EmptyState title="No timetable configured for this section" /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="scroll-x">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="w-20 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    Period
                  </th>
                  {DAYS.slice(0, 5).map((day) => (
                    <th key={day} className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                      {day}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {periods.map((period) => (
                  <tr key={period}>
                    <td className="px-3 py-2 align-top">
                      <p className="text-sm font-medium text-ink nums">{period}</p>
                      <p className="text-2xs text-ink-subtle nums">
                        {slots.find((s) => s.periodNumber === period)?.startTime}
                      </p>
                    </td>
                    {[1, 2, 3, 4, 5].map((day) => {
                      const slot = slots.find((s) => s.dayOfWeek === day && s.periodNumber === period);
                      if (!slot) return <td key={day} className="px-3 py-2 text-ink-subtle">—</td>;

                      return (
                        <td key={day} className="px-2 py-2 align-top">
                          <div
                            className="rounded-lg border-l-2 bg-surface-sunken/60 px-2.5 py-1.5"
                            style={{ borderLeftColor: slot.subject.colorHex }}
                          >
                            <p className="truncate text-xs font-medium text-ink">{slot.subject.name}</p>
                            <p className="truncate text-2xs text-ink-subtle">
                              {slot.teacher ? `${slot.teacher.firstName} ${slot.teacher.lastName}` : 'Unassigned'}
                            </p>
                            {slot.room && <p className="truncate text-2xs text-ink-subtle">{slot.room.name}</p>}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
