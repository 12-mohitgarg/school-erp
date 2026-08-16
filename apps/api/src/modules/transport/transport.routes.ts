/** Transport: vehicles, routes, stops, allocations, trips and boarding (PRD §5.8). */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok, created, paginated, pageParams } from '../../core/http/respond.js';
import { validate, idParam, uuidSchema, dateOnly, latitude, longitude, listQuery, timeOfDay, Validated } from '../../core/http/validate.js';
import { requireAuth, requirePermission } from '../../core/auth/middleware.js';
import { scopedRequest, resolveWriteBranch } from '../../core/tenancy/scope.js';
import { auditFromRequest } from '../../core/audit/audit.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { prisma } from '../../core/db/prisma.js';
import { notify, guardianUserIds } from '../../core/notifications/notification.service.js';

const router = Router();

// --- Vehicles --------------------------------------------------------------

router.get('/vehicles', requirePermission('transport:view'),
  validate({ query: listQuery.extend({ status: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const { tenant } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);

    const where = { ...tenant, ...(req.query['status'] ? { status: req.query['status'] as never } : {}) };
    const [items, total] = await Promise.all([
      prisma.vehicle.findMany({ where, skip, take, orderBy: { registrationNo: 'asc' },
        include: { device: { select: { deviceImei: true, lastPingAt: true, batteryLevel: true } },
          routes: { where: { isActive: true }, select: { id: true, name: true } } } }),
      prisma.vehicle.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }));

router.post('/vehicles', requirePermission('transport:create'),
  validate({ body: z.object({
    registrationNo: z.string().trim().min(1).max(20),
    vehicleType: z.enum(['BUS', 'VAN', 'CAR', 'MINIBUS']).default('BUS'),
    make: z.string().max(60).optional(),
    model: z.string().max(60).optional(),
    capacity: z.coerce.number().int().min(1).max(100).default(40),
    insuranceExpiry: dateOnly.optional(),
    fitnessExpiry: dateOnly.optional(),
    permitExpiry: dateOnly.optional(),
    hasGpsDevice: z.boolean().default(true),
    branchId: uuidSchema.optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;
    const branchId = resolveWriteBranch(auth, body['branchId'] as string | undefined);
    const { branchId: _b, ...fields } = body;

    const vehicle = await prisma.vehicle.create({
      data: { tenantId: auth.tenantId, branchId, ...(fields as Validated) },
    });

    await auditFromRequest(req, { action: 'CREATE', module: 'transport', entityType: 'Vehicle', entityId: vehicle.id });
    return created(res, vehicle);
  }));

/** Pair a GPS tracker with a vehicle; returns the device token once. */
router.post('/vehicles/:id/device', requirePermission('transport:update'),
  validate({ params: idParam, body: z.object({
    deviceImei: z.string().trim().min(10).max(20),
    simNumber: z.string().max(20).optional(),
    vendor: z.string().max(60).optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { randomToken } = await import('../../core/auth/password.js');

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: req.params['id']!, tenantId: auth.tenantId }, select: { id: true },
    });
    if (!vehicle) throw AppError.notFound('Vehicle');

    const authToken = randomToken();
    const device = await prisma.trackingDevice.upsert({
      where: { vehicleId: vehicle.id },
      create: { vehicleId: vehicle.id, authToken, ...(req.body as Validated) },
      update: { ...(req.body as Validated), isActive: true },
      select: { id: true, deviceImei: true },
    });

    // The token is shown once at provisioning time and never returned again.
    return created(res, { ...device, authToken });
  }));

// --- Routes & stops --------------------------------------------------------

router.get('/routes', requirePermission('transport:view'), asyncHandler(async (req, res) => {
  const { tenant } = scopedRequest(req);
  return ok(res, await prisma.transportRoute.findMany({
    where: { ...tenant, isActive: true },
    orderBy: { name: 'asc' },
    include: {
      vehicle: { select: { id: true, registrationNo: true, capacity: true } },
      stops: { orderBy: { sequence: 'asc' } },
      _count: { select: { allocations: { where: { isActive: true } } } },
    },
  }));
}));

router.post('/routes', requirePermission('transport:create'),
  validate({ body: z.object({
    name: z.string().trim().min(1).max(120),
    code: z.string().trim().min(1).max(20),
    vehicleId: uuidSchema.optional(),
    driverId: uuidSchema.optional(),
    startStopName: z.string().min(1).max(120),
    endStopName: z.string().min(1).max(120),
    distanceKm: z.coerce.number().min(0).max(500).optional(),
    pickupStartTime: timeOfDay.optional(),
    dropStartTime: timeOfDay.optional(),
    monthlyFare: z.coerce.number().min(0).optional(),
    polyline: z.string().max(50_000).optional(),
    branchId: uuidSchema.optional(),
    stops: z.array(z.object({
      name: z.string().min(1).max(120),
      sequence: z.coerce.number().int().min(1),
      latitude, longitude,
      landmark: z.string().max(160).optional(),
      pickupTime: timeOfDay.optional(),
      dropTime: timeOfDay.optional(),
      radiusMeters: z.coerce.number().int().min(20).max(2000).default(100),
    })).min(1),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;
    const branchId = resolveWriteBranch(auth, body['branchId'] as string | undefined);
    const { branchId: _b, stops, ...fields } = body;

    const route = await prisma.transportRoute.create({
      data: {
        tenantId: auth.tenantId, branchId,
        ...(fields as Validated),
        stops: { create: stops as never },
      },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    });

    await auditFromRequest(req, { action: 'CREATE', module: 'transport', entityType: 'TransportRoute', entityId: route.id });
    return created(res, route);
  }));

// --- Student allocation ----------------------------------------------------

router.post('/allocations', requirePermission('transport:create'),
  validate({ body: z.object({
    studentId: uuidSchema,
    routeId: uuidSchema,
    pickupStopId: uuidSchema,
    dropStopId: uuidSchema.optional(),
    academicYearId: uuidSchema.optional(),
    validFrom: dateOnly,
    monthlyFare: z.coerce.number().min(0).optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;

    // Capacity check: never allocate more students than the bus can seat.
    const route = await prisma.transportRoute.findFirst({
      where: { id: body['routeId'] as string, tenantId: auth.tenantId },
      select: { id: true, vehicle: { select: { capacity: true } },
        _count: { select: { allocations: { where: { isActive: true } } } } },
    });
    if (!route) throw AppError.notFound('Route');

    if (route.vehicle && route._count.allocations >= route.vehicle.capacity) {
      throw AppError.conflict('That route is already at vehicle capacity');
    }

    const allocation = await prisma.transportAllocation.create({ data: body as never });

    await auditFromRequest(req, {
      action: 'CREATE', module: 'transport', entityType: 'TransportAllocation', entityId: allocation.id,
    });

    return created(res, allocation);
  }));

// --- Trips -----------------------------------------------------------------

router.post('/trips/start', requirePermission('transport:update'),
  validate({ body: z.object({
    routeId: uuidSchema,
    direction: z.enum(['PICKUP', 'DROP']),
    startOdometerKm: z.coerce.number().int().min(0).optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    if (!auth.employeeId) throw AppError.forbidden('Only a driver can start a trip');

    const body = req.body as { routeId: string; direction: 'PICKUP' | 'DROP'; startOdometerKm?: number };

    const route = await prisma.transportRoute.findFirst({
      where: { id: body.routeId, tenantId: auth.tenantId },
      select: { id: true, vehicleId: true },
    });
    if (!route?.vehicleId) throw AppError.badRequest('That route has no vehicle assigned');

    // A driver may only run one trip at a time.
    const active = await prisma.trip.findFirst({
      where: { driverId: auth.employeeId, status: 'IN_PROGRESS' }, select: { id: true },
    });
    if (active) throw AppError.conflict('You already have a trip in progress');

    const today = new Date(new Date().toISOString().slice(0, 10));

    const trip = await prisma.trip.upsert({
      where: { routeId_tripDate_direction: { routeId: route.id, tripDate: today, direction: body.direction } },
      create: {
        tenantId: auth.tenantId, routeId: route.id, vehicleId: route.vehicleId,
        driverId: auth.employeeId, tripDate: today, direction: body.direction,
        status: 'IN_PROGRESS', startedAt: new Date(), startOdometerKm: body.startOdometerKm ?? null,
      },
      update: { status: 'IN_PROGRESS', startedAt: new Date(), driverId: auth.employeeId },
    });

    await auditFromRequest(req, { action: 'UPDATE', module: 'transport', entityType: 'Trip', entityId: trip.id,
      after: { status: 'IN_PROGRESS' } });

    return created(res, trip);
  }));

router.post('/trips/:id/end', requirePermission('transport:update'),
  validate({ params: idParam, body: z.object({ endOdometerKm: z.coerce.number().int().min(0).optional() }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const trip = await prisma.trip.findFirst({
      where: { id: req.params['id']!, tenantId: auth.tenantId },
      select: { id: true, status: true, startOdometerKm: true, startedAt: true },
    });
    if (!trip) throw AppError.notFound('Trip');
    if (trip.status !== 'IN_PROGRESS') throw AppError.conflict('That trip is not in progress');

    const endOdo = (req.body as { endOdometerKm?: number }).endOdometerKm;
    const distanceKm = endOdo && trip.startOdometerKm ? endOdo - trip.startOdometerKm : null;

    return ok(res, await prisma.trip.update({
      where: { id: trip.id },
      data: { status: 'COMPLETED', endedAt: new Date(), endOdometerKm: endOdo ?? null,
        distanceKm: distanceKm ?? null },
    }));
  }));

/** Boarding / de-boarding scan — also feeds BUS_BOARDING attendance. */
router.post('/trips/:id/boarding', requirePermission('transport:update'),
  validate({ params: idParam, body: z.object({
    studentId: uuidSchema,
    event: z.enum(['BOARDED', 'ALIGHTED', 'ABSENT']),
    stopId: uuidSchema.optional(),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    method: z.enum(['MANUAL', 'RFID', 'QR', 'FACE']).default('MANUAL'),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;
    const tripId = req.params['id']!;

    const trip = await prisma.trip.findFirst({
      where: { id: tripId, tenantId: auth.tenantId },
      select: { id: true, direction: true, status: true },
    });
    if (!trip) throw AppError.notFound('Trip');
    if (trip.status !== 'IN_PROGRESS') throw AppError.conflict('That trip is not in progress');

    const event = await prisma.tripStudentEvent.upsert({
      where: { tripId_studentId_event: {
        tripId, studentId: body['studentId'] as string, event: body['event'] as never } },
      create: { tripId, recordedById: auth.userId, ...(body as Validated) },
      update: { occurredAt: new Date() },
    });

    // Keep the denormalised occupancy counters honest.
    if (body['event'] === 'BOARDED') {
      await prisma.trip.update({ where: { id: tripId }, data: { studentsBoarded: { increment: 1 } } });
    } else if (body['event'] === 'ALIGHTED') {
      await prisma.trip.update({ where: { id: tripId }, data: { studentsAlighted: { increment: 1 } } });
    }

    // Guardians are told the moment their child boards or gets off.
    const recipients = await guardianUserIds([body['studentId'] as string]);
    if (recipients.length > 0 && body['event'] !== 'ABSENT') {
      const boarded = body['event'] === 'BOARDED';
      void notify({
        tenantId: auth.tenantId,
        userIds: recipients,
        title: boarded ? 'Child boarded the bus' : 'Child got off the bus',
        body: `Recorded at ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.`,
        channels: ['IN_APP', 'PUSH'],
        priority: 'HIGH',
        module: 'transport',
        actionUrl: '/parent/tracking',
      }).catch(() => undefined);

      await prisma.tripStudentEvent.update({
        where: { id: event.id }, data: { guardianNotifiedAt: new Date() },
      });
    }

    return created(res, event);
  }));

/** The driver's manifest for a trip: who to expect at each stop. */
router.get('/trips/:id/manifest', requirePermission('transport:view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const tripId = req.params['id']!;

    const trip = await prisma.trip.findFirst({
      where: { id: tripId, tenantId: auth.tenantId },
      select: { id: true, direction: true, routeId: true,
        studentEvents: { select: { studentId: true, event: true, occurredAt: true } } },
    });
    if (!trip) throw AppError.notFound('Trip');

    const allocations = await prisma.transportAllocation.findMany({
      where: { routeId: trip.routeId, isActive: true },
      select: {
        pickupStop: { select: { id: true, name: true, sequence: true } },
        student: { select: { id: true, admissionNo: true, firstName: true, lastName: true, photoUrl: true,
          enrollments: { where: { isCurrent: true }, take: 1,
            select: { class: { select: { name: true } }, section: { select: { name: true } } } } } },
      },
    });

    const statusByStudent = new Map(trip.studentEvents.map((e) => [e.studentId, e.event]));

    return ok(res, {
      tripId, direction: trip.direction,
      students: allocations.map((a) => ({
        studentId: a.student.id,
        admissionNo: a.student.admissionNo,
        fullName: `${a.student.firstName} ${a.student.lastName}`,
        photoUrl: a.student.photoUrl,
        className: a.student.enrollments[0]?.class.name ?? null,
        sectionName: a.student.enrollments[0]?.section.name ?? null,
        stop: a.pickupStop,
        status: statusByStudent.get(a.student.id) ?? 'PENDING',
      })).sort((a, b) => (a.stop?.sequence ?? 0) - (b.stop?.sequence ?? 0)),
    });
  }));

/** The trip assigned to the signed-in driver right now. */
router.get('/my-trip', requirePermission('transport:view'), asyncHandler(async (req, res) => {
  const auth = requireAuth(req);
  if (!auth.employeeId) throw AppError.forbidden('No employee record is linked to this account');

  const trip = await prisma.trip.findFirst({
    where: { driverId: auth.employeeId, status: 'IN_PROGRESS' },
    include: {
      route: { select: { id: true, name: true, polyline: true, stops: { orderBy: { sequence: 'asc' } } } },
      vehicle: { select: { id: true, registrationNo: true, capacity: true } },
    },
  });

  return ok(res, trip);
}));

export default router;
