import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Filter, Search, UserPlus, X } from 'lucide-react';
import {
  useStudentsQuery, useClassesQuery, useCreateStudentMutation, type StudentRow,
} from '@/features/api/endpoints';
import { FormModal, type Field } from '@/components/forms/FormModal';
import { useListState } from '@/lib/useListState';
import { useAuth } from '@/features/auth/useAuth';
import {
  Avatar, Badge, Button, Card, Input, PageHeader, Pagination,
  Select, StatusBadge, Table, type Column,
} from '@/components/ui';
import { downloadBlob, formatDate, toCsv } from '@/lib/utils';

export default function StudentsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { params, page, searchDraft, setSearchDraft, commitSearch, setParam, setPage, reset, activeFilterCount } =
    useListState();

  const { data, isFetching } = useStudentsQuery({ ...params, limit: 25 });
  const { data: classes } = useClassesQuery();
  const [createStudent] = useCreateStudentMutation();
  const [open, setOpen] = useState(false);

  const selectedClass = classes?.find((c) => c.id === params['classId']);

  const studentFields: Field[] = [
    { name: 'firstName', label: 'First name', required: true, half: true },
    { name: 'lastName', label: 'Last name', required: true, half: true },
    { name: 'dateOfBirth', label: 'Date of birth', type: 'date', required: true, half: true },
    { name: 'gender', label: 'Gender', type: 'select', required: true, half: true,
      options: [
        { value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' },
        { value: 'OTHER', label: 'Other' }, { value: 'UNDISCLOSED', label: 'Prefer not to say' },
      ] },
    { name: 'admissionDate', label: 'Admission date', type: 'date', required: true, half: true,
      defaultValue: new Date().toISOString().slice(0, 10) },
    { name: 'bloodGroup', label: 'Blood group', half: true, placeholder: 'O+' },
    { name: 'classId', label: 'Class', type: 'select', required: true, half: true,
      // Changing class must clear the section, or a section from the previous
      // class would be submitted against the new one.
      resets: ['sectionId'],
      options: [{ value: '', label: 'Select a class' }, ...(classes ?? []).map((c) => ({ value: c.id, label: c.name }))] },
    { name: 'sectionId', label: 'Section', type: 'select', required: true, half: true,
      options: (values) => {
        const cls = classes?.find((c) => c.id === values['classId']);
        if (!cls) return [{ value: '', label: 'Choose a class first' }];
        return [
          { value: '', label: 'Select a section' },
          ...cls.sections.map((s) => ({
            value: s.id,
            label: `Section ${s.name} — ${s.seatsAvailable} seat${s.seatsAvailable === 1 ? '' : 's'} free`,
          })),
        ];
      } },
    { name: 'rollNumber', label: 'Roll number', half: true },
    { name: 'phone', label: 'Phone', type: 'tel', half: true },
    { name: 'city', label: 'City', half: true },
    { name: 'state', label: 'State', half: true },
    { name: 'guardianFirstName', label: 'Guardian first name', required: true, half: true },
    { name: 'guardianLastName', label: 'Guardian last name', required: true, half: true },
    { name: 'guardianPhone', label: 'Guardian phone', type: 'tel', required: true, half: true,
      hint: 'Used for absence alerts and the Parent App invite' },
    { name: 'guardianRelation', label: 'Relation', type: 'select', half: true,
      options: ['FATHER', 'MOTHER', 'GUARDIAN', 'GRANDPARENT', 'OTHER'].map((v) => ({
        value: v, label: v.charAt(0) + v.slice(1).toLowerCase(),
      })) },
  ];

  const columns: Array<Column<StudentRow>> = [
    {
      key: 'student',
      header: 'Student',
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={row.fullName} src={row.photoUrl} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.fullName}</p>
            <p className="truncate text-xs text-ink-subtle">{row.admissionNo}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'class',
      header: 'Class',
      render: (row) =>
        row.className ? (
          <Badge tone="brand">
            {row.className}-{row.sectionName}
          </Badge>
        ) : (
          <span className="text-ink-subtle">Not enrolled</span>
        ),
    },
    {
      key: 'roll',
      header: 'Roll',
      align: 'right',
      hideOnMobile: true,
      render: (row) => <span className="nums text-ink-muted">{row.rollNumber ?? '—'}</span>,
    },
    {
      key: 'gender',
      header: 'Gender',
      hideOnMobile: true,
      render: (row) => <span className="text-ink-muted">{row.gender.toLowerCase()}</span>,
    },
    {
      key: 'admitted',
      header: 'Admitted',
      hideOnMobile: true,
      render: (row) => <span className="text-ink-muted">{formatDate(row.admissionDate, 'short')}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  function exportCsv() {
    if (!data) return;
    const csv = toCsv(
      data.items.map((s) => ({
        'Admission No': s.admissionNo,
        Name: s.fullName,
        Class: s.className ?? '',
        Section: s.sectionName ?? '',
        Roll: s.rollNumber ?? '',
        Gender: s.gender,
        Status: s.status,
        'Admission Date': formatDate(s.admissionDate, 'short'),
      })),
    );
    downloadBlob(csv, `students-page-${page}.csv`);
  }

  return (
    <>
      <PageHeader
        title="Students"
        description={
          data ? `${data.meta.total} students on roll` : 'Student records and enrolment'
        }
        actions={
          <>
            <Button variant="outline" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={exportCsv}>
              Export
            </Button>
            {can('student:create') && (
              <Button size="sm" onClick={() => setOpen(true)} leftIcon={<UserPlus className="h-3.5 w-3.5" />}>
                Add student
              </Button>
            )}
          </>
        }
      />

      <Card>
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3 border-b border-hairline p-4">
          <form
            className="min-w-[220px] flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              commitSearch(searchDraft);
            }}
          >
            <Input
              type="search"
              placeholder="Search by name, admission no or phone…"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onBlur={() => commitSearch(searchDraft)}
              leftIcon={<Search className="h-3.5 w-3.5" aria-hidden="true" />}
              wrapperClassName="mb-0"
            />
          </form>

          <Select
            aria-label="Filter by class"
            value={params['classId'] ?? ''}
            onChange={(e) => setParam('classId', e.target.value || undefined)}
            placeholder="All classes"
            options={[
              { value: '', label: 'All classes' },
              ...(classes ?? []).map((c) => ({ value: c.id, label: c.name })),
            ]}
            wrapperClassName="w-40"
          />

          {selectedClass && (
            <Select
              aria-label="Filter by section"
              value={params['sectionId'] ?? ''}
              onChange={(e) => setParam('sectionId', e.target.value || undefined)}
              options={[
                { value: '', label: 'All sections' },
                ...selectedClass.sections.map((s) => ({ value: s.id, label: `Section ${s.name}` })),
              ]}
              wrapperClassName="w-36"
            />
          )}

          <Select
            aria-label="Filter by status"
            value={params['status'] ?? ''}
            onChange={(e) => setParam('status', e.target.value || undefined)}
            options={[
              { value: '', label: 'Any status' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
              { value: 'TRANSFERRED', label: 'Transferred' },
              { value: 'GRADUATED', label: 'Graduated' },
            ]}
            wrapperClassName="w-36"
          />

          {(activeFilterCount > 0 || params['search']) && (
            <Button variant="ghost" size="sm" onClick={reset} leftIcon={<X className="h-3.5 w-3.5" />}>
              Clear
            </Button>
          )}

          {activeFilterCount > 0 && (
            <Badge tone="brand" className="ml-auto">
              <Filter className="h-3 w-3" aria-hidden="true" />
              {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
            </Badge>
          )}
        </div>

        <Table
          columns={columns}
          rows={data?.items ?? []}
          keyOf={(row) => row.id}
          loading={isFetching && !data}
          onRowClick={(row) => navigate(`/students/${row.id}`)}
          emptyTitle="No students match these filters"
          emptyDescription="Try clearing the filters or searching for a different name."
          emptyAction={
            <Button variant="outline" size="sm" onClick={reset}>
              Clear filters
            </Button>
          }
        />

        {data && (
          <Pagination
            page={data.meta.page}
            totalPages={data.meta.totalPages}
            total={data.meta.total}
            limit={data.meta.limit}
            onChange={setPage}
          />
        )}
      </Card>

      <FormModal
        open={open}
        onClose={() => setOpen(false)}
        title="Admit student"
        description="Creates the student, enrols them into a section and links a guardian in one step."
        fields={studentFields}
        size="xl"
        submitLabel="Admit student"
        successMessage="Student admitted"
        onSubmit={async (values) => {
          const {
            guardianFirstName, guardianLastName, guardianPhone, guardianRelation, ...student
          } = values;

          await createStudent({
            ...student,
            guardians: [{
              firstName: guardianFirstName,
              lastName: guardianLastName,
              phone: guardianPhone,
              relation: guardianRelation ?? 'FATHER',
              custody: 'PRIMARY',
              isPrimaryContact: true,
              sendInvite: true,
            }],
          }).unwrap();
        }}
      />
    </>
  );
}
