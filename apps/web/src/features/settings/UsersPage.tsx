import { useState } from 'react';
import { toast } from 'sonner';
import { UserPlus, Copy } from 'lucide-react';
import { ROLE_LABELS, type Role } from '@erp/shared';
import { useUsersQuery, useUpdateUserMutation } from '@/features/api/endpoints';
import { useCreateUserMutation } from '@/features/api/mutations';
import { ResourceList } from '@/components/layout/ResourceList';
import { useListState } from '@/lib/useListState';
import { errorMessage } from '@/lib/api';
import { FormModal, type Field } from '@/components/forms/FormModal';
import { Alert, Avatar, Badge, Button, Modal, Select, StatusBadge, type Column } from '@/components/ui';
import { relativeTime } from '@/lib/utils';

type Row = Record<string, unknown>;

export default function UsersPage() {
  const { params } = useListState();
  const query = useUsersQuery({ ...params, limit: 25 });
  const [updateUser] = useUpdateUserMutation();
  const [createUser] = useCreateUserMutation();
  const [open, setOpen] = useState(false);
  /** Shown once after creation — the server returns the temp password only then. */
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);

  async function setStatus(id: string, status: string) {
    try {
      await updateUser({ id, body: { status } }).unwrap();
      toast.success(status === 'ACTIVE' ? 'Account reactivated' : 'Account suspended', {
        description: status !== 'ACTIVE' ? 'All their sessions have been revoked.' : undefined,
      });
    } catch (err) {
      toast.error('Could not update account', { description: errorMessage(err) });
    }
  }

  const fields: Field[] = [
    { name: 'firstName', label: 'First name', required: true, half: true },
    { name: 'lastName', label: 'Last name', required: true, half: true },
    { name: 'email', label: 'Email', type: 'email', half: true,
      hint: 'Email or phone is required' },
    { name: 'phone', label: 'Phone', type: 'tel', half: true, placeholder: '+919876543210' },
    { name: 'role', label: 'Role', type: 'select', required: true,
      options: Object.entries(ROLE_LABELS)
        .filter(([value]) => value !== 'SUPER_ADMIN')
        .map(([value, label]) => ({ value, label })) },
    { name: 'password', label: 'Password', type: 'password',
      hint: 'Leave blank to generate a temporary password the user must change' },
  ];

  const columns: Array<Column<Row>> = [
    {
      key: 'user',
      header: 'User',
      render: (row) => {
        const name = `${String(row['firstName'])} ${String(row['lastName'])}`;
        return (
          <div className="flex items-center gap-2.5">
            <Avatar name={name} src={row['avatarUrl'] as string | null} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{name}</p>
              <p className="truncate text-xs text-ink-subtle">{String(row['email'] ?? row['phone'] ?? '—')}</p>
            </div>
          </div>
        );
      },
    },
    { key: 'role', header: 'Role', render: (row) => <Badge tone="brand">{ROLE_LABELS[String(row['role']) as Role] ?? String(row['role'])}</Badge> },
    { key: 'scope', header: 'Scope', hideOnMobile: true, render: (row) => <span className="text-xs text-ink-muted">{String(row['scope'])}</span> },
    { key: 'branch', header: 'Branch', hideOnMobile: true, render: (row) => { const b = row['branch'] as { name: string } | null; return <span className="text-ink-muted">{b?.name ?? '—'}</span>; } },
    { key: 'lastLogin', header: 'Last sign-in', hideOnMobile: true, render: (row) => <span className="text-ink-muted">{row['lastLoginAt'] ? relativeTime(String(row['lastLoginAt'])) : 'Never'}</span> },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={String(row['status'])} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => {
        const id = String(row['id']);
        const active = String(row['status']) === 'ACTIVE';
        return (
          <Button size="xs" variant={active ? 'ghost' : 'outline'} onClick={() => void setStatus(id, active ? 'SUSPENDED' : 'ACTIVE')}>
            {active ? 'Suspend' : 'Reactivate'}
          </Button>
        );
      },
    },
  ];

  return (
    <>
      <ResourceList
        title="Users & Roles"
        description="Accounts, roles and access scope"
        columns={columns}
        query={query}
        keyOf={(row) => String(row['id'])}
        searchPlaceholder="Search by name or email…"
        emptyTitle="No user accounts"
        actions={<Button size="sm" onClick={() => setOpen(true)} leftIcon={<UserPlus className="h-3.5 w-3.5" />}>Add user</Button>}
        filters={(h) => (
          <Select
            aria-label="Filter by role"
            value={h.params['role'] ?? ''}
            onChange={(e) => h.setParam('role', e.target.value || undefined)}
            options={[
              { value: '', label: 'All roles' },
              ...Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })),
            ]}
            wrapperClassName="w-48"
          />
        )}
      />

      <FormModal
        open={open}
        onClose={() => setOpen(false)}
        title="Add user"
        description="Creates a sign-in account. Permissions come from the selected role."
        fields={fields}
        submitLabel="Create account"
        successMessage="Account created"
        onSubmit={async (values) => {
          const result = await createUser(values).unwrap();
          const temporary = result['temporaryPassword'];
          if (temporary) {
            setIssued({ email: String(values['email'] ?? values['phone']), password: String(temporary) });
          }
        }}
      />

      <Modal
        open={issued !== null}
        onClose={() => setIssued(null)}
        title="Account created"
        description="This password is shown once. Copy it now and hand it over securely."
        footer={<Button onClick={() => setIssued(null)}>Done</Button>}
      >
        <Alert tone="warning" className="mb-4">
          The user will be asked to change this password on first sign-in.
        </Alert>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs text-ink-subtle">Sign-in</dt>
            <dd className="font-mono text-ink">{issued?.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Temporary password</dt>
            <dd className="flex items-center gap-2">
              <code className="rounded bg-surface-sunken px-2 py-1 font-mono text-ink">{issued?.password}</code>
              <Button size="xs" variant="ghost" leftIcon={<Copy className="h-3 w-3" />}
                onClick={() => {
                  void navigator.clipboard.writeText(issued?.password ?? '');
                  toast.success('Password copied');
                }}>
                Copy
              </Button>
            </dd>
          </div>
        </dl>
      </Modal>
    </>
  );
}
