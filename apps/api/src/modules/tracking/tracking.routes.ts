/**
 * Live GPS & safety endpoints (PRD §9.1).
 *
 * Two authentication modes coexist here:
 *   * `/location/update` accepts a **device token** — hardware trackers and the
 *     driver app have no user session when reporting position.
 *   * Everything else requires a user JWT, and location reads additionally pass
 *     `assertLocationAccess`, the strictest guard in the system.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ok, created, paginated, pageParams } from '../../core/http/respond.js';
import {
  validate,
  uuidSchema,
  latitude,
  longitude,
  idParam,
} from '../../core/http/validate.js';
import { authenticate, requireAuth, requirePermission } from '../../core/auth/middleware.js';
import { assertLocationAccess, scopedRequest } from '../../core/tenancy/scope.js';
import { recordLocationView, auditFromRequest } from '../../core/audit/audit.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { prisma } from '../../core/db/prisma.js';
import { safeCompare } from '../../core/auth/password.js';
import { gpsPingsReceived } from '../../core/observability/metrics.js';
import { env } from '../../config/env.js';
import * as tracking from './tracking.service.js';

const router = Router();

// ---------------------------------------------------------------------------
// Device ingestion (device-token auth)
// ---------------------------------------------------------------------------

const locationUpdateSchema = z.object({
  latitude,
  longitude,
  speed: z.coerce.number().min(0).max(300).default(0),
  heading: z.coerce.number().min(0).max(360).default(0),
  accuracy: z.coerce.number().min(0).optional(),
  altitude: z.coerce.number().optional(),
  ignition: z.boolean().optional(),
  battery: z.coerce.number().min(0).max(100).optional(),
  recordedAt: z.coerce.date().optional(),
});

/** Offline-mode support: the driver app flushes a queued batch on reconnect. */
const locationBatchSchema = z.object({
  pings: z.array(locationUpdateSchema).min(1).max(500),
});

/**
 * Authenticate a tracking device by its `X-Device-Token` header. Falls through
 * to normal user auth when the header is absent, so the driver app can post
 * with its user session instead.
 */
const deviceOrUserAuth = asyncHandler(async (req, res, next) => {
  const deviceToken = req.headers['x-device-token'];

  if (typeof deviceToken !== 'string' || deviceToken.length === 0) {
    return authenticate(req, res, next);
  }

  const device = await prisma.trackingDevice.findFirst({
    where: { deviceImei: String(req.headers['x-device-imei'] ?? '') },
    select: {
      authToken: true,
      isActive: true,
      deviceImei: true,
      vehicle: { select: { id: true, tenantId: true } },
    },
  });

  // Constant-time compare so a wrong token cannot be discovered byte by byte.
  if (!device?.isActive || !safeCompare(device.authToken, deviceToken)) {
    throw AppError.unauthenticated('Invalid device credentials');
  }

  res.locals['device'] = device;
  next();
});

router.post(
  '/location/update',
  deviceOrUserAuth,
  validate({ body: locationUpdateSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof locationUpdateSchema>;
    const { tenantId, vehicleId, imei } = await resolveReporter(req, res);

    gpsPingsReceived.inc({ transport: 'http' });

    await tracking.ingestLocation(
      tenantId,
      vehicleId,
      {
        latitude: body.latitude,
        longitude: body.longitude,
        speedKmph: body.speed,
        heading: body.heading,
        accuracyMeters: body.accuracy ?? null,
        altitude: body.altitude ?? null,
        ignitionOn: body.ignition ?? null,
        batteryLevel: body.battery ?? null,
        recordedAt: body.recordedAt ?? new Date(),
      },
      imei,
    );

    return created(res, { accepted: true });
  }),
);

router.post(
  '/location/batch',
  deviceOrUserAuth,
  validate({ body: locationBatchSchema }),
  asyncHandler(async (req, res) => {
    const { pings } = req.body as z.infer<typeof locationBatchSchema>;
    const { tenantId, vehicleId, imei } = await resolveReporter(req, res);

    gpsPingsReceived.inc({ transport: 'http-batch' }, pings.length);

    // Replay in chronological order so geofence transitions fire correctly.
    const ordered = [...pings].sort(
      (a, b) =>
        (a.recordedAt?.getTime() ?? 0) - (b.recordedAt?.getTime() ?? 0),
    );

    for (const ping of ordered) {
      await tracking.ingestLocation(
        tenantId,
        vehicleId,
        {
          latitude: ping.latitude,
          longitude: ping.longitude,
          speedKmph: ping.speed,
          heading: ping.heading,
          accuracyMeters: ping.accuracy ?? null,
          altitude: ping.altitude ?? null,
          ignitionOn: ping.ignition ?? null,
          batteryLevel: ping.battery ?? null,
          recordedAt: ping.recordedAt ?? new Date(),
        },
        imei,
      );
    }

    return created(res, { accepted: ordered.length });
  }),
);

/**
 * Work out which vehicle a position report belongs to — either from the
 * authenticated device, or from the driver's active trip.
 */
async function resolveReporter(
  req: Request,
  res: Response,
): Promise<{ tenantId: string; vehicleId: string; imei?: string }> {
  const device = res.locals['device'] as
    | { deviceImei: string; vehicle: { id: string; tenantId: string } }
    | undefined;

  if (device) {
    return {
      tenantId: device.vehicle.tenantId,
      vehicleId: device.vehicle.id,
      imei: device.deviceImei,
    };
  }

  const auth = requireAuth(req);
  if (auth.role !== 'DRIVER' || !auth.employeeId) {
    throw AppError.forbidden('Only a driver or a registered device may report location');
  }

  const trip = await prisma.trip.findFirst({
    where: { driverId: auth.employeeId, status: 'IN_PROGRESS' },
    select: { vehicleId: true },
  });

  if (!trip) throw AppError.conflict('Start a trip before reporting location');

  return { tenantId: auth.tenantId, vehicleId: trip.vehicleId };
}

// ---------------------------------------------------------------------------
// Authenticated reads and actions
// ---------------------------------------------------------------------------

router.use(authenticate);

/** Live position of one vehicle. */
router.get(
  '/vehicle/:id/live',
  requirePermission('tracking:view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const vehicleId = req.params['id']!;

    const state = await tracking.getLiveVehicle(auth.tenantId, vehicleId);
    await recordLocationView(req, { vehicleId, purpose: 'LIVE_VEHICLE_VIEW' });

    return ok(res, state);
  }),
);

/** Fleet overview for the Admin safety dashboard. */
router.get(
  '/fleet/live',
  requirePermission('tracking:view'),
  asyncHandler(async (req, res) => {
    const { auth, tenant } = scopedRequest(req);

    const vehicles = await prisma.vehicle.findMany({
      where: { ...tenant, status: 'ACTIVE', hasGpsDevice: true },
      select: { id: true },
    });

    const states = await Promise.all(
      vehicles.map((v) => tracking.getLiveVehicle(auth.tenantId, v.id).catch(() => null)),
    );

    return ok(res, states.filter((s) => s !== null));
  }),
);

/**
 * A child's live location — the Parent App's primary screen.
 * PRD 6.3: only a verified guardian (or an authorised admin) may call this,
 * and every call is written to the location access log.
 */
router.get(
  '/student/:id/live',
  requirePermission('tracking:view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const studentId = req.params['id']!;

    assertLocationAccess(auth, studentId);

    const view = await tracking.getStudentLiveView(auth.tenantId, studentId);
    await recordLocationView(req, { studentId, purpose: 'PARENT_LIVE_VIEW' });

    return ok(res, view);
  }),
);

/** 30-day trip history (PRD 6.1), window configurable per tenant. */
router.get(
  '/student/:id/history',
  requirePermission('tracking:view'),
  validate({
    params: idParam,
    query: z.object({ days: z.coerce.number().int().min(1).max(90).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const studentId = req.params['id']!;

    assertLocationAccess(auth, studentId);

    const days = Number(req.query['days'] ?? env.LOCATION_RETENTION_DAYS);
    const history = await tracking.getStudentTripHistory(studentId, days);

    await recordLocationView(req, { studentId, purpose: 'TRIP_HISTORY' });

    return ok(res, history, { days });
  }),
);

/** Full replay of a completed trip, for incident review. */
router.get(
  '/trip/:id/replay',
  requirePermission('tracking:view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const replay = await tracking.getTripReplay(auth.tenantId, req.params['id']!);
    return ok(res, replay);
  }),
);

// --- SOS -------------------------------------------------------------------

const sosSchema = z.object({
  latitude,
  longitude,
  message: z.string().max(500).optional(),
  category: z.enum(['MEDICAL', 'ACCIDENT', 'SECURITY', 'BREAKDOWN', 'OTHER']).optional(),
  vehicleId: uuidSchema.optional(),
  tripId: uuidSchema.optional(),
  studentId: uuidSchema.optional(),
});

router.post(
  '/sos',
  requirePermission('tracking:create'),
  validate({ body: sosSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as z.infer<typeof sosSchema>;

    const result = await tracking.raiseSos(auth.tenantId, auth.userId, auth.fullName, {
      latitude: body.latitude,
      longitude: body.longitude,
      message: body.message ?? null,
      category: body.category,
      vehicleId: body.vehicleId ?? null,
      tripId: body.tripId ?? null,
      studentId: body.studentId ?? null,
    });

    await auditFromRequest(req, {
      action: 'SOS_TRIGGER',
      module: 'tracking',
      entityType: 'SosAlert',
      entityId: result.alertId,
      after: { latitude: body.latitude, longitude: body.longitude, category: body.category },
    });

    return created(res, result);
  }),
);

router.get(
  '/sos',
  requirePermission('tracking:view'),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);

    const status = req.query['status'] as string | undefined;

    const where = {
      tenantId: auth.tenantId,
      ...(status ? { status: status as never } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.sosAlert.findMany({
        where,
        skip,
        take,
        orderBy: { triggeredAt: 'desc' },
        select: {
          id: true,
          status: true,
          category: true,
          message: true,
          latitude: true,
          longitude: true,
          address: true,
          triggeredAt: true,
          acknowledgedAt: true,
          resolvedAt: true,
          notifiedCount: true,
          raisedBy: { select: { firstName: true, lastName: true, role: true } },
          vehicle: { select: { registrationNo: true } },
        },
      }),
      prisma.sosAlert.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }),
);

router.post(
  '/sos/:id/acknowledge',
  requirePermission('tracking:update'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    await tracking.acknowledgeSos(auth.tenantId, req.params['id']!, auth.userId);

    await auditFromRequest(req, {
      action: 'SOS_ACKNOWLEDGE',
      module: 'tracking',
      entityType: 'SosAlert',
      entityId: req.params['id']!,
    });

    return ok(res, { acknowledged: true });
  }),
);

router.post(
  '/sos/:id/resolve',
  requirePermission('tracking:update'),
  validate({
    params: idParam,
    body: z.object({
      notes: z.string().min(1).max(1000),
      falseAlarm: z.boolean().default(false),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { notes, falseAlarm } = req.body as { notes: string; falseAlarm: boolean };

    await tracking.resolveSos(auth.tenantId, req.params['id']!, auth.userId, notes, falseAlarm);
    return ok(res, { resolved: true });
  }),
);

// --- Safety alerts ---------------------------------------------------------

router.get(
  '/alerts',
  requirePermission('tracking:view'),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);

    const where = {
      tenantId: auth.tenantId,
      ...(req.query['type'] ? { type: req.query['type'] as never } : {}),
      ...(req.query['severity'] ? { severity: req.query['severity'] as never } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.safetyAlert.findMany({
        where,
        skip,
        take,
        orderBy: { occurredAt: 'desc' },
        select: {
          id: true,
          type: true,
          severity: true,
          message: true,
          details: true,
          latitude: true,
          longitude: true,
          occurredAt: true,
          acknowledgedAt: true,
          vehicle: { select: { registrationNo: true } },
        },
      }),
      prisma.safetyAlert.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }),
);

// --- Geofences -------------------------------------------------------------

const geofenceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['SCHOOL', 'HOME', 'BUS_STOP', 'RESTRICTED']),
  shape: z.enum(['CIRCLE', 'POLYGON']).default('CIRCLE'),
  centerLatitude: latitude.optional(),
  centerLongitude: longitude.optional(),
  radiusMeters: z.coerce.number().int().min(20).max(50_000).optional(),
  polygon: z.array(z.object({ latitude, longitude })).min(3).optional(),
  studentId: uuidSchema.optional(),
  notifyOnEntry: z.boolean().default(true),
  notifyOnExit: z.boolean().default(true),
  cooldownMinutes: z.coerce.number().int().min(0).max(180).default(5),
})
  // A circle needs a centre and radius; a polygon needs its ring.
  .refine(
    (d) =>
      d.shape === 'POLYGON'
        ? Array.isArray(d.polygon)
        : d.centerLatitude !== undefined &&
          d.centerLongitude !== undefined &&
          d.radiusMeters !== undefined,
    { message: 'Provide a polygon for POLYGON fences, or centre and radius for CIRCLE fences' },
  );

router.get(
  '/geofences',
  requirePermission('tracking:view'),
  asyncHandler(async (req, res) => {
    const { tenant } = scopedRequest(req);
    const items = await prisma.geofence.findMany({
      where: { tenantId: tenant.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return ok(res, items);
  }),
);

router.post(
  '/geofences',
  requirePermission('tracking:create'),
  validate({ body: geofenceSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as z.infer<typeof geofenceSchema>;

    const fence = await prisma.geofence.create({
      data: {
        tenantId: auth.tenantId,
        branchId: auth.branchId,
        name: body.name,
        type: body.type,
        shape: body.shape,
        centerLatitude: body.centerLatitude ?? null,
        centerLongitude: body.centerLongitude ?? null,
        radiusMeters: body.radiusMeters ?? null,
        polygon: (body.polygon as never) ?? undefined,
        studentId: body.studentId ?? null,
        notifyOnEntry: body.notifyOnEntry,
        notifyOnExit: body.notifyOnExit,
        cooldownMinutes: body.cooldownMinutes,
      },
    });

    await auditFromRequest(req, {
      action: 'CREATE',
      module: 'tracking',
      entityType: 'Geofence',
      entityId: fence.id,
      after: fence,
    });

    return created(res, fence);
  }),
);

router.delete(
  '/geofences/:id',
  requirePermission('tracking:delete'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);

    const { count } = await prisma.geofence.deleteMany({
      where: { id: req.params['id']!, tenantId: auth.tenantId },
    });

    if (count === 0) throw AppError.notFound('Geofence');

    await auditFromRequest(req, {
      action: 'DELETE',
      module: 'tracking',
      entityType: 'Geofence',
      entityId: req.params['id']!,
    });

    return ok(res, { deleted: true });
  }),
);

/** Location-access audit trail — who viewed which child, and when. */
router.get(
  '/access-log',
  requirePermission('tracking:view', 'settings:view'),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);

    const [items, total] = await Promise.all([
      prisma.locationAccessLog.findMany({
        where: { viewer: { tenantId: auth.tenantId } },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          purpose: true,
          ipAddress: true,
          createdAt: true,
          viewer: { select: { firstName: true, lastName: true, role: true } },
          student: { select: { firstName: true, lastName: true, admissionNo: true } },
        },
      }),
      prisma.locationAccessLog.count({ where: { viewer: { tenantId: auth.tenantId } } }),
    ]);

    return paginated(res, items, total, page, limit);
  }),
);

export default router;
