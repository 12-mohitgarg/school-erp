import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useAssignmentsQuery, useClassesQuery, useSubjectsQuery } from '@/features/api/endpoints';
import { useCreateAssignmentMutation } from '@/features/api/mutations';
import { FormModal, type Field } from '@/components/forms/FormModal';
import { ResourceList } from '@/components/layout/ResourceList';
import { useListState } from '@/lib/useListState';
import { useAuth } from '@/features/auth/useAuth';
import { Badge, Button, StatusBadge, type Column } from '@/components/ui';
import { formatDate, relativeTime } from '@/lib/utils';

type Row = Record<string, unknown>;

export default function AssignmentsPage() {
  const { can } = useAuth();
  const { params } = useListState();
  const query = useAssignmentsQuery({ ...params, limit: 25 });
  const { data: classes } = useClassesQuery();
  const { data: subjects } = useSubjectsQuery({ limit: 100 });
  const [createAssignment] = useCreateAssignmentMutation();
  const [open, setOpen] = useState(false);

  const sectionOptions = useMemo(
    () =>
      (classes ?? []).flatMap((cls) =>
        cls.sections.map((s) => ({ value: `${cls.id}:${s.id}`, label: `${cls.name} — Section ${s.name}` })),
      ),
    [classes],
  );

  const fields: Field[] = [
    { name: 'title', label: 'Title', required: true, placeholder: 'Chapter 4 — Practice Problems' },
    { name: 'target', label: 'Class & section', type: 'select', required: true,
      options: [{ value: '', label: 'Select a section' }, ...sectionOptions] },
    { name: 'subjectId', label: 'Subject', type: 'select', required: true, half: true,
      options: [{ value: '', label: 'Select a subject' },
        ...(subjects?.items ?? []).map((s) => ({ value: s.id, label: s.name }))] },
    { name: 'maxMarks', label: 'Maximum marks', type: 'number', min: 1, max: 1000, defaultValue: 20, half: true },
    { name: 'assignedOn', label: 'Assigned on', type: 'date', required: true, half: true,
      defaultValue: new Date().toISOString().slice(0, 10) },
    { name: 'dueAt', label: 'Due date', type: 'date', required: true, half: true },
    { name: 'description', label: 'Description', type: 'textarea', required: true,
      placeholder: 'What students need to do' },
    { name: 'allowLateSubmission', label: 'Allow late submission', type: 'checkbox', defaultValue: true, half: true },
    { name: 'latePenaltyPercent', label: 'Late penalty (%)', type: 'number', min: 0, max: 100,
      defaultValue: 10, half: true,
      visibleWhen: (v) => Boolean(v['allowLateSubmission']) },
    { name: 'publish', label: 'Publish immediately', type: 'checkbox', defaultValue: true,
      hint: 'Students and guardians are notified on publish' },
  ];

  const columns: Array<Column<Row>> = [
    {
      key: 'title',
      header: 'Assignment',
      render: (row) => {
        const subject = row['subject'] as { name: string; colorHex: string } | null;
        return (
          <div className="flex items-start gap-2.5">
            <span className="mt-1 h-6 w-1 shrink-0 rounded-full" style={{ backgroundColor: subject?.colorHex ?? '#6366F1' }} aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{String(row['title'])}</p>
              <p className="truncate text-xs text-ink-subtle">{subject?.name ?? '—'}</p>
            </div>
          </div>
        );
      },
    },
    {
      key: 'class',
      header: 'Class',
      render: (row) => {
        const cls = row['class'] as { name: string } | null;
        const section = row['section'] as { name: string } | null;
        return <Badge tone="brand">{cls?.name ?? '—'}{section ? `-${section.name}` : ''}</Badge>;
      },
    },
    {
      key: 'teacher',
      header: 'Set by',
      hideOnMobile: true,
      render: (row) => {
        const t = row['teacher'] as { firstName: string; lastName: string } | null;
        return <span className="text-ink-muted">{t ? `${t.firstName} ${t.lastName}` : '—'}</span>;
      },
    },
    { key: 'due', header: 'Due', render: (row) => <span className="text-ink-muted">{formatDate(row['dueAt'] as string, 'short')}</span> },
    { key: 'submissions', header: 'Submitted', align: 'right', hideOnMobile: true, render: (row) => { const c = row['_count'] as { submissions: number } | null; return <span className="nums text-ink-muted">{c?.submissions ?? 0}</span>; } },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={String(row['status'])} /> },
  ];

  return (
    <>
      <ResourceList
      title="Assignments"
      columns={columns}
      query={query}
      keyOf={(row) => String(row['id'])}
      searchPlaceholder="Search assignments…"
      emptyTitle="No assignments"
      emptyDescription="Published homework and its submissions appear here."
      actions={can('examination:create') && <Button size="sm" onClick={() => setOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>New assignment</Button>}
    />

      <FormModal
        open={open}
        onClose={() => setOpen(false)}
        title="New assignment"
        fields={fields}
        size="lg"
        submitLabel="Create assignment"
        successMessage="Assignment created"
        onSubmit={async (values) => {
          // The section picker encodes both ids so one control covers both.
          const [classId, sectionId] = String(values['target']).split(':');
          const { target, dueAt, ...rest } = values;

          await createAssignment({
            ...rest,
            classId,
            sectionId,
            dueAt: new Date(`${String(dueAt)}T23:59:00`).toISOString(),
          }).unwrap();
        }}
      />
    </>
  );
}
