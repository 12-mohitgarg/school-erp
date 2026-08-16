import { UserPlus } from 'lucide-react';
import { api, unwrapPaged, queryString } from '@/lib/api';
import { ResourceList } from '@/components/layout/ResourceList';
import { useListState } from '@/lib/useListState';
import { useAuth } from '@/features/auth/useAuth';
import { Button, Select, StatusBadge, type Column } from '@/components/ui';
import { formatDate } from '@/lib/utils';

type Row = Record<string, unknown>;

const admissionsApi = api.injectEndpoints({
  endpoints: (build) => ({
    admissionApplications: build.query<ReturnType<typeof unwrapPaged<Row>>, Record<string, unknown>>({
      query: (params) => `/students/admissions/applications${queryString(params)}`,
      transformResponse: unwrapPaged<Row>,
      providesTags: ['Student'],
    }),
  }),
});

const { useAdmissionApplicationsQuery } = admissionsApi;

export default function AdmissionsPage() {
  const { can } = useAuth();
  const { params } = useListState();
  const query = useAdmissionApplicationsQuery({ ...params, limit: 25 });

  const columns: Array<Column<Row>> = [
    {
      key: 'applicant',
      header: 'Applicant',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{String(row['firstName'])} {String(row['lastName'])}</p>
          <p className="truncate text-xs text-ink-subtle">{String(row['applicationNo'])}</p>
        </div>
      ),
    },
    {
      key: 'guardian',
      header: 'Guardian',
      hideOnMobile: true,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-ink">{String(row['guardianName'])}</p>
          <p className="truncate text-xs text-ink-subtle nums">{String(row['guardianPhone'])}</p>
        </div>
      ),
    },
    { key: 'dob', header: 'Date of birth', hideOnMobile: true, render: (row) => <span className="text-ink-muted">{formatDate(row['dateOfBirth'] as string, 'short')}</span> },
    { key: 'source', header: 'Source', hideOnMobile: true, render: (row) => <span className="text-ink-muted">{String(row['source'] ?? '—')}</span> },
    { key: 'applied', header: 'Applied', render: (row) => <span className="text-ink-muted">{formatDate(row['createdAt'] as string, 'short')}</span> },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={String(row['status'])} /> },
  ];

  return (
    <ResourceList
      title="Admissions"
      description="Enquiry to enrolment funnel"
      columns={columns}
      query={query}
      keyOf={(row) => String(row['id'])}
      searchPlaceholder="Search applications…"
      emptyTitle="No applications yet"
      emptyDescription="Enquiries captured at the front office appear here."
      actions={can('student:create') && <Button size="sm" leftIcon={<UserPlus className="h-3.5 w-3.5" />}>New enquiry</Button>}
      filters={(h) => (
        <Select
          aria-label="Filter by stage"
          value={h.params['status'] ?? ''}
          onChange={(e) => h.setParam('status', e.target.value || undefined)}
          options={[
            { value: '', label: 'All stages' },
            { value: 'ENQUIRY', label: 'Enquiry' },
            { value: 'APPLIED', label: 'Applied' },
            { value: 'DOCUMENTS_PENDING', label: 'Documents pending' },
            { value: 'VERIFIED', label: 'Verified' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'ENROLLED', label: 'Enrolled' },
            { value: 'REJECTED', label: 'Rejected' },
          ]}
          wrapperClassName="w-48"
        />
      )}
    />
  );
}
