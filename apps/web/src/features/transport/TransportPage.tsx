import { useState } from 'react';
import { Bus, Plus, Route as RouteIcon, Users } from 'lucide-react';
import { useVehiclesQuery, useRoutesQuery, useReportTransportQuery, type VehicleRow } from '@/features/api/endpoints';
import { useCreateVehicleMutation } from '@/features/api/mutations';
import { FormModal, type Field } from '@/components/forms/FormModal';
import { CreateRouteDialog } from './CreateRouteDialog';
import { useListState } from '@/lib/useListState';
import { useAuth } from '@/features/auth/useAuth';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Pagination, StatusBadge, Table, Tabs, type Column } from '@/components/ui';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { cn, formatDate, relativeTime } from '@/lib/utils';

export default function TransportPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'vehicles' | 'routes'>('vehicles');
  const [open, setOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const { data: report } = useReportTransportQuery();
  const [createVehicle] = useCreateVehicleMutation();

  const vehicleFields: Field[] = [
    { name: 'registrationNo', label: 'Registration number', required: true, half: true, placeholder: 'DL1PC5432' },
    { name: 'vehicleType', label: 'Type', type: 'select', half: true,
      options: ['BUS', 'VAN', 'MINIBUS', 'CAR'].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() })) },
    { name: 'make', label: 'Make', half: true, placeholder: 'Tata' },
    { name: 'model', label: 'Model', half: true, placeholder: 'Starbus' },
    { name: 'capacity', label: 'Seating capacity', type: 'number', required: true, min: 1, max: 100,
      defaultValue: 40, half: true },
    { name: 'manufactureYear', label: 'Year', type: 'number', min: 1990, max: 2100, half: true },
    { name: 'insuranceExpiry', label: 'Insurance expiry', type: 'date', half: true },
    { name: 'fitnessExpiry', label: 'Fitness expiry', type: 'date', half: true },
    { name: 'permitExpiry', label: 'Permit expiry', type: 'date', half: true },
    { name: 'hasGpsDevice', label: 'Fitted with a GPS tracker', type: 'checkbox', defaultValue: true,
      hint: 'Pair the device from the vehicle row once created' },
  ];

  const totalAllocated = report?.routes.reduce((sum, r) => sum + r.allocated, 0) ?? 0;
  const avgUtilisation = report && report.routes.length > 0
    ? Math.round(report.routes.reduce((s, r) => s + r.utilisationPercent, 0) / report.routes.length)
    : 0;

  return (
    <>
      <PageHeader
        title="Transport"
        description="Fleet, routes, stops and student allocation."
        actions={
          can('transport:create') && (
            <>
              <Button size="sm" variant="outline" onClick={() => setRouteOpen(true)} leftIcon={<RouteIcon className="h-3.5 w-3.5" />}>
                Add route
              </Button>
              <Button size="sm" onClick={() => setOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                Add vehicle
              </Button>
            </>
          )
        }
      />

      <StatGrid>
        <StatCard stat={{ key: 'routes', label: 'Active routes', value: report?.routes.length ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'allocated', label: 'Students allocated', value: totalAllocated, format: 'number' }} />
        <StatCard stat={{ key: 'util', label: 'Average utilisation', value: `${avgUtilisation}%` }} />
        <StatCard stat={{ key: 'distance', label: 'Total route length', value: `${(report?.routes.reduce((s, r) => s + (r.distanceKm ?? 0), 0) ?? 0).toFixed(1)} km` }} />
      </StatGrid>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[{ value: 'vehicles', label: 'Vehicles' }, { value: 'routes', label: 'Routes & stops' }]}
        className="my-5"
      />

      {tab === 'vehicles' ? <Vehicles /> : <Routes />}

      <FormModal
        open={open}
        onClose={() => setOpen(false)}
        title="Add vehicle"
        description="Register a bus or van, then assign it to a route."
        fields={vehicleFields}
        size="lg"
        submitLabel="Add vehicle"
        successMessage="Vehicle registered"
        onSubmit={async (values) => { await createVehicle(values).unwrap(); }}
      />

      <CreateRouteDialog open={routeOpen} onClose={() => setRouteOpen(false)} />
    </>
  );
}

function Vehicles() {
  const helpers = useListState();
  const { data, isFetching } = useVehiclesQuery({ ...helpers.params, limit: 25 });

  const columns: Array<Column<VehicleRow>> = [
    {
      key: 'vehicle',
      header: 'Vehicle',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink nums">{row.registrationNo}</p>
          <p className="truncate text-xs text-ink-subtle">{[row.make, row.model].filter(Boolean).join(' ') || row.vehicleType}</p>
        </div>
      ),
    },
    { key: 'capacity', header: 'Seats', align: 'right', render: (row) => <span className="nums text-ink-muted">{row.capacity}</span> },
    { key: 'route', header: 'Route', hideOnMobile: true, render: (row) => (row.routes[0] ? <Badge tone="brand">{row.routes[0].name}</Badge> : <span className="text-ink-subtle">Unassigned</span>) },
    {
      key: 'device',
      header: 'GPS device',
      hideOnMobile: true,
      render: (row) =>
        row.device ? (
          <div>
            <p className="text-xs text-ink nums">{row.device.deviceImei}</p>
            <p className="text-2xs text-ink-subtle">
              {row.device.lastPingAt ? `Last ping ${relativeTime(row.device.lastPingAt)}` : 'Never reported'}
            </p>
          </div>
        ) : (
          <span className="text-ink-subtle">Not fitted</span>
        ),
    },
    {
      key: 'compliance',
      header: 'Insurance',
      hideOnMobile: true,
      render: (row) => {
        if (!row.insuranceExpiry) return <span className="text-ink-subtle">—</span>;
        const expiring = new Date(row.insuranceExpiry).getTime() - Date.now() < 60 * 86_400_000;
        return <span className={cn('text-xs', expiring ? 'text-warning' : 'text-ink-muted')}>{formatDate(row.insuranceExpiry, 'short')}</span>;
      },
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <Card>
      <Table columns={columns} rows={data?.items ?? []} keyOf={(r) => r.id} loading={isFetching && !data}
        emptyTitle="No vehicles registered" emptyDescription="Add a bus or van to begin allocating routes." />
      {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} limit={data.meta.limit} onChange={helpers.setPage} />}
    </Card>
  );
}

function Routes() {
  const { data } = useRoutesQuery();

  if (!data || data.length === 0) {
    return <Card><EmptyState icon={<RouteIcon className="h-5 w-5" aria-hidden="true" />} title="No routes configured" description="Create a route with its stops to start allocating students." /></Card>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {data.map((route) => {
        const capacity = route.vehicle?.capacity ?? 0;
        const fill = capacity ? Math.round((route._count.allocations / capacity) * 100) : 0;

        return (
          <Card key={route.id}>
            <CardHeader
              title={route.name}
              description={`${route.startStopName} → ${route.endStopName}`}
              action={<Badge tone="neutral">{route.code}</Badge>}
            />
            <div className="px-5 pt-3">
              <div className="flex items-center justify-between text-xs text-ink-muted">
                <span className="inline-flex items-center gap-1"><Bus className="h-3 w-3" aria-hidden="true" />{route.vehicle?.registrationNo ?? 'No vehicle'}</span>
                <span className="inline-flex items-center gap-1 nums"><Users className="h-3 w-3" aria-hidden="true" />{route._count.allocations}/{capacity || '—'}</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                <div className={cn('h-full rounded-full', fill >= 95 ? 'bg-danger' : fill >= 80 ? 'bg-warning' : 'bg-brand-500')} style={{ width: `${Math.min(100, fill)}%` }} />
              </div>
            </div>

            {/* Stop sequence rendered as a timeline so the order is obvious. */}
            <ol className="space-y-0 px-5 py-4">
              {route.stops.map((stop, index) => (
                <li key={stop.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {index < route.stops.length - 1 && (
                    <span className="absolute left-[5px] top-3 h-full w-px bg-hairline" aria-hidden="true" />
                  )}
                  <span className="relative mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-500 ring-2 ring-surface" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{stop.name}</p>
                    <p className="text-xs text-ink-subtle nums">
                      {stop.pickupTime ?? '—'}{stop.dropTime ? ` · drop ${stop.dropTime}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        );
      })}
    </div>
  );
}

