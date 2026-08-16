/**
 * Student Management: admissions funnel, profiles, guardians, documents,
 * promotion and transfer certificates (PRD §5.2).
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  asyncHandler,
  ok,
  created,
  paginated,
  pageParams,
  sortParams,
} from '../../core/http/respond.js';
import {
  validate,
  idParam,
  uuidSchema,
  dateOnly,
  emailSchema,
  phoneSchema,
  latitude,
  longitude,
  listQuery, Validated } from '../../core/http/validate.js';
import { requireAuth, requirePermission } from '../../core/auth/middleware.js';
import {
  scopedRequest,
  assertStudentAccess,
  studentListWhere,
  resolveWriteBranch,
} from '../../core/tenancy/scope.js';
import { auditFromRequest, diffRecords } from '../../core/audit/audit.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { prisma } from '../../core/db/prisma.js';
import {
  assertStorableUrl,
  destroyAsset,
  publicIdFromUrl,
} from '../../core/storage/cloudinary.js';
import * as service from './student.service.js';

const router = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const studentBase = {
  firstName: z.string().trim().min(1).max(60),
  middleName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().min(1).max(60),
  dateOfBirth: dateOnly,
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED']),
  bloodGroup: z.string().max(5).optional(),
  nationality: z.string().max(60).optional(),
  religion: z.string().max(60).optional(),
  category: z.string().max(40).optional(),
  motherTongue: z.string().max(60).optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  photoUrl: z.string().url().max(500).optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  postalCode: z.string().max(12).optional(),
  homeLatitude: latitude.optional(),
  homeLongitude: longitude.optional(),
  medicalNotes: z.string().max(2000).optional(),
  emergencyContactName: z.string().max(120).optional(),
  emergencyContactPhone: phoneSchema.optional(),
  rfidTag: z.string().max(64).optional(),
};

const createStudentSchema = z.object({
  ...studentBase,
  admissionNo: z.string().trim().min(1).max(40).optional(),
  admissionDate: dateOnly,
  branchId: uuidSchema.optional(),
  /** Enrol immediately into a class/section. */
  classId: uuidSchema,
  sectionId: uuidSchema,
  academicYearId: uuidSchema.optional(),
  rollNumber: z.string().max(20).optional(),
  /** Guardians created alongside the student during admission. */
  guardians: z
    .array(
      z.object({
        firstName: z.string().trim().min(1).max(60),
        lastName: z.string().trim().min(1).max(60),
        phone: phoneSchema,
        email: emailSchema.optional(),
        relation: z.enum(['FATHER', 'MOTHER', 'GUARDIAN', 'GRANDPARENT', 'SIBLING', 'OTHER']),
        custody: z.enum(['PRIMARY', 'SECONDARY', 'NON_CUSTODIAL']).default('PRIMARY'),
        occupation: z.string().max(120).optional(),
        isPrimaryContact: z.boolean().default(false),
        /** Sends the Parent App invite immediately on creation. */
        sendInvite: z.boolean().default(true),
      }),
    )
    .max(6)
    .optional(),
});

const updateStudentSchema = z.object({
  ...Object.fromEntries(
    Object.entries(studentBase).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
  ),
  status: z
    .enum(['ACTIVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED', 'SUSPENDED', 'ALUMNI'])
    .optional(),
} as Record<string, z.ZodTypeAny>);

const studentListQuery = listQuery.extend({
  classId: uuidSchema.optional(),
  sectionId: uuidSchema.optional(),
  status: z.string().optional(),
  gender: z.string().optional(),
  hasTransport: z.coerce.boolean().optional(),
  feeStatus: z.enum(['PAID', 'DUE', 'OVERDUE']).optional(),
});

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

router.get(
  '/',
  requirePermission('student:view'),
  validate({ query: studentListQuery }),
  asyncHandler(async (req, res) => {
    const { auth, tenant } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);
    const orderBy = sortParams(
      req.query,
      ['firstName', 'lastName', 'admissionNo', 'createdAt', 'admissionDate'],
      'createdAt',
    );

    const q = req.query as z.infer<typeof studentListQuery>;

    const where = {
      ...tenant,
      deletedAt: null,
      // Student model: scoped by `id` / enrolment, not by a `studentId` column.
      ...studentListWhere(auth),
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.gender ? { gender: q.gender as never } : {}),
      ...(q.search
        ? {
            OR: [
              { firstName: { contains: q.search, mode: 'insensitive' as const } },
              { lastName: { contains: q.search, mode: 'insensitive' as const } },
              { admissionNo: { contains: q.search, mode: 'insensitive' as const } },
              { phone: { contains: q.search } },
            ],
          }
        : {}),
      ...(q.classId || q.sectionId
        ? {
            enrollments: {
              some: {
                isCurrent: true,
                ...(q.classId ? { classId: q.classId } : {}),
                ...(q.sectionId ? { sectionId: q.sectionId } : {}),
              },
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.student.findMany({
        where,
        skip,
        take,
        orderBy,
        // One statement including the enrolment join, rather than a second
        // round trip to hydrate it.
        relationLoadStrategy: 'join',
        select: service.studentListSelect,
      }),
      prisma.student.count({ where }),
    ]);

    return paginated(res, items.map(service.shapeStudentListItem), total, page, limit);
  }),
);

router.get(
  '/:id',
  requirePermission('student:view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const id = req.params['id']!;

    assertStudentAccess(auth, id);
    return ok(res, await service.getStudentProfile(auth.tenantId, id));
  }),
);

router.post(
  '/',
  requirePermission('student:create'),
  validate({ body: createStudentSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as z.infer<typeof createStudentSchema>;

    const branchId = resolveWriteBranch(auth, body.branchId);
    const student = await service.admitStudent(auth, branchId, body);

    await auditFromRequest(req, {
      action: 'CREATE',
      module: 'student',
      entityType: 'Student',
      entityId: student.id,
      after: { admissionNo: student.admissionNo, name: `${body.firstName} ${body.lastName}` },
    });

    return created(res, student);
  }),
);

router.patch(
  '/:id',
  requirePermission('student:update'),
  validate({ params: idParam, body: updateStudentSchema }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const id = req.params['id']!;

    const existing = await prisma.student.findFirst({
      where: { id, tenantId: auth.tenantId, deletedAt: null },
    });
    if (!existing) throw AppError.notFound('Student');

    const patch = req.body as Record<string, unknown>;
    const changes = diffRecords(existing as unknown as Record<string, unknown>, patch);

    const updated = await prisma.student.update({
      where: { id },
      data: patch as never,
      select: service.studentListSelect,
    });

    if (changes) {
      await auditFromRequest(req, {
        action: 'UPDATE',
        module: 'student',
        entityType: 'Student',
        entityId: id,
        before: changes.before,
        after: changes.after,
      });
    }

    return ok(res, service.shapeStudentListItem(updated));
  }),
);

/** Soft delete — student history must survive for compliance and reporting. */
router.delete(
  '/:id',
  requirePermission('student:delete'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const id = req.params['id']!;

    const { count } = await prisma.student.updateMany({
      where: { id, tenantId: auth.tenantId, deletedAt: null },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
    if (count === 0) throw AppError.notFound('Student');

    await auditFromRequest(req, {
      action: 'DELETE',
      module: 'student',
      entityType: 'Student',
      entityId: id,
    });

    return ok(res, { deleted: true });
  }),
);

// ---------------------------------------------------------------------------
// Guardians
// ---------------------------------------------------------------------------

const linkGuardianSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  phone: phoneSchema,
  email: emailSchema.optional(),
  relation: z.enum(['FATHER', 'MOTHER', 'GUARDIAN', 'GRANDPARENT', 'SIBLING', 'OTHER']),
  custody: z.enum(['PRIMARY', 'SECONDARY', 'NON_CUSTODIAL']).default('SECONDARY'),
  occupation: z.string().max(120).optional(),
  isPrimaryContact: z.boolean().default(false),
  canViewLocation: z.boolean().default(true),
  canPickup: z.boolean().default(true),
  sendInvite: z.boolean().default(true),
});

router.get(
  '/:id/guardians',
  requirePermission('student:view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    assertStudentAccess(auth, req.params['id']!);
    return ok(res, await service.listGuardians(req.params['id']!));
  }),
);

router.post(
  '/:id/guardians',
  requirePermission('student:update'),
  validate({ params: idParam, body: linkGuardianSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const studentId = req.params['id']!;
    const body = req.body as z.infer<typeof linkGuardianSchema>;

    const link = await service.linkGuardian(auth.tenantId, studentId, body);

    await auditFromRequest(req, {
      action: 'CREATE',
      module: 'student',
      entityType: 'StudentGuardian',
      entityId: link.id,
      after: { studentId, relation: body.relation, custody: body.custody },
    });

    return created(res, link);
  }),
);

/**
 * Toggle a guardian's permissions. `canViewLocation` is the switch that opens
 * or closes the live map for that guardian, so it is audited explicitly.
 */
router.patch(
  '/guardians/:linkId',
  requirePermission('student:update'),
  validate({
    params: z.object({ linkId: uuidSchema }),
    body: z.object({
      custody: z.enum(['PRIMARY', 'SECONDARY', 'NON_CUSTODIAL']).optional(),
      isPrimaryContact: z.boolean().optional(),
      canViewLocation: z.boolean().optional(),
      canPickup: z.boolean().optional(),
      canReceiveInvoices: z.boolean().optional(),
      canApproveLeave: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const linkId = req.params['linkId']!;
    const patch = req.body as Record<string, unknown>;

    const updated = await service.updateGuardianLink(auth.tenantId, linkId, patch);

    await auditFromRequest(req, {
      action: 'PERMISSION_CHANGE',
      module: 'student',
      entityType: 'StudentGuardian',
      entityId: linkId,
      after: patch,
    });

    return ok(res, updated);
  }),
);

router.delete(
  '/guardians/:linkId',
  requirePermission('student:update'),
  validate({ params: z.object({ linkId: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    await service.unlinkGuardian(auth.tenantId, req.params['linkId']!);

    await auditFromRequest(req, {
      action: 'DELETE',
      module: 'student',
      entityType: 'StudentGuardian',
      entityId: req.params['linkId']!,
    });

    return ok(res, { unlinked: true });
  }),
);

/** Re-send the Parent App invite (OTP-verified, per the PRD gap analysis). */
router.post(
  '/guardians/:guardianId/invite',
  requirePermission('student:update'),
  validate({ params: z.object({ guardianId: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    await service.sendGuardianInvite(auth.tenantId, req.params['guardianId']!);
    return ok(res, { sent: true });
  }),
);

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

router.get(
  '/:id/documents',
  requirePermission('student:view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    assertStudentAccess(auth, req.params['id']!);

    return ok(
      res,
      await prisma.studentDocument.findMany({
        where: { studentId: req.params['id']! },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }),
);

router.post(
  '/:id/documents',
  requirePermission('student:update'),
  validate({
    params: idParam,
    body: z.object({
      documentType: z.enum([
        'BIRTH_CERTIFICATE',
        'TRANSFER_CERTIFICATE',
        'ID_PROOF',
        'PHOTO',
        'MARKSHEET',
        'MEDICAL',
        'CASTE_CERTIFICATE',
        'OTHER',
      ]),
      title: z.string().trim().min(1).max(160),
      fileUrl: z.string().url().max(500),
      filePublicId: z.string().max(300).optional(),
      fileResourceType: z.enum(['image', 'raw', 'video']).default('image'),
      mimeType: z.string().max(120).optional(),
      fileSizeBytes: z.coerce.number().int().positive().optional(),
      expiresAt: dateOnly.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const studentId = req.params['id']!;
    assertStudentAccess(auth, studentId);

    const body = req.body as Validated & { fileUrl: string };

    /*
      The browser uploads straight to Cloudinary and sends us the resulting
      URL, so the URL is client-supplied. Checking it belongs to our own cloud
      is what stops this table from becoming a list of arbitrary attacker-chosen
      links rendered inside the admin UI.
    */
    assertStorableUrl(body.fileUrl);

    const doc = await prisma.studentDocument.create({
      data: { studentId, uploadedById: auth.userId, ...(body as object) } as never,
    });

    await auditFromRequest(req, {
      action: 'CREATE',
      module: 'student',
      entityType: 'StudentDocument',
      entityId: doc.id,
      after: { documentType: doc.documentType, title: doc.title },
    });

    return created(res, doc);
  }),
);

/**
 * Delete a document, and the stored file with it.
 *
 * Removing the row while leaving the asset in Cloudinary would quietly build
 * up an orphaned store of children's identity documents that nothing tracks —
 * exactly the kind of residue the DPDP erasure workflow has to be able to
 * clear. The asset delete is best-effort: a storage failure must not block
 * removing the record.
 */
router.delete(
  '/documents/:docId',
  requirePermission('student:delete'),
  validate({ params: z.object({ docId: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);

    const doc = await prisma.studentDocument.findFirst({
      where: { id: req.params['docId']!, student: { tenantId: auth.tenantId } },
      select: {
        id: true,
        title: true,
        fileUrl: true,
        filePublicId: true,
        fileResourceType: true,
      },
    });
    if (!doc) throw AppError.notFound('Document');

    await prisma.studentDocument.delete({ where: { id: doc.id } });

    const publicId = doc.filePublicId ?? publicIdFromUrl(doc.fileUrl);
    if (publicId) {
      await destroyAsset(publicId, doc.fileResourceType as 'image' | 'raw' | 'video');
    }

    await auditFromRequest(req, {
      action: 'DELETE',
      module: 'student',
      entityType: 'StudentDocument',
      entityId: doc.id,
      before: { title: doc.title },
    });

    return ok(res, { deleted: true });
  }),
);

router.post(
  '/documents/:docId/verify',
  requirePermission('student:update'),
  validate({
    params: z.object({ docId: uuidSchema }),
    body: z.object({ remarks: z.string().max(500).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);

    const existing = await prisma.studentDocument.findFirst({
      where: { id: req.params['docId']!, student: { tenantId: auth.tenantId } },
      select: { id: true },
    });
    if (!existing) throw AppError.notFound('Document');

    const doc = await prisma.studentDocument.update({
      where: { id: existing.id },
      data: {
        isVerified: true,
        verifiedById: auth.userId,
        verifiedAt: new Date(),
        remarks: (req.body as { remarks?: string }).remarks ?? null,
      },
    });

    await auditFromRequest(req, {
      action: 'APPROVE',
      module: 'student',
      entityType: 'StudentDocument',
      entityId: doc.id,
    });

    return ok(res, doc);
  }),
);

// ---------------------------------------------------------------------------
// Admissions funnel
// ---------------------------------------------------------------------------

router.get(
  '/admissions/applications',
  requirePermission('student:view'),
  validate({ query: listQuery.extend({ status: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const { tenant } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);
    const status = req.query['status'] as string | undefined;

    const where = {
      tenantId: tenant.tenantId,
      ...(tenant.branchId ? { branchId: tenant.branchId } : {}),
      ...(status ? { status: status as never } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.admissionApplication.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.admissionApplication.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }),
);

router.post(
  '/admissions/applications',
  requirePermission('student:create'),
  validate({
    body: z.object({
      firstName: z.string().trim().min(1).max(60),
      lastName: z.string().trim().min(1).max(60),
      dateOfBirth: dateOnly,
      gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED']),
      guardianName: z.string().trim().min(1).max(120),
      guardianPhone: phoneSchema,
      guardianEmail: emailSchema.optional(),
      appliedForClassId: uuidSchema.optional(),
      previousSchool: z.string().max(200).optional(),
      source: z.string().max(80).optional(),
      notes: z.string().max(1000).optional(),
      branchId: uuidSchema.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;
    const branchId = resolveWriteBranch(auth, body['branchId'] as string | undefined);

    const application = await service.createApplication(auth.tenantId, branchId, body);

    await auditFromRequest(req, {
      action: 'CREATE',
      module: 'student',
      entityType: 'AdmissionApplication',
      entityId: application.id,
    });

    return created(res, application);
  }),
);

router.patch(
  '/admissions/applications/:id',
  requirePermission('student:update'),
  validate({
    params: idParam,
    body: z.object({
      status: z
        .enum([
          'ENQUIRY',
          'APPLIED',
          'DOCUMENTS_PENDING',
          'VERIFIED',
          'APPROVED',
          'REJECTED',
          'WITHDRAWN',
        ])
        .optional(),
      rejectionReason: z.string().max(500).optional(),
      notes: z.string().max(1000).optional(),
      appliedForClassId: uuidSchema.nullish(),
      previousSchool: z.string().max(200).optional(),
      guardianName: z.string().trim().min(1).max(120).optional(),
      guardianPhone: phoneSchema.optional(),
      guardianEmail: emailSchema.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;

    /*
      Scoped by tenant, not just by id. Fetching on the primary key alone let a
      token from one school patch another school's application, because the id
      was the only thing checked.
    */
    const existing = await prisma.admissionApplication.findFirst({
      where: { id: req.params['id']!, tenantId: auth.tenantId },
    });
    if (!existing) throw AppError.notFound('Application');

    if (existing.status === 'ENROLLED') {
      throw AppError.conflict(
        'This application has been enrolled. Edit the student record instead.',
      );
    }

    // ENROLLED is reachable only through the conversion endpoint below, which
    // actually creates the student. Allowing it here would leave the funnel
    // claiming an enrolment that produced no student record.
    const status = body['status'] as string | undefined;

    const updated = await prisma.admissionApplication.update({
      where: { id: existing.id },
      data: {
        ...(body as object),
        // Only overwrite the rejection reason when rejecting; a later note
        // edit must not silently erase why the application was turned down.
        ...(status === 'REJECTED'
          ? { rejectionReason: (body['rejectionReason'] as string) ?? existing.rejectionReason }
          : {}),
        ...(status ? { reviewedById: auth.userId, reviewedAt: new Date() } : {}),
      } as never,
    });

    await auditFromRequest(req, {
      action: status === 'APPROVED' ? 'APPROVE' : status === 'REJECTED' ? 'REJECT' : 'UPDATE',
      module: 'student',
      entityType: 'AdmissionApplication',
      entityId: updated.id,
      before: { status: existing.status },
      after: body,
    });

    return ok(res, updated);
  }),
);

/**
 * Convert an approved application into an enrolled student.
 *
 * Kept separate from the status PATCH deliberately: this one has side effects
 * — a student record, an enrolment row and a linked guardian — and needs the
 * class and section that the status change has no business asking for.
 */
router.post(
  '/admissions/applications/:id/enroll',
  requirePermission('student:create'),
  validate({
    params: idParam,
    body: z.object({
      classId: uuidSchema,
      sectionId: uuidSchema,
      academicYearId: uuidSchema.optional(),
      admissionDate: dateOnly.optional(),
      rollNumber: z.string().max(20).optional(),
      guardianRelation: z
        .enum(['FATHER', 'MOTHER', 'GUARDIAN', 'GRANDPARENT', 'SIBLING', 'OTHER'])
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as service.EnrolApplicationInput;

    const result = await service.enrolApplication(auth, req.params['id']!, body);

    await auditFromRequest(req, {
      action: 'APPROVE',
      module: 'student',
      entityType: 'AdmissionApplication',
      entityId: result.application.id,
      after: { status: 'ENROLLED', studentId: result.student.id },
    });

    return created(res, result);
  }),
);

/** Funnel counts for the admissions dashboard. */
router.get(
  '/admissions/funnel',
  requirePermission('student:view'),
  asyncHandler(async (req, res) => {
    const { tenant } = scopedRequest(req);
    return ok(res, await service.admissionFunnel(tenant.tenantId, tenant.branchId));
  }),
);

// ---------------------------------------------------------------------------
// Promotion & transfer
// ---------------------------------------------------------------------------

router.post(
  '/promote',
  requirePermission('student:update'),
  validate({
    body: z.object({
      fromAcademicYearId: uuidSchema,
      toAcademicYearId: uuidSchema,
      fromSectionId: uuidSchema,
      toClassId: uuidSchema,
      toSectionId: uuidSchema,
      /** Students to hold back; everyone else in the section is promoted. */
      retainStudentIds: z.array(uuidSchema).default([]),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Parameters<typeof service.promoteSection>[1];

    const result = await service.promoteSection(auth.tenantId, body, auth.userId);

    await auditFromRequest(req, {
      action: 'UPDATE',
      module: 'student',
      entityType: 'Promotion',
      after: result,
    });

    return ok(res, result);
  }),
);

router.post(
  '/:id/transfer-certificate',
  requirePermission('student:update'),
  validate({
    params: idParam,
    body: z.object({
      reason: z.string().min(1).max(500),
      conductRemark: z.string().max(200).default('Satisfactory'),
      issueDate: dateOnly.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as { reason: string; conductRemark: string; issueDate?: Date };

    const tc = await service.issueTransferCertificate(
      auth.tenantId,
      req.params['id']!,
      auth.userId,
      body,
    );

    await auditFromRequest(req, {
      action: 'CREATE',
      module: 'student',
      entityType: 'TransferCertificate',
      entityId: tc.id,
    });

    return created(res, tc);
  }),
);

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

router.post(
  '/:id/behaviour',
  requirePermission('student:update'),
  validate({
    params: idParam,
    body: z.object({
      category: z.enum(['POSITIVE', 'CONCERN', 'INCIDENT']),
      title: z.string().trim().min(1).max(160),
      description: z.string().min(1).max(2000),
      points: z.coerce.number().int().min(-50).max(50).default(0),
      occurredOn: dateOnly,
      actionTaken: z.string().max(1000).optional(),
      notifyParent: z.boolean().default(false),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    if (!auth.employeeId) throw AppError.forbidden('Only staff can record behaviour notes');

    const record = await service.recordBehaviour(
      auth,
      req.params['id']!,
      req.body as Parameters<typeof service.recordBehaviour>[2],
    );

    return created(res, record);
  }),
);

export default router;
