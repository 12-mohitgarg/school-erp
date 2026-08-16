/**
 * Academic Management: academic years, classes, sections, subjects, rooms,
 * timetable with clash detection, substitutions, lesson plans and the
 * academic calendar (PRD section 5.1).
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok, created, paginated, pageParams } from '../../core/http/respond.js';
import {
  validate,
  idParam,
  uuidSchema,
  dateOnly,
  timeOfDay,
  listQuery, Validated } from '../../core/http/validate.js';
import { requireAuth, requirePermission } from '../../core/auth/middleware.js';
import { scopedRequest, resolveWriteBranch } from '../../core/tenancy/scope.js';
import { auditFromRequest } from '../../core/audit/audit.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { prisma } from '../../core/db/prisma.js';
import { cached, cacheInvalidateTag, keys } from '../../core/cache/redis.js';
import * as service from './academic.service.js';

const router = Router();

// ---------------------------------------------------------------------------
// Academic years
// ---------------------------------------------------------------------------

router.get(
  '/years',
  requirePermission('academic:view'),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    return ok(
      res,
      await prisma.academicYear.findMany({
        where: { tenantId: auth.tenantId },
        orderBy: { startDate: 'desc' },
      }),
    );
  }),
);

router.post(
  '/years',
  requirePermission('academic:create'),
  validate({
    body: z
      .object({
        name: z.string().trim().min(4).max(20),
        startDate: dateOnly,
        endDate: dateOnly,
        isCurrent: z.boolean().default(false),
      })
      .refine((d) => d.endDate > d.startDate, {
        message: 'End date must be after the start date',
        path: ['endDate'],
      }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as { name: string; startDate: Date; endDate: Date; isCurrent: boolean };

    const year = await service.createAcademicYear(auth.tenantId, body);

    await auditFromRequest(req, {
      action: 'CREATE',
      module: 'academic',
      entityType: 'AcademicYear',
      entityId: year.id,
      after: year,
    });

    return created(res, year);
  }),
);

router.post(
  '/years/:id/activate',
  requirePermission('academic:update'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const year = await service.activateAcademicYear(auth.tenantId, req.params['id']!);

    await auditFromRequest(req, {
      action: 'UPDATE',
      module: 'academic',
      entityType: 'AcademicYear',
      entityId: year.id,
      after: { isCurrent: true },
    });

    return ok(res, year);
  }),
);

// ---------------------------------------------------------------------------
// Classes & sections
// ---------------------------------------------------------------------------

router.get(
  '/classes',
  requirePermission('academic:view'),
  asyncHandler(async (req, res) => {
    const { tenant } = scopedRequest(req);

    // Class structure changes a few times a year but is fetched on almost
    // every screen (student filters, form pickers, timetables). Against a
    // database 300ms away, caching it is the difference between a page
    // feeling instant and feeling broken. Invalidated by the class/section
    // write endpoints below.
    const cacheKey = `${keys.dashboard(tenant.tenantId, 'classes', tenant.branchId ?? null)}`;

    return ok(
      res,
      await cached(cacheKey, 300, () => service.listClasses(tenant), [
        keys.tag(tenant.tenantId, 'academic'),
      ]),
    );
  }),
);

router.post(
  '/classes',
  requirePermission('academic:create'),
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(60),
      code: z.string().trim().min(1).max(20),
      level: z.coerce.number().int().min(0).max(20),
      stream: z.string().max(40).optional(),
      branchId: uuidSchema.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;
    const branchId = resolveWriteBranch(auth, body['branchId'] as string | undefined);

    const created_ = await prisma.class.create({
      data: {
        tenantId: auth.tenantId,
        branchId,
        name: body['name'] as string,
        code: body['code'] as string,
        level: body['level'] as number,
        stream: (body['stream'] as string) ?? null,
      },
    });

    await cacheInvalidateTag(keys.tag(auth.tenantId, 'academic'));

    await auditFromRequest(req, {
      action: 'CREATE',
      module: 'academic',
      entityType: 'Class',
      entityId: created_.id,
      after: created_,
    });

    return created(res, created_);
  }),
);

router.post(
  '/classes/:id/sections',
  requirePermission('academic:create'),
  validate({
    params: idParam,
    body: z.object({
      name: z.string().trim().min(1).max(20),
      capacity: z.coerce.number().int().min(1).max(200).default(40),
      classTeacherId: uuidSchema.optional(),
      roomId: uuidSchema.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const classId = req.params['id']!;

    const parent = await prisma.class.findFirst({
      where: { id: classId, tenantId: auth.tenantId },
      select: { id: true },
    });
    if (!parent) throw AppError.notFound('Class');

    const body = req.body as Record<string, unknown>;
    // The class list embeds sections, so it is now stale.
    const section = await prisma.section.create({
      data: {
        classId,
        name: body['name'] as string,
        capacity: body['capacity'] as number,
        classTeacherId: (body['classTeacherId'] as string) ?? null,
        roomId: (body['roomId'] as string) ?? null,
      },
    });

    await cacheInvalidateTag(keys.tag(auth.tenantId, 'academic'));
    return created(res, section);
  }),
);

router.get(
  '/sections/:id/students',
  requirePermission('academic:view', 'student:view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    return ok(res, await service.listSectionStudents(auth, req.params['id']!));
  }),
);

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

router.get(
  '/subjects',
  requirePermission('academic:view'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);

    const where = { tenantId: auth.tenantId, isActive: true };
    const [items, total] = await Promise.all([
      prisma.subject.findMany({ where, skip, take, orderBy: { name: 'asc' } }),
      prisma.subject.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }),
);

router.post(
  '/subjects',
  requirePermission('academic:create'),
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(80),
      code: z.string().trim().min(1).max(20),
      isElective: z.boolean().default(false),
      hasPractical: z.boolean().default(false),
      credits: z.coerce.number().int().min(1).max(10).default(1),
      colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366F1'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const subject = await prisma.subject.create({
      data: { tenantId: auth.tenantId, ...(req.body as Validated) },
    });
    return created(res, subject);
  }),
);

/** Assign a subject (and its teacher) to a class/section. */
router.post(
  '/class-subjects',
  requirePermission('academic:create'),
  validate({
    body: z.object({
      classId: uuidSchema,
      sectionId: uuidSchema.optional(),
      subjectId: uuidSchema,
      teacherId: uuidSchema.optional(),
      weeklyPeriods: z.coerce.number().int().min(1).max(20).default(5),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;

    const link = await prisma.classSubject.create({
      data: {
        classId: body['classId'] as string,
        sectionId: (body['sectionId'] as string) ?? null,
        subjectId: body['subjectId'] as string,
        teacherId: (body['teacherId'] as string) ?? null,
        weeklyPeriods: body['weeklyPeriods'] as number,
      },
    });

    return created(res, link);
  }),
);

// ---------------------------------------------------------------------------
// Timetable
// ---------------------------------------------------------------------------

router.get(
  '/timetable',
  requirePermission('academic:view'),
  validate({
    query: z.object({
      sectionId: uuidSchema.optional(),
      teacherId: uuidSchema.optional(),
      academicYearId: uuidSchema.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const q = req.query as { sectionId?: string; teacherId?: string; academicYearId?: string };

    if (!q.sectionId && !q.teacherId) {
      throw AppError.badRequest('Provide either sectionId or teacherId');
    }

    return ok(res, await service.getTimetable(auth.tenantId, q));
  }),
);

const timetableSlotSchema = z.object({
  academicYearId: uuidSchema,
  classId: uuidSchema,
  sectionId: uuidSchema,
  subjectId: uuidSchema,
  teacherId: uuidSchema.optional(),
  roomId: uuidSchema.optional(),
  dayOfWeek: z.coerce.number().int().min(1).max(7),
  periodNumber: z.coerce.number().int().min(1).max(15),
  startTime: timeOfDay,
  endTime: timeOfDay,
  isBreak: z.boolean().default(false),
});

router.post(
  '/timetable',
  requirePermission('academic:create'),
  validate({ body: timetableSlotSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as z.infer<typeof timetableSlotSchema>;

    const slot = await service.createTimetableSlot(auth.tenantId, body);

    await auditFromRequest(req, {
      action: 'CREATE',
      module: 'academic',
      entityType: 'TimetableSlot',
      entityId: slot.id,
      after: slot,
    });

    return created(res, slot);
  }),
);

router.delete(
  '/timetable/:id',
  requirePermission('academic:delete'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { count } = await prisma.timetableSlot.deleteMany({
      where: { id: req.params['id']!, tenantId: auth.tenantId },
    });
    if (count === 0) throw AppError.notFound('Timetable slot');
    return ok(res, { deleted: true });
  }),
);

/** Cover a teacher's absence for a date (PRD gap: substitution engine). */
router.post(
  '/substitutions',
  requirePermission('academic:create'),
  validate({
    body: z.object({
      slotId: uuidSchema,
      date: dateOnly,
      substituteTeacherId: uuidSchema,
      reason: z.string().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as {
      slotId: string;
      date: Date;
      substituteTeacherId: string;
      reason?: string;
    };

    const sub = await service.arrangeSubstitution(auth, body);

    await auditFromRequest(req, {
      action: 'CREATE',
      module: 'academic',
      entityType: 'Substitution',
      entityId: sub.id,
      after: sub,
    });

    return created(res, sub);
  }),
);

/** Teachers free during a given period — powers the substitute picker. */
router.get(
  '/substitutions/available',
  requirePermission('academic:view'),
  validate({
    query: z.object({
      date: dateOnly,
      dayOfWeek: z.coerce.number().int().min(1).max(7),
      periodNumber: z.coerce.number().int().min(1).max(15),
      subjectId: uuidSchema.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const q = req.query as unknown as {
      date: Date;
      dayOfWeek: number;
      periodNumber: number;
      subjectId?: string;
    };

    return ok(res, await service.findAvailableTeachers(auth.tenantId, q));
  }),
);

// ---------------------------------------------------------------------------
// Lesson plans & materials
// ---------------------------------------------------------------------------

router.get(
  '/lesson-plans',
  requirePermission('academic:view'),
  validate({ query: listQuery.extend({ subjectId: uuidSchema.optional() }) }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);

    const where = {
      // Teachers see only their own plans; coordinators see the whole subject.
      ...(auth.scope === 'ASSIGNED' && auth.employeeId ? { teacherId: auth.employeeId } : {}),
      ...(req.query['subjectId'] ? { subjectId: req.query['subjectId'] as string } : {}),
      subject: { tenantId: auth.tenantId },
    };

    const [items, total] = await Promise.all([
      prisma.lessonPlan.findMany({
        where,
        skip,
        take,
        orderBy: { plannedDate: 'desc' },
        include: {
          subject: { select: { name: true, code: true } },
          teacher: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.lessonPlan.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }),
);

router.post(
  '/lesson-plans',
  requirePermission('academic:update'),
  validate({
    body: z.object({
      subjectId: uuidSchema,
      classId: uuidSchema.optional(),
      title: z.string().trim().min(1).max(200),
      unit: z.string().max(120).optional(),
      description: z.string().max(4000).optional(),
      objectives: z.string().max(2000).optional(),
      plannedDate: dateOnly,
      progressPercent: z.coerce.number().int().min(0).max(100).default(0),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    if (!auth.employeeId) throw AppError.forbidden('Only teaching staff can create lesson plans');

    const plan = await prisma.lessonPlan.create({
      data: { teacherId: auth.employeeId, ...(req.body as Validated) },
    });

    return created(res, plan);
  }),
);

// ---------------------------------------------------------------------------
// Academic calendar
// ---------------------------------------------------------------------------

router.get(
  '/calendar',
  requirePermission('academic:view'),
  validate({ query: z.object({ from: dateOnly.optional(), to: dateOnly.optional() }) }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const q = req.query as unknown as { from?: Date; to?: Date };

    return ok(
      res,
      await prisma.calendarEvent.findMany({
        where: {
          tenantId: auth.tenantId,
          ...(q.from || q.to
            ? { startDate: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
            : {}),
        },
        orderBy: { startDate: 'asc' },
      }),
    );
  }),
);

router.post(
  '/calendar',
  requirePermission('academic:create'),
  validate({
    body: z.object({
      title: z.string().trim().min(1).max(200),
      description: z.string().max(2000).optional(),
      eventType: z.enum(['HOLIDAY', 'EXAM', 'EVENT', 'PTM', 'SPORTS', 'CULTURAL', 'ADMIN']),
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
      isAllDay: z.boolean().default(true),
      location: z.string().max(200).optional(),
      colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#4F46E5'),
      audienceType: z
        .enum(['INSTITUTION', 'BRANCH', 'CLASS', 'SECTION', 'ROLE', 'INDIVIDUAL'])
        .default('INSTITUTION'),
      audienceIds: z.array(z.string()).default([]),
      rsvpEnabled: z.boolean().default(false),
      academicYearId: uuidSchema.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const event = await prisma.calendarEvent.create({
      data: { tenantId: auth.tenantId, ...(req.body as Validated) },
    });

    await auditFromRequest(req, {
      action: 'CREATE',
      module: 'academic',
      entityType: 'CalendarEvent',
      entityId: event.id,
    });

    return created(res, event);
  }),
);

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

router.get(
  '/rooms',
  requirePermission('academic:view'),
  asyncHandler(async (req, res) => {
    const { tenant } = scopedRequest(req);
    return ok(
      res,
      await prisma.room.findMany({ where: { ...tenant, isActive: true }, orderBy: { name: 'asc' } }),
    );
  }),
);

router.post(
  '/rooms',
  requirePermission('academic:create'),
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(80),
      code: z.string().trim().min(1).max(20),
      roomType: z.enum(['CLASSROOM', 'LAB', 'AUDITORIUM', 'LIBRARY', 'SPORTS']).default('CLASSROOM'),
      capacity: z.coerce.number().int().min(1).max(1000).default(40),
      floor: z.string().max(20).optional(),
      building: z.string().max(80).optional(),
      branchId: uuidSchema.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;
    const branchId = resolveWriteBranch(auth, body['branchId'] as string | undefined);
    const { branchId: _b, ...fields } = body;

    const room = await prisma.room.create({
      data: { tenantId: auth.tenantId, branchId, ...(fields as Validated) },
    });

    return created(res, room);
  }),
);

export default router;

