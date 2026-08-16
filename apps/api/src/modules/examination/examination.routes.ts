/** Examination & LMS-lite: exams, marks, report cards, assignments (PRD section 5.4). */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok, created, paginated, pageParams } from '../../core/http/respond.js';
import { validate, idParam, uuidSchema, dateOnly, listQuery, Validated } from '../../core/http/validate.js';
import { requireAuth, requirePermission } from '../../core/auth/middleware.js';
import { scopedRequest, assertStudentAccess } from '../../core/tenancy/scope.js';
import { auditFromRequest } from '../../core/audit/audit.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { prisma } from '../../core/db/prisma.js';
import * as service from './examination.service.js';

const router = Router();

// --- Terms & exams ---------------------------------------------------------

router.get(
  '/terms',
  requirePermission('examination:view'),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    return ok(
      res,
      await prisma.examTerm.findMany({
        where: { tenantId: auth.tenantId },
        orderBy: { sequence: 'asc' },
        include: { academicYear: { select: { name: true } } },
      }),
    );
  }),
);

router.post(
  '/terms',
  requirePermission('examination:create'),
  validate({
    body: z.object({
      academicYearId: uuidSchema,
      name: z.string().trim().min(1).max(80),
      sequence: z.coerce.number().int().min(1).max(20),
      startDate: dateOnly,
      endDate: dateOnly,
      weightPercent: z.coerce.number().int().min(1).max(100).default(100),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const term = await prisma.examTerm.create({
      data: { tenantId: auth.tenantId, ...(req.body as Validated) },
    });
    return created(res, term);
  }),
);

router.get(
  '/exams',
  requirePermission('examination:view'),
  validate({ query: listQuery.extend({ classId: uuidSchema.optional(), status: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);

    const where = {
      tenantId: auth.tenantId,
      ...(req.query['classId'] ? { classId: req.query['classId'] as string } : {}),
      ...(req.query['status'] ? { status: req.query['status'] as never } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.exam.findMany({
        where,
        skip,
        take,
        orderBy: { startDate: 'desc' },
        include: {
          class: { select: { id: true, name: true } },
          examTerm: { select: { id: true, name: true } },
          _count: { select: { schedules: true } },
        },
      }),
      prisma.exam.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }),
);

router.post(
  '/exams',
  requirePermission('examination:create'),
  validate({
    body: z.object({
      examTermId: uuidSchema,
      classId: uuidSchema,
      name: z.string().trim().min(1).max(120),
      gradingSystem: z.enum(['PERCENTAGE', 'GPA', 'CCE', 'LETTER']).default('PERCENTAGE'),
      startDate: dateOnly,
      endDate: dateOnly,
      instructions: z.string().max(2000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const exam = await prisma.exam.create({
      data: { tenantId: auth.tenantId, ...(req.body as Validated) },
    });

    await auditFromRequest(req, {
      action: 'CREATE',
      module: 'examination',
      entityType: 'Exam',
      entityId: exam.id,
    });

    return created(res, exam);
  }),
);

/** Schedule one subject sitting within an exam. */
router.post(
  '/exams/:id/schedules',
  requirePermission('examination:create'),
  validate({
    params: idParam,
    body: z.object({
      subjectId: uuidSchema,
      roomId: uuidSchema.optional(),
      examDate: dateOnly,
      startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      maxMarks: z.coerce.number().positive().max(1000),
      passingMarks: z.coerce.number().min(0).max(1000),
      invigilatorId: uuidSchema.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    if ((body['passingMarks'] as number) > (body['maxMarks'] as number)) {
      throw AppError.badRequest('Passing marks cannot exceed the maximum');
    }

    const schedule = await prisma.examSchedule.create({
      data: { examId: req.params['id']!, ...(body as Validated) },
    });

    return created(res, schedule);
  }),
);

router.get(
  '/exams/:id/schedules',
  requirePermission('examination:view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await prisma.examSchedule.findMany({
        where: { examId: req.params['id']! },
        orderBy: { examDate: 'asc' },
        include: { subject: true, room: { select: { name: true } } },
      }),
    ),
  ),
);

// --- Marks -----------------------------------------------------------------

router.get(
  '/schedules/:id/marks',
  requirePermission('examination:view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    return ok(res, await service.getMarksSheet(auth.tenantId, req.params['id']!));
  }),
);

router.post(
  '/schedules/:id/marks',
  requirePermission('examination:update'),
  validate({
    params: idParam,
    body: z.object({
      entries: z
        .array(
          z.object({
            studentId: uuidSchema,
            marksObtained: z.coerce.number().min(0).max(1000).optional(),
            theoryMarks: z.coerce.number().min(0).max(1000).optional(),
            practicalMarks: z.coerce.number().min(0).max(1000).optional(),
            isAbsent: z.boolean().default(false),
            remarks: z.string().max(300).optional(),
          }),
        )
        .min(1)
        .max(300),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const result = await service.saveMarks(
      auth,
      req.params['id']!,
      (req.body as { entries: Parameters<typeof service.saveMarks>[2] }).entries,
    );

    await auditFromRequest(req, {
      action: 'UPDATE',
      module: 'examination',
      entityType: 'MarkEntry',
      entityId: req.params['id']!,
      after: { saved: result.saved },
    });

    return ok(res, result);
  }),
);

/** Compute report cards and publish results to students and parents. */
router.post(
  '/exams/:id/publish',
  requirePermission('examination:approve'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const result = await service.publishResults(auth, req.params['id']!);

    await auditFromRequest(req, {
      action: 'PUBLISH',
      module: 'examination',
      entityType: 'Exam',
      entityId: req.params['id']!,
      after: result,
    });

    return ok(res, result);
  }),
);

router.get(
  '/report-cards/student/:id',
  requirePermission('examination:view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const studentId = req.params['id']!;

    assertStudentAccess(auth, studentId);

    return ok(
      res,
      await prisma.reportCard.findMany({
        where: { studentId, isPublished: true },
        orderBy: { createdAt: 'desc' },
        include: { examTerm: { select: { name: true, academicYear: { select: { name: true } } } } },
      }),
    );
  }),
);

// --- Assignments (LMS-lite) ------------------------------------------------

router.get(
  '/assignments',
  requirePermission('examination:view'),
  validate({
    query: listQuery.extend({
      classId: uuidSchema.optional(),
      sectionId: uuidSchema.optional(),
      subjectId: uuidSchema.optional(),
      status: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);

    const where = {
      tenantId: auth.tenantId,
      ...(req.query['classId'] ? { classId: req.query['classId'] as string } : {}),
      ...(req.query['sectionId'] ? { sectionId: req.query['sectionId'] as string } : {}),
      ...(req.query['subjectId'] ? { subjectId: req.query['subjectId'] as string } : {}),
      // Students and parents only ever see published work.
      ...(auth.scope === 'SELF' || auth.scope === 'CHILDREN'
        ? { status: 'PUBLISHED' as const }
        : req.query['status']
          ? { status: req.query['status'] as never }
          : {}),
      ...(auth.scope === 'ASSIGNED' && auth.employeeId ? { teacherId: auth.employeeId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.assignment.findMany({
        where,
        skip,
        take,
        orderBy: { dueAt: 'desc' },
        include: {
          subject: { select: { name: true, colorHex: true } },
          class: { select: { name: true } },
          section: { select: { name: true } },
          teacher: { select: { firstName: true, lastName: true } },
          _count: { select: { submissions: true } },
        },
      }),
      prisma.assignment.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }),
);

router.post(
  '/assignments',
  requirePermission('examination:create'),
  validate({
    body: z.object({
      classId: uuidSchema,
      sectionId: uuidSchema.optional(),
      subjectId: uuidSchema,
      title: z.string().trim().min(1).max(200),
      description: z.string().min(1).max(5000),
      instructions: z.string().max(5000).optional(),
      maxMarks: z.coerce.number().positive().max(1000).default(10),
      assignedOn: dateOnly,
      dueAt: z.coerce.date(),
      allowLateSubmission: z.boolean().default(true),
      latePenaltyPercent: z.coerce.number().int().min(0).max(100).default(10),
      publish: z.boolean().default(false),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    if (!auth.employeeId) throw AppError.forbidden('Only teaching staff can create assignments');

    const assignment = await service.createAssignment(
      auth,
      req.body as Parameters<typeof service.createAssignment>[1],
    );

    return created(res, assignment);
  }),
);

router.post(
  '/assignments/:id/submit',
  // Self-service: a student submitting their own work, not authoring content.
  requirePermission('examination:submit'),
  validate({
    params: idParam,
    body: z.object({
      content: z.string().max(20000).optional(),
      attachmentUrls: z.array(z.string().url()).max(10).default([]),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    if (!auth.studentId) throw AppError.forbidden('Only students can submit assignments');

    const submission = await service.submitAssignment(
      auth.studentId,
      req.params['id']!,
      req.body as { content?: string; attachmentUrls: string[] },
    );

    return created(res, submission);
  }),
);

router.post(
  '/submissions/:id/grade',
  requirePermission('examination:update'),
  validate({
    params: idParam,
    body: z.object({
      marksObtained: z.coerce.number().min(0).max(1000),
      feedback: z.string().max(2000).optional(),
      rubricScores: z.record(z.coerce.number()).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const graded = await service.gradeSubmission(
      auth,
      req.params['id']!,
      req.body as Parameters<typeof service.gradeSubmission>[2],
    );

    return ok(res, graded);
  }),
);

export default router;

