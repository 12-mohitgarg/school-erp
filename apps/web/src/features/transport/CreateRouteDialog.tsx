import { useState } from 'react';
import { toast } from 'sonner';
import { GripVertical, MapPin, Plus, Route as RouteIcon, Trash2 } from 'lucide-react';
import { useVehiclesQuery, useEmployeesQuery } from '@/features/api/endpoints';
import { useCreateRouteMutation } from '@/features/api/mutations';
import { errorMessage } from '@/lib/api';
import { Alert, Button, Input, Modal, Select } from '@/components/ui';

interface StopDraft {
  /** Stable key for React; not sent to the server. */
  key: string;
  name: string;
  latitude: string;
  longitude: string;
  pickupTime: string;
  dropTime: string;
}

const newStop = (): StopDraft => ({
  key: crypto.randomUUID(),
  name: '',
  latitude: '',
  longitude: '',
  pickupTime: '',
  dropTime: '',
});

/**
 * Create a transport route.
 *
 * Hand-built rather than a `FormModal` because a route is a header plus an
 * ordered, variable-length list of stops — the declarative field model does
 * not express repeating rows.
 */
export function CreateRouteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [createRoute, { isLoading }] = useCreateRouteMutation();

  const { data: vehicles } = useVehiclesQuery({ limit: 100, status: 'ACTIVE' }, { skip: !open });
  const { data: staff } = useEmployeesQuery({ limit: 200, status: 'ACTIVE' }, { skip: !open });

  const [header, setHeader] = useState({
    name: '', code: '', vehicleId: '', driverId: '',
    pickupStartTime: '', dropStartTime: '', monthlyFare: '',
  });
  const [stops, setStops] = useState<StopDraft[]>([newStop(), newStop()]);
  const [error, setError] = useState<string | null>(null);

  function setStop(key: string, patch: Partial<StopDraft>) {
    setStops((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function removeStop(key: string) {
    // A route needs at least a start and an end.
    if (stops.length <= 2) {
      setError('A route needs at least two stops.');
      return;
    }
    setStops((prev) => prev.filter((s) => s.key !== key));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stops.length) return;
    setStops((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function reset() {
    setHeader({ name: '', code: '', vehicleId: '', driverId: '', pickupStartTime: '', dropStartTime: '', monthlyFare: '' });
    setStops([newStop(), newStop()]);
    setError(null);
  }

  async function submit() {
    setError(null);

    if (!header.name.trim() || !header.code.trim()) {
      return setError('Route name and code are required.');
    }

    const filled = stops.filter((s) => s.name.trim());
    if (filled.length < 2) return setError('Add at least two named stops.');

    for (const [index, stop] of filled.entries()) {
      const lat = Number(stop.latitude);
      const lng = Number(stop.longitude);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        return setError(`Stop ${index + 1} (“${stop.name}”) needs a latitude between -90 and 90.`);
      }
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        return setError(`Stop ${index + 1} (“${stop.name}”) needs a longitude between -180 and 180.`);
      }
    }

    try {
      await createRoute({
        name: header.name,
        code: header.code,
        vehicleId: header.vehicleId || undefined,
        driverId: header.driverId || undefined,
        // The first and last named stops define the route's endpoints.
        startStopName: filled[0]!.name,
        endStopName: filled[filled.length - 1]!.name,
        pickupStartTime: header.pickupStartTime || undefined,
        dropStartTime: header.dropStartTime || undefined,
        monthlyFare: header.monthlyFare ? Number(header.monthlyFare) : undefined,
        stops: filled.map((stop, index) => ({
          name: stop.name,
          // Sequence comes from list order, which is what the driver follows.
          sequence: index + 1,
          latitude: Number(stop.latitude),
          longitude: Number(stop.longitude),
          pickupTime: stop.pickupTime || undefined,
          dropTime: stop.dropTime || undefined,
          radiusMeters: 120,
        })),
      }).unwrap();

      toast.success('Route created', { description: `${filled.length} stops` });
      reset();
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not create this route.'));
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Create transport route"
      description="Stops are visited in the order listed. Coordinates drive live tracking and arrival alerts."
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }} disabled={isLoading}>Cancel</Button>
          <Button onClick={submit} loading={isLoading} leftIcon={<RouteIcon className="h-3.5 w-3.5" />}>
            Create route
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}

      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Route name" required value={header.name}
            onChange={(e) => setHeader({ ...header, name: e.target.value })}
            placeholder="Route 3 — East Delhi" />
          <Input label="Code" required value={header.code}
            onChange={(e) => setHeader({ ...header, code: e.target.value })}
            placeholder="RT03" />

          <Select label="Vehicle" value={header.vehicleId}
            onChange={(e) => setHeader({ ...header, vehicleId: e.target.value })}
            options={[
              { value: '', label: 'Assign later' },
              ...(vehicles?.items ?? []).map((v) => ({
                value: v.id, label: `${v.registrationNo} (${v.capacity} seats)`,
              })),
            ]} />

          <Select label="Driver" value={header.driverId}
            onChange={(e) => setHeader({ ...header, driverId: e.target.value })}
            options={[
              { value: '', label: 'Assign later' },
              ...(staff?.items ?? [])
                .filter((e) => e.designation?.name?.toLowerCase().includes('driver'))
                .map((e) => ({ value: e.id, label: e.fullName })),
            ]} />

          <Input label="Pickup start time" type="time" value={header.pickupStartTime}
            onChange={(e) => setHeader({ ...header, pickupStartTime: e.target.value })} />
          <Input label="Drop start time" type="time" value={header.dropStartTime}
            onChange={(e) => setHeader({ ...header, dropStartTime: e.target.value })} />

          <Input label="Monthly fare (₹)" type="number" min={0} value={header.monthlyFare}
            onChange={(e) => setHeader({ ...header, monthlyFare: e.target.value })}
            hint="Billed through the transport fee head" />
        </div>

        {/* Stops */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium text-ink">Stops</h4>
              <p className="text-xs text-ink-subtle">
                Listed in travel order. The first and last become the route endpoints.
              </p>
            </div>
            <Button size="xs" variant="outline" onClick={() => setStops((p) => [...p, newStop()])}
              leftIcon={<Plus className="h-3 w-3" />}>
              Add stop
            </Button>
          </div>

          <ul className="space-y-2">
            {stops.map((stop, index) => (
              <li key={stop.key} className="rounded-lg border border-hairline bg-surface-sunken/40 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden="true" />
                  <span className="text-xs font-medium text-ink-muted nums">Stop {index + 1}</span>

                  <div className="ml-auto flex items-center gap-1">
                    <button type="button" onClick={() => move(index, -1)} disabled={index === 0}
                      aria-label="Move up"
                      className="rounded p-1 text-ink-subtle hover:bg-surface hover:text-ink disabled:opacity-30">
                      ↑
                    </button>
                    <button type="button" onClick={() => move(index, 1)} disabled={index === stops.length - 1}
                      aria-label="Move down"
                      className="rounded p-1 text-ink-subtle hover:bg-surface hover:text-ink disabled:opacity-30">
                      ↓
                    </button>
                    <button type="button" onClick={() => removeStop(stop.key)} aria-label="Remove stop"
                      className="rounded p-1 text-ink-subtle hover:bg-danger/10 hover:text-danger">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-6">
                  <Input placeholder="Stop name" value={stop.name}
                    onChange={(e) => setStop(stop.key, { name: e.target.value })}
                    wrapperClassName="sm:col-span-2"
                    leftIcon={<MapPin className="h-3.5 w-3.5" aria-hidden="true" />} />
                  <Input placeholder="Latitude" value={stop.latitude} inputMode="decimal"
                    onChange={(e) => setStop(stop.key, { latitude: e.target.value })} />
                  <Input placeholder="Longitude" value={stop.longitude} inputMode="decimal"
                    onChange={(e) => setStop(stop.key, { longitude: e.target.value })} />
                  <Input type="time" aria-label="Pickup time" value={stop.pickupTime}
                    onChange={(e) => setStop(stop.key, { pickupTime: e.target.value })} />
                  <Input type="time" aria-label="Drop time" value={stop.dropTime}
                    onChange={(e) => setStop(stop.key, { dropTime: e.target.value })} />
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-2 text-xs text-ink-subtle">
            Tip: right-click a location in Google Maps or OpenStreetMap to copy its
            coordinates.
          </p>
        </div>
      </div>
    </Modal>
  );
}
