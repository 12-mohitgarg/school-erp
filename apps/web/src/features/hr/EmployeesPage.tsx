import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useEmployeesQuery, useDepartmentsQuery, type EmployeeRow } from '@/features/api/endpoints';
import { useCreateEmployeeMutation } from '@/features/api/mutations';
import { ResourceList } from '@/components/layout/ResourceList';
import { useListState } from '@/lib/useListState';
import { useAuth } from '@/features/auth/useAuth';
import { FormModal, type Field } from '@/components/forms/FormModal';
import { Avatar, Badge, Button, Select, StatusBadge, type Column } from '@/components/ui';
import { formatDate } from '@/lib/utils';

export default function EmployeesPage() {
  const { can } = useAuth();
  const { params } = useListState();
  const query = useEmployeesQuery({ ...params, limit: 25 });
  const { data: departments } = useDepartmentsQuery();
  const [createEmployee] = useCreateEmployeeMutation();
  const [open, setOpen] = useState(false);

  const fields: Field[] = [
    { name: 'firstName', label: 'First name', required: true, half: true },
    { name: 'lastName', label: 'Last name', required: true, half: true },
    { name: 'gender', label: 'Gender', type: 'select', required: true, half: true,
      options: [
        { value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' },
        { value: 'OTHER', label: 'Other' }, { value: 'UNDISCLOSED', label: 'Prefer not to say' },
      ] },
    { name: 'dateOfBirth', label: 'Date of birth', type: 'date', half: true },
    { name: 'phone', label: 'Phone', type: 'tel', required: true, half: true, placeholder: '+919876543210' },
    { name: 'email', label: 'Email', type: 'email', half: true },
    { name: 'departmentId', label: 'Department', type: 'select', half: true,
      options: [{ value: '', label: 'Unassigned' }, ...(departments ?? []).map((d) => ({ value: d.id, label: d.name }))] },
    { name: 'employmentType', label: 'Employment type', type: 'select', half: true,
      options: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'VISITING', 'INTERN'].map((v) => ({
        value: v, label: v.replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
      })) },
    { name: 'joiningDate', label: 'Joining date', type: 'date', required: true, half: true },
    { name: 'experienceYears', label: 'Experience (years)', type: 'number', min: 0, max: 60, half: true },
    { name: 'qualification', label: 'Qualification', placeholder: 'M.Sc., B.Ed.' },
    { name: 'employeeCode', label: 'Employee code', half: true,
      hint: 'Left blank, one is generated automatically' },
  ];

  const columns: Array<Column<EmployeeRow>> = [
    {
      key: 'name',
      header: 'Employee',
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={row.fullName} src={row.photoUrl} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.fullName}</p>
            <p className="truncate text-xs text-ink-subtle">{row.employeeCode}</p>
          </div>
        </div>
      ),
    },
    { key: 'designation', header: 'Designation', render: (row) => (row.designation ? <Badge tone={row.designation.isTeaching ? 'brand' : 'neutral'}>{row.designation.name}</Badge> : <span className="text-ink-subtle">—</span>) },
    { key: 'department', header: 'Department', hideOnMobile: true, render: (row) => <span className="text-ink-muted">{row.department?.name ?? '—'}</span> },
    { key: 'phone', header: 'Contact', hideOnMobile: true, render: (row) => <span className="text-ink-muted nums">{row.phone}</span> },
    { key: 'joined', header: 'Joined', hideOnMobile: true, render: (row) => <span className="text-ink-muted">{formatDate(row.joiningDate, 'short')}</span> },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <>
      <ResourceList
        title="Staff"
        columns={columns}
        query={query}
        keyOf={(row) => row.id}
        searchPlaceholder="Search by name or employee code…"
        emptyTitle="No staff records"
        emptyDescription="Add teaching and non-teaching staff to the register."
        actions={can('hr:create') && <Button size="sm" onClick={() => setOpen(true)} leftIcon={<UserPlus className="h-3.5 w-3.5" />}>Add employee</Button>}
        filters={(h) => (
          <Select
            aria-label="Filter by department"
            value={h.params['departmentId'] ?? ''}
            onChange={(e) => h.setParam('departmentId', e.target.value || undefined)}
            options={[{ value: '', label: 'All departments' }, ...(departments ?? []).map((d) => ({ value: d.id, label: d.name }))]}
            wrapperClassName="w-48"
          />
        )}
      />

      <FormModal
        open={open}
        onClose={() => setOpen(false)}
        title="Add employee"
        description="Creates the staff record. A login can be issued separately from Users & Roles."
        fields={fields}
        size="lg"
        submitLabel="Add employee"
        successMessage="Employee added"
        onSubmit={async (values) => { await createEmployee(values).unwrap(); }}
      />
    </>
  );
}
