import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Bus, Gauge, MapPin, Navigation, Radio, ShieldAlert, Signal, SignalZero, Users, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useFleetLiveQuery, useSosAlertsQuery, useSafetyAlertsQuery,
  useGeofencesQuery, useRoutesQuery, useAcknowledgeSosMutation, useResolveSosMutation,
  type LiveVehicle,
} from '@/features/api/endpoints';
import { useFleetStream } from '@/lib/useRealtime';
import { errorMessage } from '@/lib/api';
import {
  Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Tabs, StatusBadge,
} from '@/components/ui';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { cn, formatDateTime, relativeTime } from '@/lib/utils';
import { ListSkeleton, CardSkeleton } from '@/components/ui/Skeletons';

const CAMPUS: [number, number] = [28.6129, 77.2295];

/** Matches GPS_PING_INTERVAL_SECONDS on the API; PRD §6.1 says 10-15s. */
const GPS_PING_SECONDS = 12;

/**
 * Bus marker drawn as an inline SVG divIcon and rotated to the vehicle's
 * heading, so the fleet reads as direction-aware at a glance.
 */
function busIcon(heading: number, moving: boolean, stale: boolean): L.DivIcon {
  const fill = stale ? '#94a3b8' : moving ? '#4F46E5' : '#F59E0B';

  return L.divIcon({
    className: 'border-0 bg-transparent',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `
      <div style="position:relative;width:34px;height:34px">
        ${moving && !stale ? `<span style="position:absolute;inset:0;border-radius:9999px;background:${fill};opacity:.25;animation:pulse 2s infinite"></span>` : ''}
        <div style="position:absolute;inset:4px;border-radius:9999px;background:${fill};
                    box-shadow:0 2px 8px rgba(15,23,42,.35);display:flex;align-items:center;
                    justify-content:center;transform:rotate(${heading}deg);transition:transform .4s">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"
               transform="rotate(90 12 12)"/></svg>
        </div>
      </div>`,
  });
}

const stopIcon = L.divIcon({
  className: 'border-0 bg-transparent',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
  html: '<div style="width:12px;height:12px;border-radius:9999px;background:#fff;border:3px solid #6366F1;box-shadow:0 1px 4px rgba(15,23,42,.3)"></div>',
});

/** Pans the map when the selected vehicle changes. */
function MapFocus({ center }: { center: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, Math.max(map.getZoom(), 14), { duration: 0.8 });
  }, [center, map]);
  return null;
}

export default function TrackingPage() {
  const [tab, setTab] = useState<'live' | 'sos' | 'alerts'>('live');

  const { data: sos } = useSosAlertsQuery({ status: 'ACTIVE', limit: 20 });
  const activeSosCount = sos?.meta.total ?? 0;

  return (
    <>
      <PageHeader
        title="Live GPS & Safety"
        description="Real-time vehicle positions, geofence activity and emergency alerts."
        actions={
          activeSosCount > 0 && (
            <Badge tone="danger" dot>
              {activeSosCount} active SOS
            </Badge>
          )
        }
      />

      {activeSosCount > 0 && tab !== 'sos' && (
        <Alert tone="danger" title="Emergency alert active" className="mb-4">
          {activeSosCount} SOS alert{activeSosCount === 1 ? '' : 's'} awaiting acknowledgement.{' '}
          <button type="button" onClick={() => setTab('sos')} className="font-medium underline underline-offset-2">
            Review now
          </button>
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'live', label: 'Live map' },
          { value: 'sos', label: 'SOS alerts', count: activeSosCount },
          { value: 'alerts', label: 'Safety alerts' },
        ]}
        className="mb-5"
      />

      {tab === 'live' && <LiveMap />}
      {tab === 'sos' && <SosPanel />}
      {tab === 'alerts' && <AlertsPanel />}
    </>
  );
}

// ---------------------------------------------------------------------------

function LiveMap() {
  /*
    Two feeds, deliberately.

    The REST snapshot carries everything the socket does not — registration,
    route, driver, occupancy — and its slow poll is the safety net for a
    dropped socket or a bus that was already parked when the page opened.

    The socket stream carries positions for the whole fleet, so every marker
    moves rather than only the one an operator happens to have selected.
    Merging them here means one `vehicles` array feeds both the map and the
    list, and neither knows which feed a given field came from.
  */
  const { data: fleet, isLoading } = useFleetLiveQuery(undefined, { pollingInterval: 30_000 });
  const { data: geofences } = useGeofencesQuery();
  const { data: routes } = useRoutesQuery();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const livePositions = useFleetStream();

  const vehicles: LiveVehicle[] = useMemo(
    () =>
      (fleet ?? []).map((vehicle) => {
        const live = livePositions[vehicle.vehicleId];
        if (!live) return vehicle;

        return {
          ...vehicle,
          latitude: live.latitude,
          longitude: live.longitude,
          speed: live.speed,
          heading: live.heading,
          timestamp: live.timestamp,
          isMoving: live.speed > 3,
          staleSeconds: Math.floor((Date.now() - new Date(live.timestamp).getTime()) / 1000),
        };
      }),
    [fleet, livePositions],
  );

  const selected = vehicles.find((v) => v.vehicleId === selectedId) ?? null;
  const streaming = Object.keys(livePositions).length > 0;

  const selectedRoute = routes?.find((r) => r.id === selected?.routeId);

  const moving = vehicles.filter((v) => v.isMoving && v.staleSeconds < 90).length;
  const offline = vehicles.filter((v) => v.staleSeconds >= 90).length;

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard stat={{ key: 'fleet', label: 'Vehicles tracked', value: vehicles.length, format: 'number' }} />
        <StatCard stat={{ key: 'moving', label: 'On the move', value: moving, format: 'number' }} />
        <StatCard
          stat={{ key: 'offline', label: 'No recent signal', value: offline, format: 'number' }}
          accent={offline > 0 ? 'warning' : undefined}
        />
        <StatCard
          stat={{
            key: 'onboard',
            label: 'Students on board',
            value: vehicles.reduce((sum, v) => sum + v.occupancy, 0),
            format: 'number',
          }}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="h-[520px] w-full">
            <MapContainer
              center={CAMPUS}
              zoom={13}
              scrollWheelZoom
              className="h-full w-full"
              // Attribution is required by the OSM tile licence.
              attributionControl
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />

              <MapFocus center={selected ? [selected.latitude, selected.longitude] : null} />

              {/* Geofences */}
              {(geofences ?? []).map((fence) => {
                const lat = fence['centerLatitude'] as number | null;
                const lng = fence['centerLongitude'] as number | null;
                const radius = fence['radiusMeters'] as number | null;
                if (lat === null || lng === null || radius === null) return null;

                const isSchool = fence['type'] === 'SCHOOL';
                return (
                  <Circle
                    key={String(fence['id'])}
                    center={[lat, lng]}
                    radius={radius}
                    pathOptions={{
                      color: isSchool ? '#10B981' : '#6366F1',
                      fillColor: isSchool ? '#10B981' : '#6366F1',
                      fillOpacity: 0.08,
                      weight: 1.5,
                      dashArray: '6 4',
                    }}
                  >
                    <Popup>
                      <p className="text-sm font-medium">{String(fence['name'])}</p>
                      <p className="text-xs opacity-70">
                        {String(fence['type'])} · {radius}m radius
                      </p>
                    </Popup>
                  </Circle>
                );
              })}

              {/* Selected route stops and path */}
              {selectedRoute && (
                <>
                  <Polyline
                    positions={selectedRoute.stops.map((s) => [s.latitude, s.longitude] as [number, number])}
                    pathOptions={{ color: '#6366F1', weight: 3, opacity: 0.5, dashArray: '8 6' }}
                  />
                  {selectedRoute.stops.map((stop) => (
                    <Marker key={stop.id} position={[stop.latitude, stop.longitude]} icon={stopIcon}>
                      <Popup>
                        <p className="text-sm font-medium">{stop.name}</p>
                        <p className="text-xs opacity-70">
                          Stop {stop.sequence}
                          {stop.pickupTime ? ` · pickup ${stop.pickupTime}` : ''}
                        </p>
                      </Popup>
                    </Marker>
                  ))}
                </>
              )}

              {/* Vehicles */}
              {vehicles.map((vehicle) => (
                <Marker
                  key={vehicle.vehicleId}
                  position={[vehicle.latitude, vehicle.longitude]}
                  icon={busIcon(vehicle.heading, vehicle.isMoving, vehicle.staleSeconds >= 90)}
                  eventHandlers={{ click: () => setSelectedId(vehicle.vehicleId) }}
                >
                  <Popup>
                    <p className="text-sm font-semibold">{vehicle.registrationNo}</p>
                    <p className="text-xs opacity-70">{vehicle.routeName ?? 'No route assigned'}</p>
                    <p className="mt-1 text-xs">
                      {Math.round(vehicle.speed)} km/h · {vehicle.occupancy} on board
                    </p>
                    <p className="text-xs opacity-70">Updated {relativeTime(vehicle.timestamp)}</p>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
        </Card>

        {/* Fleet list */}
        <Card className="flex max-h-[520px] flex-col">
          <CardHeader title="Fleet" description={`${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <ListSkeleton rows={5} />
            ) : vehicles.length === 0 ? (
              <EmptyState
                icon={<Bus className="h-5 w-5" aria-hidden="true" />}
                title="No vehicles reporting"
                description="Vehicles appear here once their GPS device sends its first position."
              />
            ) : (
              <ul className="divide-y divide-hairline">
                {vehicles.map((vehicle) => {
                  const stale = vehicle.staleSeconds >= 90;
                  return (
                    <li key={vehicle.vehicleId}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(vehicle.vehicleId)}
                        className={cn(
                          'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                          selectedId === vehicle.vehicleId
                            ? 'bg-brand-500/10'
                            : 'hover:bg-surface-sunken',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                            stale ? 'bg-ink-subtle/15 text-ink-subtle'
                              : vehicle.isMoving ? 'bg-brand-500/15 text-brand-600'
                              : 'bg-warning/15 text-warning',
                          )}
                        >
                          <Bus className="h-4 w-4" aria-hidden="true" />
                        </span>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{vehicle.registrationNo}</p>
                          <p className="truncate text-xs text-ink-subtle">
                            {vehicle.routeName ?? 'Unassigned'}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-muted">
                            <span className="inline-flex items-center gap-1 nums">
                              <Gauge className="h-3 w-3" aria-hidden="true" />
                              {Math.round(vehicle.speed)} km/h
                            </span>
                            <span className="inline-flex items-center gap-1 nums">
                              <Users className="h-3 w-3" aria-hidden="true" />
                              {vehicle.occupancy}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              {stale ? (
                                <SignalZero className="h-3 w-3 text-ink-subtle" aria-hidden="true" />
                              ) : (
                                <Signal className="h-3 w-3 text-success" aria-hidden="true" />
                              )}
                              {relativeTime(vehicle.timestamp)}
                            </span>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {selected && (
            <div className="shrink-0 border-t border-hairline bg-surface-sunken/40 px-4 py-3">
              <p className="text-xs font-medium text-ink">{selected.registrationNo}</p>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-ink-subtle">Driver</dt>
                <dd className="truncate text-ink">{selected.driverName ?? '—'}</dd>
                <dt className="text-ink-subtle">Heading</dt>
                <dd className="text-ink nums">{Math.round(selected.heading)}°</dd>
                <dt className="text-ink-subtle">Accuracy</dt>
                <dd className="text-ink nums">±{Math.round(selected.accuracy)}m</dd>
                <dt className="text-ink-subtle">Last ping</dt>
                <dd className="text-ink">{formatDateTime(selected.timestamp)}</dd>
              </dl>
            </div>
          )}
        </Card>
      </div>

      <HowLiveTrackingWorks streaming={streaming} vehicleCount={vehicles.length} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function SosPanel() {
  const { data, isLoading } = useSosAlertsQuery({ limit: 30 }, { pollingInterval: 15_000 });
  const [acknowledge, { isLoading: acking }] = useAcknowledgeSosMutation();
  const [resolve] = useResolveSosMutation();

  async function onAcknowledge(id: string) {
    try {
      await acknowledge(id).unwrap();
      toast.success('Alert acknowledged');
    } catch (err) {
      toast.error('Could not acknowledge', { description: errorMessage(err) });
    }
  }

  async function onResolve(id: string, falseAlarm: boolean) {
    try {
      await resolve({
        id,
        notes: falseAlarm ? 'Marked as a false alarm.' : 'Resolved from the safety dashboard.',
        falseAlarm,
      }).unwrap();
      toast.success(falseAlarm ? 'Marked as false alarm' : 'Alert resolved');
    } catch (err) {
      toast.error('Could not resolve', { description: errorMessage(err) });
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <CardSkeleton lines={2} title={false} />
        <CardSkeleton lines={2} title={false} />
        <CardSkeleton lines={2} title={false} />
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Check className="h-5 w-5 text-success" aria-hidden="true" />}
          title="No SOS alerts"
          description="Emergency alerts raised from a driver app or vehicle panic button appear here."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {data.items.map((alert) => {
        const id = String(alert['id']);
        const status = String(alert['status']);
        const raisedBy = alert['raisedBy'] as { firstName: string; lastName: string; role: string } | null;
        const vehicle = alert['vehicle'] as { registrationNo: string } | null;
        const isActive = status === 'ACTIVE';

        return (
          <Card key={id} className={isActive ? 'border-danger/40 ring-1 ring-danger/20' : undefined}>
            <div className="flex flex-wrap items-start gap-4 p-4">
              <span
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                  isActive ? 'bg-danger/15 text-danger' : 'bg-surface-sunken text-ink-subtle',
                )}
              >
                <ShieldAlert className="h-5 w-5" aria-hidden="true" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink">
                    {raisedBy ? `${raisedBy.firstName} ${raisedBy.lastName}` : 'Unknown'}
                  </p>
                  <StatusBadge status={status} />
                  <Badge tone="neutral">{String(alert['category'])}</Badge>
                </div>

                {alert['message'] ? (
                  <p className="mt-1 text-sm text-ink-muted">{String(alert['message'])}</p>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-subtle">
                  <span className="inline-flex items-center gap-1">
                    <Bus className="h-3 w-3" aria-hidden="true" />
                    {vehicle?.registrationNo ?? 'No vehicle'}
                  </span>
                  <span className="inline-flex items-center gap-1 nums">
                    <MapPin className="h-3 w-3" aria-hidden="true" />
                    {Number(alert['latitude']).toFixed(5)}, {Number(alert['longitude']).toFixed(5)}
                  </span>
                  <span>{formatDateTime(String(alert['triggeredAt']))}</span>
                  <span>{String(alert['notifiedCount'])} notified</span>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <a
                  href={`https://www.openstreetmap.org/?mlat=${alert['latitude']}&mlon=${alert['longitude']}#map=17/${alert['latitude']}/${alert['longitude']}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button size="sm" variant="outline" leftIcon={<Navigation className="h-3.5 w-3.5" />}>
                    Locate
                  </Button>
                </a>

                {isActive && (
                  <Button size="sm" variant="danger" loading={acking} onClick={() => void onAcknowledge(id)}>
                    Acknowledge
                  </Button>
                )}

                {status === 'ACKNOWLEDGED' && (
                  <>
                    <Button size="sm" variant="success" onClick={() => void onResolve(id, false)}>
                      Resolve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void onResolve(id, true)}>
                      False alarm
                    </Button>
                  </>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

function AlertsPanel() {
  const { data, isLoading } = useSafetyAlertsQuery({ limit: 40 });

  if (isLoading) {
    return (
      <Card>
        <ListSkeleton rows={6} avatar={false} />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Safety alerts" description="Route deviations, overspeeding and device outages" />
      {!data || data.items.length === 0 ? (
        <EmptyState title="No safety alerts recorded" />
      ) : (
        <ul className="divide-y divide-hairline">
          {data.items.map((alert) => {
            const severity = String(alert['severity']);
            const vehicle = alert['vehicle'] as { registrationNo: string } | null;

            return (
              <li key={String(alert['id'])} className="flex items-start gap-3 px-5 py-3">
                <span
                  className={cn(
                    'mt-0.5 h-2 w-2 shrink-0 rounded-full',
                    severity === 'CRITICAL' ? 'bg-danger' : severity === 'WARNING' ? 'bg-warning' : 'bg-info',
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{String(alert['message'])}</p>
                  <p className="mt-0.5 text-xs text-ink-subtle">
                    {String(alert['type']).replace(/_/g, ' ').toLowerCase()} ·{' '}
                    {vehicle?.registrationNo ?? '—'} · {relativeTime(String(alert['occurredAt']))}
                  </p>
                </div>
                <StatusBadge status={severity} />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

/**
 * "How does live tracking actually work?"
 *
 * A collapsed explainer rather than a paragraph in a handover document,
 * because the people who ask this are the people looking at the map — an admin
 * wondering why a bus has not moved, or a principal being shown the product.
 * It also states the live connection state, so "is this real-time or is it
 * broken?" is answerable from the screen itself.
 */
function HowLiveTrackingWorks({
  streaming,
  vehicleCount,
}: {
  streaming: boolean;
  vehicleCount: number;
}) {
  const [open, setOpen] = useState(false);

  const steps = [
    {
      title: 'The bus reports',
      body: `The driver app, or a hardware tracker over MQTT, sends its position every ${GPS_PING_SECONDS} seconds while a trip is in progress.`,
    },
    {
      title: 'The server ingests it',
      body: 'One pipeline handles both sources: the ping is stored, the last-known position cached, and everything after that is best-effort so an alerting failure can never lose the position itself.',
    },
    {
      title: 'Rules run on every ping',
      body: 'Geofence entry and exit, over-speed, and drift off the planned route. Geofences are edge-triggered — an event fires only when the bus crosses the boundary, otherwise a parked bus would alert every few seconds.',
    },
    {
      title: 'ETAs are recomputed',
      body: 'Distance is measured stop to stop along the stops still ahead, plus the halt at each one, rather than a straight line — so an arrival estimate accounts for the route in between.',
    },
    {
      title: 'It reaches this screen',
      body: 'Positions are pushed over a WebSocket. Staff join a school-wide fleet feed; a parent joins only the one bus carrying their child. The table below still refreshes every 30 seconds as a fallback if the socket drops.',
    },
    {
      title: 'Every view is logged',
      body: 'Each time a location is opened it is written to the access log, and history is purged automatically once the school\u2019s retention window passes (PRD \u00a76.3).',
    },
  ];

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-5 py-3 text-left"
      >
        <span
          className={cn(
            'relative flex h-2 w-2 shrink-0 rounded-full',
            streaming ? 'bg-success' : 'bg-warning',
          )}
          aria-hidden="true"
        >
          {streaming && (
            <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-success opacity-75" />
          )}
        </span>

        <Radio className="h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden="true" />

        <span className="min-w-0 flex-1 text-xs text-ink-muted">
          {streaming
            ? `Streaming live over WebSocket — ${vehicleCount} vehicle${vehicleCount === 1 ? '' : 's'} on the map.`
            : 'Waiting for the first live position. Showing the last known location of each vehicle.'}
        </span>

        <span className="shrink-0 text-xs font-medium text-brand-600">
          {open ? 'Hide' : 'How this works'}
        </span>
      </button>

      {open && (
        <ol className="grid gap-3 border-t border-hairline p-5 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-2xs font-semibold text-brand-600 nums">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink">{step.title}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
