/**
 * Live GPS, geofencing and SOS — the safety core of the product (PRD §6).
 *
 * Ingest pipeline, run for every ping from either transport (WebSocket from
 * the driver app, MQTT from a hardware tracker):
 *
 *   validate -> persist -> cache last-known position -> evaluate geofences
 *   -> evaluate speed & route deviation -> recompute stop ETAs -> fan out
 *
 * Everything after "persist" is best-effort: a failure in the alerting stage
 * must never lose the position itself.
 */

import {
  WS_EVENTS,
  haversineMeters,
  estimateEtaMinutes,
  distanceToPathMeters,
  type GeoPoint,
  type LiveVehicleState,
  type StopEta,
} from '@erp/shared';
import { prisma } from '../../core/db/prisma.js';
import { redis, keys } from '../../core/cache/redis.js';
import { env } from '../../config/env.js';
import { moduleLogger } from '../../core/logger.js';
import { AppError } from '../../core/errors/AppError.js';
import {
  emitToVehicle,
  emitToStudent,
  emitToTenant,
  emitToUsers,
  emitToRole,
} from '../../core/realtime/socket.js';
import { notify, guardianUserIds } from '../../core/notifications/notification.service.js';
import { gpsIngestDuration, sosAlertsTotal } from '../../core/observability/metrics.js';
import { decodePolyline } from './polyline.js';

const log = moduleLogger('tracking');

/** How long a cached live position stays fresh before the map shows it stale. */
const LIVE_TTL_SECONDS = 300;
/** Points retained in the in-memory trail drawn behind a moving bus. */
const TRAIL_MAX_POINTS = 200;

export interface LocationInput {
  latitude: number;
  longitude: number;
  speedKmph: number;
  heading: number;
  accuracyMeters?: number | null;
  altitude?: number | null;
  ignitionOn?: boolean | null;
  batteryLevel?: number | null;
  recordedAt: Date;
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

/** Ingest by device IMEI (MQTT / hardware tracker path). */
export async function ingestDeviceLocation(
  imei: string,
  input: LocationInput,
): Promise<void> {
  const device = await prisma.trackingDevice.findUnique({
    where: { deviceImei: imei },
    select: {
      id: true,
      isActive: true,
      vehicle: { select: { id: true, tenantId: true } },
    },
  });

  if (!device?.isActive) {
    log.warn({ imei }, 'Ping from unknown or inactive device');
    return;
  }

  await prisma.trackingDevice.update({
    where: { id: device.id },
    data: {
      lastPingAt: new Date(),
      batteryLevel: input.batteryLevel ?? undefined,
    },
  });

  await ingestLocation(device.vehicle.tenantId, device.vehicle.id, input, imei);
}

/**
 * Core ingest. Idempotent enough that a duplicated ping produces a duplicate
 * row but no duplicate alerts, because geofence transitions are edge-triggered.
 */
export async function ingestLocation(
  tenantId: string,
  vehicleId: string,
  input: LocationInput,
  deviceImei?: string,
): Promise<void> {
  const stopTimer = gpsIngestDuration.startTimer();

  try {
    // The active trip gives the ping its route context. A ping outside a trip
    // is still stored (buses move between shifts) but skips route logic.
    const trip = await prisma.trip.findFirst({
      where: { vehicleId, status: 'IN_PROGRESS' },
      select: { id: true, routeId: true, direction: true, maxSpeedKmph: true },
    });

    await prisma.locationPing.create({
      data: {
        tenantId,
        vehicleId,
        tripId: trip?.id ?? null,
        deviceImei: deviceImei ?? null,
        latitude: input.latitude,
        longitude: input.longitude,
        speedKmph: input.speedKmph,
        heading: input.heading,
        accuracyMeters: input.accuracyMeters ?? null,
        altitude: input.altitude ?? null,
        ignitionOn: input.ignitionOn ?? null,
        batteryLevel: input.batteryLevel ?? null,
        recordedAt: input.recordedAt,
      },
    });

    await cacheLivePosition(vehicleId, tenantId, trip?.id ?? null, input);

    // Push to every subscriber before running the (slower) alert evaluation,
    // so the map stays responsive.
    emitToVehicle(vehicleId, WS_EVENTS.LOCATION_UPDATE, {
      vehicleId,
      tripId: trip?.id ?? null,
      latitude: input.latitude,
      longitude: input.longitude,
      speed: input.speedKmph,
      heading: input.heading,
      accuracy: input.accuracyMeters ?? 0,
      timestamp: input.recordedAt.toISOString(),
    });

    // Alerting is best-effort — never let it discard a stored position.
    try {
      await Promise.all([
        evaluateGeofences(tenantId, vehicleId, trip?.id ?? null, input),
        evaluateSpeed(tenantId, vehicleId, trip, input),
      ]);

      if (trip) {
        await Promise.all([
          evaluateRouteDeviation(tenantId, vehicleId, trip.id, trip.routeId, input),
          updateStopEtas(vehicleId, trip.id, trip.routeId, input),
        ]);
      }
    } catch (err) {
      log.error({ err, vehicleId }, 'Alert evaluation failed for ping');
    }
  } finally {
    stopTimer();
  }
}

/** Keep the last-known position and a short trail in Redis for instant reads. */
async function cacheLivePosition(
  vehicleId: string,
  tenantId: string,
  tripId: string | null,
  input: LocationInput,
): Promise<void> {
  const payload = JSON.stringify({
    tenantId,
    tripId,
    latitude: input.latitude,
    longitude: input.longitude,
    speed: input.speedKmph,
    heading: input.heading,
    accuracy: input.accuracyMeters ?? 0,
    timestamp: input.recordedAt.toISOString(),
  });

  const trailKey = keys.vehicleTrail(vehicleId);

  await redis
    .pipeline()
    .setex(keys.liveVehicle(vehicleId), LIVE_TTL_SECONDS, payload)
    .lpush(trailKey, `${input.latitude},${input.longitude}`)
    // Trim keeps the trail bounded regardless of trip length.
    .ltrim(trailKey, 0, TRAIL_MAX_POINTS - 1)
    .expire(trailKey, LIVE_TTL_SECONDS)
    .exec();
}

// ---------------------------------------------------------------------------
// Geofencing
// ---------------------------------------------------------------------------

/**
 * Edge-triggered geofence evaluation.
 *
 * We store the previous inside/outside state per (vehicle, fence) in Redis and
 * only raise an event when it flips. Without this, a bus parked inside the
 * school fence would emit an ENTRY alert every 12 seconds.
 */
async function evaluateGeofences(
  tenantId: string,
  vehicleId: string,
  tripId: string | null,
  input: LocationInput,
): Promise<void> {
  const fences = await prisma.geofence.findMany({
    where: { tenantId, isActive: true },
    select: {
      id: true,
      name: true,
      type: true,
      shape: true,
      centerLatitude: true,
      centerLongitude: true,
      radiusMeters: true,
      polygon: true,
      notifyOnEntry: true,
      notifyOnExit: true,
      cooldownMinutes: true,
      studentId: true,
    },
  });

  const point: GeoPoint = { latitude: input.latitude, longitude: input.longitude };

  for (const fence of fences) {
    const inside = pointInFence(point, fence);
    const stateKey = keys.geofenceState(vehicleId, fence.id);

    const previous = await redis.get(stateKey);
    const wasInside = previous === '1';

    // First sighting: record the state without firing an event.
    if (previous === null) {
      await redis.setex(stateKey, 86_400, inside ? '1' : '0');
      continue;
    }

    if (inside === wasInside) continue;

    await redis.setex(stateKey, 86_400, inside ? '1' : '0');

    const eventType = inside ? 'ENTRY' : 'EXIT';
    if ((inside && !fence.notifyOnEntry) || (!inside && !fence.notifyOnExit)) continue;

    // Cooldown suppresses flapping at a fence boundary.
    const cooldownKey = keys.geofenceCooldown(vehicleId, fence.id);
    if (await redis.get(cooldownKey)) continue;
    await redis.setex(cooldownKey, fence.cooldownMinutes * 60, '1');

    await raiseGeofenceEvent(tenantId, fence, vehicleId, tripId, eventType, point, input.speedKmph);
  }
}

function pointInFence(
  point: GeoPoint,
  fence: {
    shape: string;
    centerLatitude: number | null;
    centerLongitude: number | null;
    radiusMeters: number | null;
    polygon: unknown;
  },
): boolean {
  if (fence.shape === 'POLYGON' && Array.isArray(fence.polygon)) {
    return isInsidePolygon(point, fence.polygon as GeoPoint[]);
  }

  if (fence.centerLatitude === null || fence.centerLongitude === null || fence.radiusMeters === null) {
    return false;
  }

  const distance = haversineMeters(point, {
    latitude: fence.centerLatitude,
    longitude: fence.centerLongitude,
  });
  return distance <= fence.radiusMeters;
}

/** Ray-casting containment test, duplicated here to avoid a shared-package import cycle. */
function isInsidePolygon(point: GeoPoint, polygon: GeoPoint[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const intersects =
      pi.longitude > point.longitude !== pj.longitude > point.longitude &&
      point.latitude <
        ((pj.latitude - pi.latitude) * (point.longitude - pi.longitude)) /
          (pj.longitude - pi.longitude) +
          pi.latitude;
    if (intersects) inside = !inside;
  }
  return inside;
}

async function raiseGeofenceEvent(
  tenantId: string,
  fence: { id: string; name: string; type: string; studentId: string | null },
  vehicleId: string,
  tripId: string | null,
  type: 'ENTRY' | 'EXIT',
  point: GeoPoint,
  speedKmph: number,
): Promise<void> {
  const event = await prisma.geofenceEvent.create({
    data: {
      tenantId,
      geofenceId: fence.id,
      studentId: fence.studentId,
      vehicleId,
      tripId,
      type,
      latitude: point.latitude,
      longitude: point.longitude,
      speedKmph,
    },
    select: { id: true, occurredAt: true },
  });

  const payload = {
    eventId: event.id,
    geofenceId: fence.id,
    geofenceName: fence.name,
    studentId: fence.studentId,
    vehicleId,
    type,
    location: point,
    occurredAt: event.occurredAt.toISOString(),
  };

  emitToVehicle(vehicleId, WS_EVENTS.GEOFENCE_EVENT, payload);
  emitToTenant(tenantId, WS_EVENTS.GEOFENCE_EVENT, payload);

  // Notify the guardians of every student currently aboard this vehicle.
  const studentIds = fence.studentId
    ? [fence.studentId]
    : await studentsOnBoard(tripId);

  if (studentIds.length > 0) {
    const recipients = await guardianUserIds(studentIds);
    const verb = type === 'ENTRY' ? 'reached' : 'left';

    await notify({
      tenantId,
      userIds: recipients,
      title: `Bus ${verb} ${fence.name}`,
      body: `The school bus has ${verb} ${fence.name} at ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.`,
      channels: ['IN_APP', 'PUSH'],
      priority: 'NORMAL',
      module: 'tracking',
      actionUrl: '/parent/tracking',
      data: { geofenceId: fence.id, type },
    });
  }

  await prisma.geofenceEvent.update({
    where: { id: event.id },
    data: { notifiedAt: new Date() },
  });
}

/** Students who boarded this trip and have not yet alighted. */
async function studentsOnBoard(tripId: string | null): Promise<string[]> {
  if (!tripId) return [];

  const events = await prisma.tripStudentEvent.findMany({
    where: { tripId, event: { in: ['BOARDED', 'ALIGHTED'] } },
    select: { studentId: true, event: true },
  });

  const aboard = new Set<string>();
  for (const e of events) {
    if (e.event === 'BOARDED') aboard.add(e.studentId);
    else aboard.delete(e.studentId);
  }
  return [...aboard];
}

// ---------------------------------------------------------------------------
// Speed and route-deviation alerts
// ---------------------------------------------------------------------------

async function evaluateSpeed(
  tenantId: string,
  vehicleId: string,
  trip: { id: string } | null,
  input: LocationInput,
): Promise<void> {
  const limit = env.DEFAULT_SPEED_LIMIT_KMPH;
  if (input.speedKmph <= limit) return;

  // One overspeed alert per vehicle per 5 minutes, not one per ping.
  const cooldownKey = `speed:cool:${vehicleId}`;
  if (await redis.get(cooldownKey)) return;
  await redis.setex(cooldownKey, 300, '1');

  await raiseSafetyAlert({
    tenantId,
    type: 'OVERSPEED',
    severity: input.speedKmph > limit * 1.5 ? 'CRITICAL' : 'WARNING',
    vehicleId,
    tripId: trip?.id ?? null,
    message: `Vehicle exceeded the safe speed limit — ${Math.round(input.speedKmph)} km/h in a ${limit} km/h zone`,
    details: { speedKmph: input.speedKmph, limitKmph: limit },
    location: { latitude: input.latitude, longitude: input.longitude },
  });
}

async function evaluateRouteDeviation(
  tenantId: string,
  vehicleId: string,
  tripId: string,
  routeId: string,
  input: LocationInput,
): Promise<void> {
  const route = await prisma.transportRoute.findUnique({
    where: { id: routeId },
    select: { polyline: true },
  });

  if (!route?.polyline) return;

  const path = decodePolyline(route.polyline);
  if (path.length < 2) return;

  const deviation = distanceToPathMeters(
    { latitude: input.latitude, longitude: input.longitude },
    path,
  );

  if (deviation <= env.ROUTE_DEVIATION_METERS) return;

  const cooldownKey = `dev:cool:${vehicleId}`;
  if (await redis.get(cooldownKey)) return;
  await redis.setex(cooldownKey, 600, '1');

  await raiseSafetyAlert({
    tenantId,
    type: 'ROUTE_DEVIATION',
    severity: 'WARNING',
    vehicleId,
    tripId,
    message: `Vehicle is ${Math.round(deviation)}m off its planned route`,
    details: { deviationMeters: Math.round(deviation), thresholdMeters: env.ROUTE_DEVIATION_METERS },
    location: { latitude: input.latitude, longitude: input.longitude },
  });
}

interface SafetyAlertInput {
  tenantId: string;
  type: 'ROUTE_DEVIATION' | 'OVERSPEED' | 'DEVICE_OFFLINE' | 'HARSH_BRAKING';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  vehicleId: string;
  tripId: string | null;
  message: string;
  details: Record<string, unknown>;
  location: GeoPoint;
}

async function raiseSafetyAlert(input: SafetyAlertInput): Promise<void> {
  const alert = await prisma.safetyAlert.create({
    data: {
      tenantId: input.tenantId,
      type: input.type,
      severity: input.severity,
      vehicleId: input.vehicleId,
      tripId: input.tripId,
      message: input.message,
      details: input.details as never,
      latitude: input.location.latitude,
      longitude: input.location.longitude,
    },
    select: { id: true, occurredAt: true },
  });

  if (input.tripId) {
    await prisma.trip.update({
      where: { id: input.tripId },
      data: { alertCount: { increment: 1 } },
    });
  }

  const payload = {
    alertId: alert.id,
    type: input.type,
    severity: input.severity,
    vehicleId: input.vehicleId,
    tripId: input.tripId,
    message: input.message,
    location: input.location,
    occurredAt: alert.occurredAt.toISOString(),
  };

  emitToTenant(input.tenantId, WS_EVENTS.SAFETY_ALERT, payload);
  emitToVehicle(input.vehicleId, WS_EVENTS.SAFETY_ALERT, payload);

  log.warn({ type: input.type, vehicleId: input.vehicleId }, input.message);
}

// ---------------------------------------------------------------------------
// ETA
// ---------------------------------------------------------------------------

/**
 * Recompute arrival estimates for the stops still ahead on this trip.
 *
 * Distance is measured stop-to-stop along the remaining sequence rather than
 * straight-line to each stop, so an ETA accounts for the intervening path.
 */
async function updateStopEtas(
  vehicleId: string,
  tripId: string,
  routeId: string,
  input: LocationInput,
): Promise<void> {
  const [stops, arrivals] = await Promise.all([
    prisma.routeStop.findMany({
      where: { routeId },
      orderBy: { sequence: 'asc' },
      select: {
        id: true,
        name: true,
        sequence: true,
        latitude: true,
        longitude: true,
        haltMinutes: true,
      },
    }),
    prisma.tripStopArrival.findMany({
      where: { tripId },
      select: { stopId: true, arrivedAt: true },
    }),
  ]);

  const reached = new Set(arrivals.filter((a) => a.arrivedAt).map((a) => a.stopId));
  const pending = stops.filter((s) => !reached.has(s.id));
  if (pending.length === 0) return;

  const current: GeoPoint = { latitude: input.latitude, longitude: input.longitude };

  let cursor = current;
  let cumulativeMeters = 0;
  let cumulativeHaltMinutes = 0;
  const etas: StopEta[] = [];

  for (const stop of pending) {
    const stopPoint = { latitude: stop.latitude, longitude: stop.longitude };
    cumulativeMeters += haversineMeters(cursor, stopPoint);
    cursor = stopPoint;

    const travelMinutes = estimateEtaMinutes(cumulativeMeters, input.speedKmph);
    const totalMinutes = travelMinutes + cumulativeHaltMinutes;
    const etaAt = new Date(Date.now() + totalMinutes * 60_000);

    etas.push({
      stopId: stop.id,
      stopName: stop.name,
      sequence: stop.sequence,
      location: stopPoint,
      etaAt: etaAt.toISOString(),
      etaMinutes: totalMinutes,
      distanceMeters: Math.round(cumulativeMeters),
      reached: false,
      reachedAt: null,
    });

    await prisma.tripStopArrival.upsert({
      where: { tripId_stopId: { tripId, stopId: stop.id } },
      create: { tripId, stopId: stop.id, etaAt },
      update: { etaAt },
    });

    // Each subsequent stop is delayed by the halt at the one before it.
    cumulativeHaltMinutes += stop.haltMinutes;
  }

  emitToVehicle(vehicleId, WS_EVENTS.ETA_UPDATE, { tripId, stops: etas });
}

// ---------------------------------------------------------------------------
// SOS
// ---------------------------------------------------------------------------

export interface SosInput {
  latitude: number;
  longitude: number;
  message?: string | null;
  category?: string;
  vehicleId?: string | null;
  tripId?: string | null;
  studentId?: string | null;
}

/**
 * Raise an SOS. This is the highest-priority path in the system: it fans out
 * to admins and to the guardians of every child aboard, over every channel,
 * ignoring quiet hours and channel preferences.
 */
export async function raiseSos(
  tenantId: string,
  raisedByUserId: string,
  raisedByName: string,
  input: SosInput,
): Promise<{ alertId: string }> {
  // If the raiser is a driver mid-trip, attach the trip automatically.
  let tripId = input.tripId ?? null;
  let vehicleId = input.vehicleId ?? null;

  if (!tripId && vehicleId) {
    const trip = await prisma.trip.findFirst({
      where: { vehicleId, status: 'IN_PROGRESS' },
      select: { id: true },
    });
    tripId = trip?.id ?? null;
  }

  if (!vehicleId && tripId) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { vehicleId: true },
    });
    vehicleId = trip?.vehicleId ?? null;
  }

  const alert = await prisma.sosAlert.create({
    data: {
      tenantId,
      raisedByUserId,
      vehicleId,
      tripId,
      studentId: input.studentId ?? null,
      latitude: input.latitude,
      longitude: input.longitude,
      message: input.message ?? null,
      category: input.category ?? 'OTHER',
      status: 'ACTIVE',
    },
    select: { id: true, triggeredAt: true },
  });

  sosAlertsTotal.inc({ status: 'raised' });

  const payload = {
    alertId: alert.id,
    raisedByUserId,
    raisedByName,
    vehicleId,
    tripId,
    studentId: input.studentId ?? null,
    location: { latitude: input.latitude, longitude: input.longitude },
    status: 'ACTIVE',
    message: input.message ?? null,
    triggeredAt: alert.triggeredAt.toISOString(),
  };

  // Immediate realtime fan-out, before the slower notification pipeline.
  emitToTenant(tenantId, WS_EVENTS.SOS_ALERT, payload);
  if (vehicleId) emitToVehicle(vehicleId, WS_EVENTS.SOS_ALERT, payload);
  emitToRole(tenantId, 'ADMIN', WS_EVENTS.SOS_ALERT, payload);
  emitToRole(tenantId, 'ADMINISTRATION', WS_EVENTS.SOS_ALERT, payload);

  // Admins and administration staff.
  const staff = await prisma.user.findMany({
    where: {
      tenantId,
      role: { in: ['SUPER_ADMIN', 'ADMIN', 'ADMINISTRATION'] },
      status: 'ACTIVE',
    },
    select: { id: true },
  });

  const studentIds = input.studentId ? [input.studentId] : await studentsOnBoard(tripId);
  const guardians = await guardianUserIds(studentIds);

  const recipients = [...new Set([...staff.map((s) => s.id), ...guardians])];

  await notify({
    tenantId,
    userIds: recipients,
    title: '🚨 Emergency SOS raised',
    body: `${raisedByName} triggered an emergency alert${input.message ? `: ${input.message}` : ''}. Live location is available in the app.`,
    // EMERGENCY priority overrides quiet hours and per-channel opt-outs.
    channels: ['IN_APP', 'PUSH', 'SMS'],
    priority: 'EMERGENCY',
    module: 'tracking',
    actionUrl: `/tracking/sos/${alert.id}`,
    data: { alertId: alert.id, latitude: input.latitude, longitude: input.longitude },
  });

  await prisma.sosAlert.update({
    where: { id: alert.id },
    data: { notifiedCount: recipients.length },
  });

  log.error(
    { alertId: alert.id, tenantId, raisedByUserId, recipients: recipients.length },
    'SOS ALERT RAISED',
  );

  return { alertId: alert.id };
}

export async function acknowledgeSos(
  tenantId: string,
  alertId: string,
  userId: string,
): Promise<void> {
  const alert = await prisma.sosAlert.findFirst({
    where: { id: alertId, tenantId },
    select: { id: true, status: true },
  });

  if (!alert) throw AppError.notFound('SOS alert');
  if (alert.status !== 'ACTIVE') throw AppError.conflict('This alert has already been handled');

  await prisma.sosAlert.update({
    where: { id: alertId },
    data: { status: 'ACKNOWLEDGED', acknowledgedById: userId, acknowledgedAt: new Date() },
  });

  sosAlertsTotal.inc({ status: 'acknowledged' });
  emitToTenant(tenantId, WS_EVENTS.SOS_UPDATE, { alertId, status: 'ACKNOWLEDGED' });
}

export async function resolveSos(
  tenantId: string,
  alertId: string,
  userId: string,
  notes: string,
  falseAlarm: boolean,
): Promise<void> {
  const alert = await prisma.sosAlert.findFirst({
    where: { id: alertId, tenantId },
    select: { id: true },
  });

  if (!alert) throw AppError.notFound('SOS alert');

  await prisma.sosAlert.update({
    where: { id: alertId },
    data: {
      status: falseAlarm ? 'FALSE_ALARM' : 'RESOLVED',
      resolvedAt: new Date(),
      resolutionNotes: notes,
      acknowledgedById: userId,
    },
  });

  sosAlertsTotal.inc({ status: falseAlarm ? 'false_alarm' : 'resolved' });
  emitToTenant(tenantId, WS_EVENTS.SOS_UPDATE, {
    alertId,
    status: falseAlarm ? 'FALSE_ALARM' : 'RESOLVED',
  });
}

/** SOS raised directly from a hardware panic button. */
export async function ingestDeviceSos(
  imei: string,
  input: { latitude: number; longitude: number; message: string | null },
): Promise<void> {
  const device = await prisma.trackingDevice.findUnique({
    where: { deviceImei: imei },
    select: { vehicle: { select: { id: true, tenantId: true } } },
  });

  if (!device) return;

  const trip = await prisma.trip.findFirst({
    where: { vehicleId: device.vehicle.id, status: 'IN_PROGRESS' },
    select: { id: true, driver: { select: { user: { select: { id: true } } } } },
  });

  // Attribute the alert to the driver on shift; fall back to a system actor.
  const raisedBy = trip?.driver.user?.id;
  if (!raisedBy) {
    log.error({ imei }, 'Device SOS with no attributable driver — cannot raise alert');
    return;
  }

  await raiseSos(device.vehicle.tenantId, raisedBy, 'Vehicle panic button', {
    latitude: input.latitude,
    longitude: input.longitude,
    message: input.message,
    category: 'SECURITY',
    vehicleId: device.vehicle.id,
    tripId: trip?.id ?? null,
  });
}

export async function updateDeviceStatus(
  imei: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const battery = Number(payload['battery']);
  const signal = Number(payload['signal']);

  await prisma.trackingDevice.updateMany({
    where: { deviceImei: imei },
    data: {
      lastPingAt: new Date(),
      batteryLevel: Number.isFinite(battery) ? battery : undefined,
      signalStrength: Number.isFinite(signal) ? signal : undefined,
    },
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Live state of one vehicle, served from cache with a DB fallback. */
export async function getLiveVehicle(
  tenantId: string,
  vehicleId: string,
): Promise<LiveVehicleState | null> {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, tenantId },
    select: {
      id: true,
      registrationNo: true,
      capacity: true,
      routes: { where: { isActive: true }, take: 1, select: { id: true, name: true } },
      trips: {
        where: { status: 'IN_PROGRESS' },
        take: 1,
        select: {
          id: true,
          studentsBoarded: true,
          studentsAlighted: true,
          driver: { select: { firstName: true, lastName: true, phone: true } },
        },
      },
    },
  });

  if (!vehicle) throw AppError.notFound('Vehicle');

  const cachedRaw = await redis.get(keys.liveVehicle(vehicleId));

  let position: {
    latitude: number;
    longitude: number;
    speed: number;
    heading: number;
    accuracy: number;
    timestamp: string;
  } | null = cachedRaw ? JSON.parse(cachedRaw) : null;

  // Cache miss (cold start, or the bus has been idle) — read the last ping.
  if (!position) {
    const last = await prisma.locationPing.findFirst({
      where: { vehicleId },
      orderBy: { recordedAt: 'desc' },
      select: {
        latitude: true,
        longitude: true,
        speedKmph: true,
        heading: true,
        accuracyMeters: true,
        recordedAt: true,
      },
    });

    if (!last) return null;

    position = {
      latitude: last.latitude,
      longitude: last.longitude,
      speed: last.speedKmph,
      heading: last.heading,
      accuracy: last.accuracyMeters ?? 0,
      timestamp: last.recordedAt.toISOString(),
    };
  }

  const trip = vehicle.trips[0];
  const route = vehicle.routes[0];
  const staleSeconds = Math.floor(
    (Date.now() - new Date(position.timestamp).getTime()) / 1000,
  );

  return {
    vehicleId: vehicle.id,
    registrationNo: vehicle.registrationNo,
    routeId: route?.id ?? null,
    routeName: route?.name ?? null,
    tripId: trip?.id ?? null,
    driverName: trip ? `${trip.driver.firstName} ${trip.driver.lastName}` : null,
    driverPhone: trip?.driver.phone ?? null,
    occupancy: trip ? trip.studentsBoarded - trip.studentsAlighted : 0,
    latitude: position.latitude,
    longitude: position.longitude,
    speed: position.speed,
    heading: position.heading,
    accuracy: position.accuracy,
    timestamp: position.timestamp,
    isMoving: position.speed > 3,
    staleSeconds,
  };
}

/** Everything the Parent App needs for one child's live view. */
export async function getStudentLiveView(tenantId: string, studentId: string) {
  const allocation = await prisma.transportAllocation.findFirst({
    where: { studentId, isActive: true },
    select: {
      route: {
        select: {
          id: true,
          name: true,
          polyline: true,
          vehicleId: true,
          stops: {
            orderBy: { sequence: 'asc' },
            select: {
              id: true,
              name: true,
              sequence: true,
              latitude: true,
              longitude: true,
            },
          },
        },
      },
      pickupStop: { select: { id: true, name: true, latitude: true, longitude: true } },
    },
  });

  if (!allocation?.route.vehicleId) {
    return { tracked: false as const, reason: 'No active transport allocation' };
  }

  const [vehicle, trip] = await Promise.all([
    getLiveVehicle(tenantId, allocation.route.vehicleId),
    prisma.trip.findFirst({
      where: { vehicleId: allocation.route.vehicleId, status: 'IN_PROGRESS' },
      select: {
        id: true,
        direction: true,
        startedAt: true,
        stopArrivals: {
          select: { stopId: true, etaAt: true, arrivedAt: true },
        },
      },
    }),
  ]);

  const arrivalByStop = new Map(
    (trip?.stopArrivals ?? []).map((a) => [a.stopId, a]),
  );

  const stops: StopEta[] = allocation.route.stops.map((stop) => {
    const arrival = arrivalByStop.get(stop.id);
    const etaAt = arrival?.etaAt ?? null;

    return {
      stopId: stop.id,
      stopName: stop.name,
      sequence: stop.sequence,
      location: { latitude: stop.latitude, longitude: stop.longitude },
      etaAt: etaAt?.toISOString() ?? null,
      etaMinutes: etaAt ? Math.max(0, Math.round((etaAt.getTime() - Date.now()) / 60_000)) : null,
      distanceMeters:
        vehicle !== null
          ? Math.round(
              haversineMeters(
                { latitude: vehicle.latitude, longitude: vehicle.longitude },
                { latitude: stop.latitude, longitude: stop.longitude },
              ),
            )
          : null,
      reached: Boolean(arrival?.arrivedAt),
      reachedAt: arrival?.arrivedAt?.toISOString() ?? null,
    };
  });

  const trail = await redis.lrange(keys.vehicleTrail(allocation.route.vehicleId), 0, -1);

  return {
    tracked: true as const,
    route: { id: allocation.route.id, name: allocation.route.name },
    myStop: allocation.pickupStop,
    vehicle,
    trip: trip
      ? {
          tripId: trip.id,
          direction: trip.direction,
          startedAt: trip.startedAt?.toISOString() ?? null,
        }
      : null,
    stops,
    routePolyline: allocation.route.polyline,
    travelledPath: trail
      .map((entry) => {
        const [lat, lng] = entry.split(',').map(Number);
        return { latitude: lat ?? 0, longitude: lng ?? 0 };
      })
      .reverse(),
  };
}

/** 30-day trip history for a student (PRD 6.1). */
export async function getStudentTripHistory(
  studentId: string,
  days: number,
): Promise<
  Array<{
    tripId: string;
    date: Date;
    direction: string;
    boardedAt: Date | null;
    alightedAt: Date | null;
    routeName: string;
    vehicleNo: string;
  }>
> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const events = await prisma.tripStudentEvent.findMany({
    where: { studentId, occurredAt: { gte: since } },
    orderBy: { occurredAt: 'desc' },
    select: {
      event: true,
      occurredAt: true,
      trip: {
        select: {
          id: true,
          tripDate: true,
          direction: true,
          route: { select: { name: true } },
          vehicle: { select: { registrationNo: true } },
        },
      },
    },
  });

  // Collapse the BOARDED/ALIGHTED pair into one row per trip.
  const byTrip = new Map<
    string,
    {
      tripId: string;
      date: Date;
      direction: string;
      boardedAt: Date | null;
      alightedAt: Date | null;
      routeName: string;
      vehicleNo: string;
    }
  >();

  for (const e of events) {
    const existing = byTrip.get(e.trip.id) ?? {
      tripId: e.trip.id,
      date: e.trip.tripDate,
      direction: e.trip.direction,
      boardedAt: null,
      alightedAt: null,
      routeName: e.trip.route.name,
      vehicleNo: e.trip.vehicle.registrationNo,
    };

    if (e.event === 'BOARDED') existing.boardedAt = e.occurredAt;
    if (e.event === 'ALIGHTED') existing.alightedAt = e.occurredAt;

    byTrip.set(e.trip.id, existing);
  }

  return [...byTrip.values()];
}

/** Replay a completed trip's path for the safety dashboard. */
export async function getTripReplay(tenantId: string, tripId: string) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, tenantId },
    select: {
      id: true,
      tripDate: true,
      direction: true,
      status: true,
      startedAt: true,
      endedAt: true,
      distanceKm: true,
      maxSpeedKmph: true,
      avgSpeedKmph: true,
      studentsBoarded: true,
      studentsAlighted: true,
      route: { select: { name: true, polyline: true } },
      vehicle: { select: { registrationNo: true } },
      driver: { select: { firstName: true, lastName: true } },
      safetyAlerts: {
        select: { id: true, type: true, severity: true, message: true, occurredAt: true },
        orderBy: { occurredAt: 'asc' },
      },
      studentEvents: {
        select: {
          event: true,
          occurredAt: true,
          student: { select: { firstName: true, lastName: true, admissionNo: true } },
        },
        orderBy: { occurredAt: 'asc' },
      },
    },
  });

  if (!trip) throw AppError.notFound('Trip');

  const pings = await prisma.locationPing.findMany({
    where: { tripId },
    orderBy: { recordedAt: 'asc' },
    select: { latitude: true, longitude: true, speedKmph: true, recordedAt: true },
  });

  return { ...trip, path: pings };
}
