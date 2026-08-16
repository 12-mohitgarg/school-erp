import { toast } from 'sonner';
import { useLeaveRequestsQuery, useDecideLeaveMutation } from '@/features/api/endpoints';
import { ResourceList } from '@/components/layout/ResourceList';
import { useListState } from '@/lib/useListState';
import { useAuth } from '@/features/auth/useAuth';
import { errorMessage } from '@/lib/api';
import { Avatar, Badge, Button, Select, StatusBadge, type Column } from '@/components/ui';
import { formatDate } from '@/lib/utils';

type Row = Record<string, unknown>;

export default function LeavePage() {
  const { can } = useAuth();
  const { params } = useListState();
  const query = useLeaveRequestsQuery({ ...params, limit: 25 });
  const [decide] = useDecideLeaveMutation();

  async function onDecide(id: string, approve: boolean) {
    try {
      await decide({ id, approve }).unwrap();
      toast.success(approve ? 'Leave approved' : 'Leave rejected');
    } catch (err) {
      toast.error('Could not update', { description: errorMessage(err) });
    }
  }

  const columns: Array<Column<Row>> = [
    {
      key: 'employee',
      header: 'Employee',
      render: (row) => {
        const e = row['employee'] as { firstName: string; lastName: string; employeeCode: string };
        return (
          <div className="flex items-center gap-2.5">
            <Avatar name={`${e.firstName} ${e.lastName}`} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{e.firstName} {e.lastName}</p>
              <p className="truncate text-xs text-ink-subtle">{e.employeeCode}</p>
            </div>
          </div>
        );
      },
    },
    { key: 'type', header: 'Type', render: (row) => { const t = row['leaveType'] as { name: string }; return <Badge tone="neutral">{t.name}</Badge>; } },
    { key: 'dates', header: 'Dates', hideOnMobile: true, render: (row) => <span className="text-ink-muted">{formatDate(String(row['fromDate']), 'short')} – {formatDate(String(row['toDate']), 'short')}</span> },
    { key: 'days', header: 'Days', align: 'right', render: (row) => <span className="nums text-ink">{String(row['totalDays'])}</span> },
    { key: 'reason', header: 'Reason', hideOnMobile: true, render: (row) => <span className="line-clamp-1 text-ink-muted">{String(row['reason'])}</span> },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={String(row['status'])} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        can('hr:approve') && String(row['status']) === 'PENDING' ? (
          <div className="flex justify-end gap-1.5">
            <Button size="xs" variant="success" onClick={() => void onDecide(String(row['id']), true)}>Approve</Button>
            <Button size="xs" variant="ghost" onClick={() => void onDecide(String(row['id']), false)}>Reject</Button>
          </div>
        ) : null,
    },
  ];

  return (
    <ResourceList
      title="Leave"
      columns={columns}
      query={query}
      keyOf={(row) => String(row['id'])}
      searchPlaceholder="Search…"
      emptyTitle="No leave requests"
      filters={(h) => (
        <Select
          aria-label="Filter by status"
          value={h.params['status'] ?? ''}
          onChange={(e) => h.setParam('status', e.target.value || undefined)}
          options={[
            { value: '', label: 'Any status' },
            { value: 'PENDING', label: 'Pending' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'REJECTED', label: 'Rejected' },
          ]}
          wrapperClassName="w-40"
        />
      )}
    />
  );
}
