import { useState } from 'react';
import { Building2, Plug, ScrollText, ShieldCheck } from 'lucide-react';
import { useInstitutionQuery, useIntegrationsQuery, usePermissionCatalogueQuery, useAuditLogQuery } from '@/features/api/endpoints';
import { useListState } from '@/lib/useListState';
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Pagination, Table, Tabs, type Column } from '@/components/ui';
import { formatDateTime } from '@/lib/utils';

type Tab = 'institution' | 'roles' | 'integrations' | 'audit';

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('institution');

  return (
    <>
      <PageHeader title="Settings" description="Institution profile, roles, integrations and audit trail." />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'institution', label: 'Institution' },
          { value: 'roles', label: 'Roles & permissions' },
          { value: 'integrations', label: 'Integrations' },
          { value: 'audit', label: 'Audit log' },
        ]}
        className="mb-5"
      />

      {tab === 'institution' && <Institution />}
      {tab === 'roles' && <RolesMatrix />}
      {tab === 'integrations' && <Integrations />}
      {tab === 'audit' && <AuditLog />}
    </>
  );
}

function Institution() {
  const { data } = useInstitutionQuery();
  if (!data) return <Card><EmptyState title="Loading…" /></Card>;

  const branches = (data['branches'] ?? []) as Array<Record<string, unknown>>;

  const fields: Array<[string, string]> = [
    ['Name', String(data['name'] ?? '—')],
    ['Legal name', String(data['legalName'] ?? '—')],
    ['Code', String(data['code'] ?? '—')],
    ['Email', String(data['email'] ?? '—')],
    ['Phone', String(data['phone'] ?? '—')],
    ['Address', [data['addressLine1'], data['city'], data['state'], data['postalCode']].filter(Boolean).join(', ') || '—'],
    ['GSTIN', String(data['gstin'] ?? '—')],
    ['Timezone', String(data['timezone'] ?? '—')],
    ['Currency', String(data['currency'] ?? '—')],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Institution profile" />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {fields.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-ink-subtle">{label}</dt>
                <dd className="text-sm text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Branches" description={`${branches.length} campus${branches.length === 1 ? '' : 'es'}`} />
        <ul className="divide-y divide-hairline">
          {branches.map((branch) => (
            <li key={String(branch['id'])} className="flex items-start gap-2.5 px-5 py-3">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{String(branch['name'])}</p>
                <p className="truncate text-xs text-ink-subtle">{String(branch['city'] ?? '')}</p>
              </div>
              {branch['isHeadOffice'] ? <Badge tone="brand">Head office</Badge> : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function RolesMatrix() {
  const { data } = usePermissionCatalogueQuery();
  if (!data) return <Card><EmptyState title="Loading…" /></Card>;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {data.roles.map((role) => (
        <Card key={role.role}>
          <CardHeader
            title={role.label}
            description={role.description}
            action={<Badge tone="neutral">{role.scope}</Badge>}
          />
          <CardBody>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-subtle">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {role.permissions[0] === '*' ? 'All permissions' : `${role.permissions.length} permissions`}
            </p>
            {role.permissions[0] !== '*' && (
              <div className="flex flex-wrap gap-1">
                {/* Only the modules are shown; the full action list is noise here. */}
                {[...new Set(role.permissions.map((p) => p.split(':')[0]))].map((module) => (
                  <Badge key={module} tone="neutral">{module}</Badge>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function Integrations() {
  const { data } = useIntegrationsQuery();

  if (!data || data.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Plug className="h-5 w-5" aria-hidden="true" />}
          title="No integrations configured"
          description="Connect SMS, email, payment, maps and biometric providers. Credentials are encrypted at rest and never returned by the API."
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {data.map((integration) => (
        <Card key={String(integration['id'])}>
          <CardHeader
            title={String(integration['label'])}
            description={`${String(integration['category'])} · ${String(integration['provider'])}`}
            action={integration['isEnabled'] ? <Badge tone="success" dot>Enabled</Badge> : <Badge tone="neutral">Disabled</Badge>}
          />
          <CardBody className="text-xs text-ink-muted">
            <p>{integration['isSandbox'] ? 'Sandbox mode' : 'Live mode'}</p>
            {integration['lastHealthStatus'] ? <p className="mt-1">Health: {String(integration['lastHealthStatus'])}</p> : null}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function AuditLog() {
  const helpers = useListState();
  const { data, isFetching } = useAuditLogQuery({ ...helpers.params, limit: 30 });

  type Row = Record<string, unknown>;

  const columns: Array<Column<Row>> = [
    { key: 'when', header: 'When', render: (row) => <span className="text-ink-muted">{formatDateTime(String(row['createdAt']))}</span> },
    { key: 'actor', header: 'Actor', render: (row) => (
      <div className="min-w-0">
        <p className="truncate text-ink">{String(row['actorName'])}</p>
        <p className="truncate text-xs text-ink-subtle">{String(row['actorRole'] ?? '—')}</p>
      </div>
    ) },
    { key: 'action', header: 'Action', render: (row) => <Badge tone="neutral">{String(row['action'])}</Badge> },
    { key: 'entity', header: 'Entity', hideOnMobile: true, render: (row) => <span className="text-ink-muted">{String(row['entityType'])}</span> },
    { key: 'module', header: 'Module', hideOnMobile: true, render: (row) => <span className="text-ink-muted">{String(row['module'] ?? '—')}</span> },
    { key: 'ip', header: 'IP', hideOnMobile: true, render: (row) => <span className="text-xs text-ink-subtle nums">{String(row['ipAddress'] ?? '—')}</span> },
  ];

  return (
    <Card>
      <CardHeader
        title="Audit log"
        description="Append-only record of every write, exportable for compliance review"
      />
      <Table columns={columns} rows={data?.items ?? []} keyOf={(r) => String(r['id'])} loading={isFetching && !data}
        emptyTitle="No audit entries" emptyDescription="Every create, update and delete is recorded here." />
      {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} limit={data.meta.limit} onChange={helpers.setPage} />}
    </Card>
  );
}
