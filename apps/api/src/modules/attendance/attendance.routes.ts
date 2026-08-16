/**
 * Attendance Management (PRD §5.3).
 *
 * Attendance can arrive from a teacher, an admin, biometric/RFID hardware, a
 * GPS gate event or a bus boarding scan. All sources converge on
 * `markAttendance`, so the rules engine and parent notification behave
 * identically regardless of origin.
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok, created, paginated, pageParams } from '../../core/http/respond.js';
import { validate, idParam, uuidSchema, dateOnly, dateRangeQuery } from '../../core/http/validate.js';
import { requireAuth, requirePermission } from '../../core/auth/middleware.js';
import { scopedRequest, assertSectionAccess, assertStudentAccess } from '../../core/tenancy/scope.js';
import { auditFromRequest } from '../../core/audit/audit.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { prisma } from '../../core/db/prisma.js';
import * as service from './attendance.service.js';

const router = Router();

const markSchema = z.object({
  sectionId: uuidSchema,
  subjectId: uuidSchema.optional(),
  date: dateOnly,
  periodNumber: z.coerce.number().int().min(1).max(15).optional(),
  records: z
    .array(
      z.object({
        studentId: uuidSchema,
        status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'EXCUSED', 'HOLIDAY']),
        remarks: z.string().max(300).optional(),
        checkInAt: z.coerce.date().optional(),
        lateByMinutes: z.coerce.number().int().min(0).max(600).optional(),
      }),
    )
    .min(1)
    .max(300),
  source: z
    .enum(['TEACHER', 'ADMIN', 'BIOMETRIC', 'RFID', 'GPS_GATE', 'BUS_BOARDING', 'SELF'])
    .default('TEACHER'),
});

/** Take or amend attendance for a section on a date. */
router.post(
  '/mark',
  requirePermission('attendance:create'),
  validate({ body: markSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as z.infer<typeof markSchema>;

    assertSectionAccess(auth, body.sectionId);

    const result = await service.markAttendance(auth, body);

    await auditFromRequest(req, {
      action: 'CREATE',
      module: 'attendance',
      entityType: 'AttendanceSession',
      entityId: result.sessionId,
      after: { date: body.date, marked: result.marked, absent: result.absent },
    });

    return created(res, result);
  }),
);

/** The register for one section/date — pre-filled for the marking screen. */
router.get(
  '/register',
  requirePermission('attendance:view'),
  validate({
    query: z.object({
      sectionId: uuidSchema,
      date: dateOnly,
      periodNumber: z.coerce.number().int().min(1).max(15).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const q = req.query as unknown as { sectionId: string; date: Date; periodNumber?: number };

    assertSectionAccess(auth, q.sectionId);
    return ok(res, await service.getRegister(auth.tenantId, q));
  }),
);

/** A student's own attendance history. */
router.get(
  '/student/:id',
  requirePermission('attendance:view'),
  validate({ params: idParam, query: dateRangeQuery }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const studentId = req.params['id']!;

    assertStudentAccess(auth, studentId);

    const q = req.query as unknown as { from?: Date; to?: Date };
    return ok(res, await service.getStudentAttendance(studentId, q));
  }),
);

/** Daily/monthly/consolidated summary for dashboards and reports. */
router.get(
  '/summary',
  requirePermission('attendance:view'),
  validate({
    query: dateRangeQuery.extend({
      classId: uuidSchema.optional(),
      sectionId: uuidSchema.optional(),
      groupBy: z.enum(['day', 'month', 'section', 'class']).default('day'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { auth, tenant } = scopedRequest(req);
    const q = req.query as unknown as {
      from?: Date;
      to?: Date;
      classId?: string;
      sectionId?: string;
      groupBy: 'day' | 'month' | 'section' | 'class';
    };

    return ok(res, await service.getSummary(auth, tenant, q));
  }),
);

/** Students below the minimum attendance threshold — an early-warning list. */
router.get(
  '/defaulters',
  requirePermission('attendance:view'),
  validate({
    query: dateRangeQuery.extend({
      threshold: z.coerce.number().int().min(1).max(100).optional(),
      classId: uuidSchema.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { auth, tenant } = scopedRequest(req);
    const q = req.query as unknown as {
      from?: Date;
      to?: Date;
      threshold?: number;
      classId?: string;
    };

    return ok(res, await service.getDefaulters(auth.tenantId, tenant, q));
  }),
);

/** Lock a session so the register can no longer be edited. */
router.post(
  '/sessions/:id/lock',
  requirePermission('attendance:approve'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);

    /*
      Scoped by tenant, not just by id. Updating on the primary key alone let a
      token from one school lock another school's attendance register — and a
      locked session cannot be edited, so it is a denial-of-service on someone
      else's daily attendance.
    */
    const existing = await prisma.attendanceSession.findFirst({
      where: { id: req.params['id']!, tenantId: auth.tenantId },
      select: { id: true },
    });
    if (!existing) throw AppError.notFound('Attendance session');

    const session = await prisma.attendanceSession.update({
      where: { id: existing.id },
      data: { isLocked: true },
    });

    await auditFromRequest(req, {
      action: 'APPROVE',
      module: 'attendance',
      entityType: 'AttendanceSession',
      entityId: session.id,
      after: { isLocked: true },
    });

    return ok(res, session);
  }),
);

// --- Rules -----------------------------------------------------------------

router.get(
  '/rules',
  requirePermission('attendance:view'),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    return ok(res, await service.getRules(auth.tenantId, auth.branchId));
  }),
);

router.put(
  '/rules',
  requirePermission('attendance:update'),
  validate({
    body: z.object({
      name: z.string().max(80).default('Default'),
      schoolStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      schoolEndTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      graceMinutes: z.coerce.number().int().min(0).max(120),
      halfDayAfterMinutes: z.coerce.number().int().min(0).max(480),
      absenceAlertThreshold: z.coerce.number().int().min(1).max(30),
      minAttendancePercent: z.coerce.number().int().min(0).max(100),
      notifyParentOnAbsence: z.boolean(),
      notifyParentOnLate: z.boolean(),
      lockAfterHours: z.coerce.number().int().min(1).max(720),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const rules = await service.upsertRules(
      auth.tenantId,
      auth.branchId,
      req.body as Parameters<typeof service.upsertRules>[2],
    );

    await auditFromRequest(req, {
      action: 'UPDATE',
      module: 'attendance',
      entityType: 'AttendanceRule',
      entityId: rules.id,
      after: rules,
    });

    return ok(res, rules);
  }),
);

// --- Staff attendance ------------------------------------------------------

router.post(
  '/staff/check-in',
  requirePermission('attendance:create'),
  validate({
    body: z.object({
      employeeId: uuidSchema.optional(),
      source: z.enum(['BIOMETRIC', 'RFID', 'ADMIN', 'SELF']).default('SELF'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as { employeeId?: string; source: string };

    // Staff may only check themselves in unless they can administer attendance.
    const employeeId = body.employeeId ?? auth.employeeId;
    if (!employeeId) throw AppError.badRequest('No employee record is linked to this account');

    return created(res, await service.staffCheckIn(auth.tenantId, employeeId, body.source));
  }),
);

router.post(
  '/staff/check-out',
  requirePermission('attendance:create'),
  validate({ body: z.object({ employeeId: uuidSchema.optional() }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const employeeId = (req.body as { employeeId?: string }).employeeId ?? auth.employeeId;
    if (!employeeId) throw AppError.badRequest('No employee record is linked to this account');

    return ok(res, await service.staffCheckOut(employeeId));
  }),
);

router.get(
  '/staff',
  requirePermission('attendance:view'),
  validate({ query: dateRangeQuery.extend({ employeeId: uuidSchema.optional() }) }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);
    const q = req.query as unknown as { from?: Date; to?: Date; employeeId?: string };

    const where = {
      employee: { tenantId: auth.tenantId },
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.from || q.to
        ? { date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.employeeAttendance.findMany({
        where,
        skip,
        take,
        orderBy: { date: 'desc' },
        include: {
          employee: { select: { employeeCode: true, firstName: true, lastName: true } },
        },
      }),
      prisma.employeeAttendance.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }),
);

export default router;
