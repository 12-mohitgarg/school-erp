import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useSubjectsQuery } from '@/features/api/endpoints';
import { useCreateSubjectMutation } from '@/features/api/mutations';
import { ResourceList } from '@/components/layout/ResourceList';
import { useListState } from '@/lib/useListState';
import { useAuth } from '@/features/auth/useAuth';
import { FormModal, type Field } from '@/components/forms/FormModal';
import { Badge, Button, type Column } from '@/components/ui';

interface Subject {
  id: string; name: string; code: string; colorHex: string;
  credits: number; isElective: boolean; hasPractical: boolean;
}

export default function SubjectsPage() {
  const { can } = useAuth();
  const { params } = useListState();
  const query = useSubjectsQuery({ ...params, limit: 50 });
  const [createSubject] = useCreateSubjectMutation();
  const [open, setOpen] = useState(false);

  const fields: Field[] = [
    { name: 'name', label: 'Subject name', required: true, placeholder: 'Mathematics', half: true },
    { name: 'code', label: 'Code', required: true, placeholder: 'MATH', half: true },
    { name: 'credits', label: 'Credits', type: 'number', min: 1, max: 10, defaultValue: 1, half: true,
      hint: 'Weight in GPA calculation' },
    { name: 'colorHex', label: 'Colour', type: 'color', defaultValue: '#6366F1', half: true,
      hint: 'Used on timetables and charts' },
    { name: 'isElective', label: 'Elective subject', type: 'checkbox',
      hint: 'Electives may not count toward promotion' },
    { name: 'hasPractical', label: 'Has a practical component', type: 'checkbox',
      hint: 'Practical subjects need a lab room when scheduled' },
  ];

  const columns: Array<Column<Subject>> = [
    {
      key: 'name',
      header: 'Subject',
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="h-6 w-1 shrink-0 rounded-full" style={{ backgroundColor: row.colorHex }} aria-hidden="true" />
          <div>
            <p className="font-medium text-ink">{row.name}</p>
            <p className="text-xs text-ink-subtle">{row.code}</p>
          </div>
        </div>
      ),
    },
    { key: 'credits', header: 'Credits', align: 'right', render: (row) => <span className="nums text-ink-muted">{row.credits}</span> },
    { key: 'type', header: 'Type', render: (row) => <Badge tone={row.isElective ? 'info' : 'neutral'}>{row.isElective ? 'Elective' : 'Core'}</Badge> },
    { key: 'practical', header: 'Practical', hideOnMobile: true, render: (row) => (row.hasPractical ? <Badge tone="brand">Yes</Badge> : <span className="text-ink-subtle">—</span>) },
  ];

  return (
    <>
      <ResourceList
        title="Subjects"
        columns={columns}
        query={query}
        keyOf={(row) => row.id}
        searchPlaceholder="Search subjects…"
        emptyTitle="No subjects configured"
        emptyDescription="Add the subjects taught at your institution."
        actions={can('academic:create') && <Button size="sm" onClick={() => setOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>Add subject</Button>}
      />

      <FormModal
        open={open}
        onClose={() => setOpen(false)}
        title="Add subject"
        fields={fields}
        submitLabel="Create subject"
        successMessage="Subject created"
        onSubmit={async (values) => { await createSubject(values).unwrap(); }}
      />
    </>
  );
}
