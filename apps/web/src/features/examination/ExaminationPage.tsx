import { useMemo, useState } from 'react';
import { Plus, CalendarPlus } from 'lucide-react';
import { useExamsQuery, useExamTermsQuery, useAcademicYearsQuery, useClassesQuery } from '@/features/api/endpoints';
import { useCreateExamMutation, useCreateExamTermMutation } from '@/features/api/mutations';
import { ResourceList } from '@/components/layout/ResourceList';
import { useListState } from '@/lib/useListState';
import { useAuth } from '@/features/auth/useAuth';
import { FormModal, type Field } from '@/components/forms/FormModal';
import { Badge, Button, Select, StatusBadge, type Column } from '@/components/ui';
import { formatDate } from '@/lib/utils';

type Row = Record<string, unknown>;

export default function ExaminationPage() {
  const { can } = useAuth();
  const { params } = useListState();
  const query = useExamsQuery({ ...params, limit: 25 });
  const { data: terms } = useExamTermsQuery();
  const { data: years } = useAcademicYearsQuery();
  const { data: classes } = useClassesQuery();

  const [createExam] = useCreateExamMutation();
  const [createTerm] = useCreateExamTermMutation();
  const [dialog, setDialog] = useState<'exam' | 'term' | null>(null);

  const termOptions = useMemo(
    () => (terms ?? []).map((t) => {
      const year = t['academicYear'] as { name: string } | null;
      return { value: String(t['id']), label: `${String(t['name'])}${year ? ` (${year.name})` : ''}` };
    }),
    [terms],
  );

  const examFields: Field[] = [
    { name: 'name', label: 'Examination name', required: true, placeholder: 'Term 1 Examination — Class 5' },
    { name: 'examTermId', label: 'Term', type: 'select', required: true, half: true,
      options: termOptions.length > 0
        ? [{ value: '', label: 'Select a term' }, ...termOptions]
        : [{ value: '', label: 'Create a term first' }] },
    { name: 'classId', label: 'Class', type: 'select', required: true, half: true,
      options: [{ value: '', label: 'Select a class' }, ...(classes ?? []).map((c) => ({ value: c.id, label: c.name }))] },
    { name: 'gradingSystem', label: 'Grading system', type: 'select', half: true,
      options: [
        { value: 'PERCENTAGE', label: 'Percentage' }, { value: 'GPA', label: 'GPA' },
        { value: 'CCE', label: 'CCE' }, { value: 'LETTER', label: 'Letter grade' },
      ] },
    { name: 'startDate', label: 'Start date', type: 'date', required: true, half: true },
    { name: 'endDate', label: 'End date', type: 'date', required: true, half: true },
    { name: 'instructions', label: 'Instructions', type: 'textarea',
      placeholder: 'Shown to students on the datesheet' },
  ];

  const termFields: Field[] = [
    { name: 'academicYearId', label: 'Academic year', type: 'select', required: true,
      options: [{ value: '', label: 'Select a year' },
        ...(years ?? []).map((y) => ({ value: y.id, label: y.name + (y.isCurrent ? ' (current)' : '') }))] },
    { name: 'name', label: 'Term name', required: true, placeholder: 'Term 1', half: true },
    { name: 'sequence', label: 'Sequence', type: 'number', required: true, min: 1, max: 20,
      defaultValue: 1, half: true, hint: 'Ordering within the year' },
    { name: 'startDate', label: 'Start date', type: 'date', required: true, half: true },
    { name: 'endDate', label: 'End date', type: 'date', required: true, half: true },
    { name: 'weightPercent', label: 'Weight (%)', type: 'number', min: 1, max: 100, defaultValue: 100,
      hint: 'Contribution of this term to the final annual result' },
  ];

  const columns: Array<Column<Row>> = [
    {
      key: 'exam',
      header: 'Examination',
      render: (row) => {
        const term = row['examTerm'] as { name: string } | null;
        return (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{String(row['name'])}</p>
            <p className="truncate text-xs text-ink-subtle">{term?.name ?? '—'}</p>
          </div>
        );
      },
    },
    { key: 'class', header: 'Class', render: (row) => { const c = row['class'] as { name: string } | null; return <Badge tone="brand">{c?.name ?? '—'}</Badge>; } },
    { key: 'subjects', header: 'Subjects', align: 'right', hideOnMobile: true, render: (row) => { const count = row['_count'] as { schedules: number } | null; return <span className="nums text-ink-muted">{count?.schedules ?? 0}</span>; } },
    { key: 'dates', header: 'Dates', hideOnMobile: true, render: (row) => <span className="text-ink-muted">{formatDate(row['startDate'] as string, 'short')} – {formatDate(row['endDate'] as string, 'short')}</span> },
    { key: 'grading', header: 'Grading', hideOnMobile: true, render: (row) => <span className="text-ink-muted">{String(row['gradingSystem'])}</span> },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={String(row['status'])} /> },
  ];

  return (
    <>
      <ResourceList
        title="Examinations"
        description={terms ? `${terms.length} term${terms.length === 1 ? '' : 's'} configured` : undefined}
        columns={columns}
        query={query}
        keyOf={(row) => String(row['id'])}
        searchPlaceholder="Search examinations…"
        emptyTitle="No examinations scheduled"
        emptyDescription="Create an exam term, then schedule an exam for each class."
        actions={
          can('examination:create') && (
            <>
              <Button size="sm" variant="outline" onClick={() => setDialog('term')} leftIcon={<CalendarPlus className="h-3.5 w-3.5" />}>
                Add term
              </Button>
              <Button size="sm" onClick={() => setDialog('exam')} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                Create exam
              </Button>
            </>
          )
        }
        filters={(h) => (
          <Select
            aria-label="Filter by status"
            value={h.params['status'] ?? ''}
            onChange={(e) => h.setParam('status', e.target.value || undefined)}
            options={[
              { value: '', label: 'Any status' },
              { value: 'SCHEDULED', label: 'Scheduled' },
              { value: 'ONGOING', label: 'Ongoing' },
              { value: 'EVALUATION', label: 'Evaluation' },
              { value: 'PUBLISHED', label: 'Published' },
            ]}
            wrapperClassName="w-40"
          />
        )}
      />

      <FormModal
        open={dialog === 'term'}
        onClose={() => setDialog(null)}
        title="Add examination term"
        description="Terms group exams within an academic year and carry the weighting used for annual results."
        fields={termFields}
        submitLabel="Add term"
        successMessage="Term created"
        onSubmit={async (values) => { await createTerm(values).unwrap(); }}
      />

      <FormModal
        open={dialog === 'exam'}
        onClose={() => setDialog(null)}
        title="Create examination"
        description="Subject sittings and seating are scheduled from the exam once created."
        fields={examFields}
        size="lg"
        submitLabel="Create exam"
        successMessage="Examination created"
        onSubmit={async (values) => { await createExam(values).unwrap(); }}
      />
    </>
  );
}
