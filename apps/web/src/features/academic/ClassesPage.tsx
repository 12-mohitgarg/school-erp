import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, Plus, Users, LayoutGrid } from 'lucide-react';
import { useClassesQuery, useEmployeesQuery } from '@/features/api/endpoints';
import { useCreateClassMutation, useCreateSectionMutation } from '@/features/api/mutations';
import { useAuth } from '@/features/auth/useAuth';
import { FormModal, type Field } from '@/components/forms/FormModal';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { cn, percentage } from '@/lib/utils';

export default function ClassesPage() {
  const { can } = useAuth();
  const { data, isLoading } = useClassesQuery();
  const { data: staff } = useEmployeesQuery({ limit: 200 });

  const [createClass] = useCreateClassMutation();
  const [createSection] = useCreateSectionMutation();

  const [classOpen, setClassOpen] = useState(false);
  /** Section dialog targets one class; null means closed. */
  const [sectionFor, setSectionFor] = useState<{ id: string; name: string } | null>(null);

  const classFields: Field[] = [
    { name: 'name', label: 'Class name', required: true, placeholder: 'Class 9', half: true },
    { name: 'code', label: 'Code', required: true, placeholder: 'C9', half: true,
      hint: 'Short unique code used in reports' },
    { name: 'level', label: 'Level', type: 'number', required: true, min: 0, max: 20, half: true,
      hint: 'Ordering for promotion: 1 → 2 → 3' },
    { name: 'stream', label: 'Stream', half: true, placeholder: 'Science / Commerce (optional)' },
  ];

  const teacherOptions = (staff?.items ?? [])
    .filter((e) => e.designation?.isTeaching)
    .map((e) => ({ value: e.id, label: `${e.fullName} — ${e.designation?.name ?? 'Teacher'}` }));

  const sectionFields: Field[] = [
    { name: 'name', label: 'Section name', required: true, placeholder: 'A', half: true },
    { name: 'capacity', label: 'Capacity', type: 'number', required: true, min: 1, max: 200,
      defaultValue: 40, half: true },
    { name: 'classTeacherId', label: 'Class teacher', type: 'select',
      options: [{ value: '', label: 'Assign later' }, ...teacherOptions] },
  ];

  return (
    <>
      <PageHeader
        title="Classes & Sections"
        description="Class structure, section capacity and homeroom teachers."
        actions={
          can('academic:create') && (
            <Button size="sm" onClick={() => setClassOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
              Add class
            </Button>
          )
        }
      />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-44" />)}
        </div>
      ) : !data || data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<GraduationCap className="h-5 w-5" aria-hidden="true" />}
            title="No classes configured"
            description="Create your first class to begin enrolling students."
            action={
              can('academic:create') && (
                <Button size="sm" onClick={() => setClassOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                  Add class
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((cls) => (
            <Card key={cls.id}>
              <CardHeader
                title={cls.name}
                description={`${cls.totalStudents} students`}
                action={<Badge tone="brand">Level {cls.level}</Badge>}
              />
              <ul className="divide-y divide-hairline">
                {cls.sections.map((section) => {
                  const fill = percentage(section.enrolled, section.capacity);
                  return (
                    <li key={section.id} className="px-5 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-ink">Section {section.name}</p>
                        <span className="text-xs text-ink-muted nums">
                          {section.enrolled}/{section.capacity}
                        </span>
                      </div>

                      {/* Capacity bar turns amber then red as a section fills up. */}
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            fill >= 95 ? 'bg-danger' : fill >= 80 ? 'bg-warning' : 'bg-brand-500',
                          )}
                          style={{ width: `${Math.min(100, fill)}%` }}
                        />
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-subtle">
                        <span className="truncate">
                          {section.classTeacher ? section.classTeacher.name : 'No class teacher'}
                        </span>
                        <Link
                          to={`/students?classId=${cls.id}&sectionId=${section.id}`}
                          className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
                        >
                          <Users className="h-3 w-3" aria-hidden="true" />
                          View
                        </Link>
                      </div>
                    </li>
                  );
                })}

                {cls.sections.length === 0 && (
                  <li className="px-5 py-4 text-center text-xs text-ink-subtle">
                    No sections yet
                  </li>
                )}
              </ul>

              {can('academic:create') && (
                <div className="border-t border-hairline px-5 py-2.5">
                  <Button
                    size="xs"
                    variant="ghost"
                    fullWidth
                    onClick={() => setSectionFor({ id: cls.id, name: cls.name })}
                    leftIcon={<LayoutGrid className="h-3 w-3" />}
                  >
                    Add section
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <FormModal
        open={classOpen}
        onClose={() => setClassOpen(false)}
        title="Add class"
        description="Classes are the top level of the academic structure; sections sit beneath them."
        fields={classFields}
        submitLabel="Create class"
        successMessage="Class created"
        onSubmit={async (values) => { await createClass(values).unwrap(); }}
      />

      <FormModal
        open={sectionFor !== null}
        onClose={() => setSectionFor(null)}
        title={sectionFor ? `Add section to ${sectionFor.name}` : 'Add section'}
        fields={sectionFields}
        submitLabel="Create section"
        successMessage="Section created"
        onSubmit={async (values) => {
          await createSection({ classId: sectionFor!.id, ...values }).unwrap();
        }}
      />
    </>
  );
}
