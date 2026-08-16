/** Student Management business logic. */

import type { Prisma } from '@prisma/client';
import { documentNumber } from '@erp/shared';
import type { RequestAuth } from '../../types/express.js';
import { prisma } from '../../core/db/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { randomToken, randomOtp, hashToken, hashPassword } from '../../core/auth/password.js';
import { notify } from '../../core/notifications/notification.service.js';
import { invalidateUserContext } from '../../core/auth/context.js';
import { moduleLogger } from '../../core/logger.js';

const log = moduleLogger('students');

export const studentListSelect = {
  id: true,
  admissionNo: true,
  firstName: true,
  middleName: true,
  lastName: true,
  gender: true,
  dateOfBirth: true,
  photoUrl: true,
  phone: true,
  email: true,
  status: true,
  admissionDate: true,
  enrollments: {
    where: { isCurrent: true },
    take: 1,
    select: {
      rollNumber: true,
      class: { select: { id: true, name: true } },
      section: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.StudentSelect;

type StudentListRow = Prisma.StudentGetPayload<{ select: typeof studentListSelect }>;

/** Flatten the current enrolment onto the row so list tables stay simple. */
export function shapeStudentListItem(student: StudentListRow) {
  const enrollment = student.enrollments[0];

  return {
    id: student.id,
    admissionNo: student.admissionNo,
    firstName: student.firstName,
    lastName: student.lastName,
    fullName: [student.firstName, student.middleName, student.lastName]
      .filter(Boolean)
      .join(' '),
    gender: student.gender,
    dateOfBirth: student.dateOfBirth,
    photoUrl: student.photoUrl,
    phone: student.phone,
    email: student.email,
    status: student.status,
    admissionDate: student.admissionDate,
    rollNumber: enrollment?.rollNumber ?? null,
    classId: enrollment?.class.id ?? null,
    className: enrollment?.class.name ?? null,
    sectionId: enrollment?.section.id ?? null,
    sectionName: enrollment?.section.name ?? null,
  };
}

/** Full profile assembled for the student detail screen. */
export async function getStudentProfile(tenantId: string, studentId: string) {
  const student = await prisma.student.findFirst({
    where: { id: studentId, tenantId, deletedAt: null },
    include: {
      branch: { select: { id: true, name: true } },
      enrollments: {
        orderBy: { enrolledOn: 'desc' },
        select: {
          id: true,
          rollNumber: true,
          isCurrent: true,
          enrolledOn: true,
          academicYear: { select: { id: true, name: true } },
          class: { select: { id: true, name: true } },
          section: { select: { id: true, name: true } },
        },
      },
      guardianLinks: {
        select: {
          id: true,
          relation: true,
          custody: true,
          isPrimaryContact: true,
          canViewLocation: true,
          canPickup: true,
          locationConsentAt: true,
          guardian: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
              occupation: true,
              userId: true,
              inviteAcceptedAt: true,
            },
          },
        },
      },
      documents: { orderBy: { createdAt: 'desc' } },
      transportAllocations: {
        where: { isActive: true },
        select: {
          id: true,
          route: { select: { id: true, name: true } },
          pickupStop: { select: { id: true, name: true } },
          monthlyFare: true,
        },
      },
      behaviourRecords: { orderBy: { occurredOn: 'desc' }, take: 10 },
      riskScores: true,
    },
  });

  if (!student) throw AppError.notFound('Student');

  // Attendance and fee summaries the profile header needs.
  const [attendanceAgg, feeAgg] = await Promise.all([
    prisma.attendanceRecord.groupBy({
      by: ['status'],
      where: { studentId },
      _count: { _all: true },
    }),
    prisma.invoice.aggregate({
      where: { studentId, status: { notIn: ['CANCELLED', 'DRAFT'] } },
      _sum: { totalAmount: true, paidAmount: true, balanceAmount: true },
    }),
  ]);

  const totalMarked = attendanceAgg.reduce((sum, row) => sum + row._count._all, 0);
  const presentCount =
    attendanceAgg.find((r) => r.status === 'PRESENT')?._count._all ?? 0;

  return {
    ...student,
    fullName: [student.firstName, student.middleName, student.lastName]
      .filter(Boolean)
      .join(' '),
    summary: {
      attendancePercent:
        totalMarked === 0 ? null : Number(((presentCount / totalMarked) * 100).toFixed(1)),
      daysMarked: totalMarked,
      feesBilled: feeAgg._sum.totalAmount ?? 0,
      feesPaid: feeAgg._sum.paidAmount ?? 0,
      feesOutstanding: feeAgg._sum.balanceAmount ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------

interface AdmitInput {
  admissionNo?: string | undefined;
  admissionDate: Date;
  classId: string;
  sectionId: string;
  academicYearId?: string | undefined;
  rollNumber?: string | undefined;
  guardians?: Array<{
    firstName: string;
    lastName: string;
    phone: string;
    email?: string | undefined;
    relation: string;
    custody: string;
    occupation?: string | undefined;
    isPrimaryContact: boolean;
    sendInvite: boolean;
  }> | undefined;
  [key: string]: unknown;
}

/**
 * Admit a student: create the record, enrol them into a class/section and
 * link their guardians — all in one transaction so a partial admission can
 * never leave an un-enrolled student behind.
 */
export async function admitStudent(
  auth: RequestAuth,
  branchId: string,
  input: AdmitInput,
) {
  const academicYearId =
    input.academicYearId ?? (await currentAcademicYearId(auth.tenantId));

  // Verify the section belongs to the target class, otherwise a typo would
  // silently enrol the student into another class's section.
  const section = await prisma.section.findFirst({
    where: { id: input.sectionId, classId: input.classId },
    select: { id: true, capacity: true, _count: { select: { enrollments: true } } },
  });
  if (!section) throw AppError.badRequest('The selected section does not belong to that class');

  if (section._count.enrollments >= section.capacity) {
    throw AppError.conflict('That section is already at capacity');
  }

  const admissionNo =
    input.admissionNo ?? (await nextAdmissionNumber(auth.tenantId, input.admissionDate));

  const {
    guardians,
    classId,
    sectionId,
    academicYearId: _ay,
    rollNumber,
    admissionNo: _an,
    branchId: _bid,
    ...studentFields
  } = input;

  // Resolve which guardians already exist *before* opening the transaction.
  // Looking each one up inside it turned a two-write operation into a chain of
  // round trips, which is what pushed it past the transaction timeout.
  const guardianPhones = (guardians ?? []).map((g) => g.phone);
  const existingGuardians =
    guardianPhones.length > 0
      ? await prisma.guardian.findMany({
          where: { tenantId: auth.tenantId, phone: { in: guardianPhones } },
          select: { id: true, phone: true },
        })
      : [];

  const guardianIdByPhone = new Map(existingGuardians.map((g) => [g.phone, g.id]));

  return prisma.$transaction(async (tx) => {
    const student = await tx.student.create({
      data: {
        ...(studentFields as object),
        tenantId: auth.tenantId,
        branchId,
        admissionNo,
        admissionDate: input.admissionDate,
        rollNumber: rollNumber ?? null,
      } as Prisma.StudentUncheckedCreateInput,
      select: { id: true, admissionNo: true, firstName: true, lastName: true },
    });

    await tx.enrollment.create({
      data: {
        studentId: student.id,
        academicYearId,
        classId,
        sectionId,
        rollNumber: rollNumber ?? null,
        isCurrent: true,
      },
    });

    for (const g of guardians ?? []) {
      // Reuse the existing guardian record for siblings, otherwise create one.
      let guardianId = guardianIdByPhone.get(g.phone);

      if (!guardianId) {
        const created = await tx.guardian.create({
          data: {
            tenantId: auth.tenantId,
            firstName: g.firstName,
            lastName: g.lastName,
            phone: g.phone,
            email: g.email ?? null,
            occupation: g.occupation ?? null,
          },
          select: { id: true },
        });
        guardianId = created.id;
        // Two guardians in one payload sharing a phone must not double-create.
        guardianIdByPhone.set(g.phone, guardianId);
      }

      await tx.studentGuardian.create({
        data: {
          studentId: student.id,
          guardianId,
          relation: g.relation as never,
          custody: g.custody as never,
          isPrimaryContact: g.isPrimaryContact,
          // Non-custodial guardians never get location access by default.
          canViewLocation: g.custody !== 'NON_CUSTODIAL',
        },
      });
    }

    return student;
  });
}

async function currentAcademicYearId(tenantId: string): Promise<string> {
  const year = await prisma.academicYear.findFirst({
    where: { tenantId, isCurrent: true },
    select: { id: true },
  });
  if (!year) {
    throw AppError.badRequest('No current academic year is set. Configure one in Settings first.');
  }
  return year.id;
}

/** `ADM/2026-27/000123`, unique per tenant. */
async function nextAdmissionNumber(tenantId: string, admissionDate: Date): Promise<string> {
  const year = admissionDate.getMonth() >= 3 ? admissionDate.getFullYear() : admissionDate.getFullYear() - 1;
  const session = `${year}-${String((year + 1) % 100).padStart(2, '0')}`;

  const count = await prisma.student.count({
    where: { tenantId, admissionNo: { startsWith: `ADM/${session}/` } },
  });

  return documentNumber('ADM', session, count + 1);
}

// ---------------------------------------------------------------------------
// Guardians
// ---------------------------------------------------------------------------

export async function listGuardians(studentId: string) {
  return prisma.studentGuardian.findMany({
    where: { studentId },
    select: {
      id: true,
      relation: true,
      custody: true,
      isPrimaryContact: true,
      canViewLocation: true,
      canPickup: true,
      canReceiveInvoices: true,
      canApproveLeave: true,
      locationConsentAt: true,
      guardian: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          occupation: true,
          userId: true,
          inviteSentAt: true,
          inviteAcceptedAt: true,
        },
      },
    },
    orderBy: { isPrimaryContact: 'desc' },
  });
}

export async function linkGuardian(
  tenantId: string,
  studentId: string,
  input: {
    firstName: string;
    lastName: string;
    phone: string;
    email?: string | undefined;
    relation: string;
    custody: string;
    occupation?: string | undefined;
    isPrimaryContact: boolean;
    canViewLocation: boolean;
    canPickup: boolean;
    sendInvite: boolean;
  },
) {
  const student = await prisma.student.findFirst({
    where: { id: studentId, tenantId },
    select: { id: true },
  });
  if (!student) throw AppError.notFound('Student');

  const existing = await prisma.guardian.findFirst({
    where: { tenantId, phone: input.phone },
    select: { id: true },
  });

  const guardian =
    existing ??
    (await prisma.guardian.create({
      data: {
        tenantId,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        email: input.email ?? null,
        occupation: input.occupation ?? null,
      },
      select: { id: true },
    }));

  const duplicate = await prisma.studentGuardian.findUnique({
    where: { studentId_guardianId: { studentId, guardianId: guardian.id } },
    select: { id: true },
  });
  if (duplicate) throw AppError.conflict('This guardian is already linked to the student');

  const link = await prisma.studentGuardian.create({
    data: {
      studentId,
      guardianId: guardian.id,
      relation: input.relation as never,
      custody: input.custody as never,
      isPrimaryContact: input.isPrimaryContact,
      canViewLocation: input.custody === 'NON_CUSTODIAL' ? false : input.canViewLocation,
      canPickup: input.canPickup,
    },
  });

  if (input.sendInvite) {
    await sendGuardianInvite(tenantId, guardian.id);
  }

  return link;
}

export async function updateGuardianLink(
  tenantId: string,
  linkId: string,
  patch: Record<string, unknown>,
) {
  const link = await prisma.studentGuardian.findFirst({
    where: { id: linkId, student: { tenantId } },
    select: { id: true, guardian: { select: { userId: true } } },
  });
  if (!link) throw AppError.notFound('Guardian link');

  const updated = await prisma.studentGuardian.update({
    where: { id: linkId },
    data: patch as never,
  });

  // Permission changes must take effect immediately, not after the cache TTL.
  if (link.guardian.userId) await invalidateUserContext(link.guardian.userId);

  return updated;
}

export async function unlinkGuardian(tenantId: string, linkId: string): Promise<void> {
  const link = await prisma.studentGuardian.findFirst({
    where: { id: linkId, student: { tenantId } },
    select: { id: true, guardian: { select: { userId: true } } },
  });
  if (!link) throw AppError.notFound('Guardian link');

  await prisma.studentGuardian.delete({ where: { id: linkId } });
  if (link.guardian.userId) await invalidateUserContext(link.guardian.userId);
}

/**
 * Send (or resend) a Parent App invite.
 *
 * The invite carries a random token and a 6-digit OTP; both are stored hashed
 * and the OTP expires in 15 minutes (PRD gap: "Invite via SMS/email with
 * OTP-based verification").
 */
export async function sendGuardianInvite(tenantId: string, guardianId: string): Promise<void> {
  const guardian = await prisma.guardian.findFirst({
    where: { id: guardianId, tenantId },
    select: { id: true, firstName: true, phone: true, email: true, userId: true },
  });
  if (!guardian) throw AppError.notFound('Guardian');

  const token = randomToken();
  const otp = randomOtp();

  await prisma.guardian.update({
    where: { id: guardianId },
    data: {
      inviteToken: token,
      inviteSentAt: new Date(),
      otpHash: hashToken(otp),
      otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });

  // A guardian without a user account cannot receive an in-app notification,
  // so the invite goes out over SMS/email directly.
  const message = `Welcome to the school Parent App. Your verification code is ${otp}. It expires in 15 minutes.`;

  if (guardian.userId) {
    await notify({
      tenantId,
      userIds: [guardian.userId],
      title: 'Parent App invitation',
      body: message,
      channels: ['SMS', 'EMAIL', 'IN_APP'],
      priority: 'HIGH',
      module: 'student',
    });
  } else {
    const { sendSms } = await import('../../core/notifications/channels/sms.channel.js');
    await sendSms(guardian.phone, message).catch((err: unknown) =>
      log.error({ err, guardianId }, 'Failed to send guardian invite SMS'),
    );
  }

  log.info({ guardianId }, 'Guardian invite dispatched');
}

/** Complete onboarding: verify the OTP, create the login, record consent. */
export async function acceptGuardianInvite(input: {
  token: string;
  otp: string;
  password: string;
  locationConsent: boolean;
  ipAddress: string | null;
}): Promise<{ userId: string }> {
  const guardian = await prisma.guardian.findUnique({
    where: { inviteToken: input.token },
    select: {
      id: true,
      tenantId: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      userId: true,
      otpHash: true,
      otpExpiresAt: true,
    },
  });

  if (!guardian) throw AppError.tokenInvalid('This invitation is not valid');
  if (guardian.userId) throw AppError.conflict('This invitation has already been used');

  if (
    !guardian.otpHash ||
    !guardian.otpExpiresAt ||
    guardian.otpExpiresAt < new Date() ||
    guardian.otpHash !== hashToken(input.otp)
  ) {
    throw AppError.badRequest('The verification code is incorrect or has expired');
  }

  const user = await prisma.user.create({
    data: {
      tenantId: guardian.tenantId,
      email: guardian.email,
      phone: guardian.phone,
      passwordHash: await hashPassword(input.password),
      role: 'PARENT',
      scope: 'CHILDREN',
      firstName: guardian.firstName,
      lastName: guardian.lastName,
      status: 'ACTIVE',
      phoneVerifiedAt: new Date(),
    },
    select: { id: true },
  });

  await prisma.guardian.update({
    where: { id: guardian.id },
    data: {
      userId: user.id,
      inviteAcceptedAt: new Date(),
      // Burn the single-use token and OTP.
      inviteToken: null,
      otpHash: null,
      otpExpiresAt: null,
    },
  });

  await prisma.consentRecord.create({
    data: {
      userId: user.id,
      consentType: 'LOCATION_TRACKING',
      granted: input.locationConsent,
      version: '1.0',
      ipAddress: input.ipAddress,
    },
  });

  await prisma.studentGuardian.updateMany({
    where: { guardianId: guardian.id, custody: { not: 'NON_CUSTODIAL' } },
    data: {
      canViewLocation: input.locationConsent,
      locationConsentAt: input.locationConsent ? new Date() : null,
      locationConsentIp: input.ipAddress,
    },
  });

  return { userId: user.id };
}

// ---------------------------------------------------------------------------
// Admissions funnel
// ---------------------------------------------------------------------------

export async function createApplication(
  tenantId: string,
  branchId: string,
  input: Record<string, unknown>,
) {
  const count = await prisma.admissionApplication.count({ where: { tenantId } });
  const applicationNo = `APP-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;

  const { branchId: _b, ...fields } = input;

  return prisma.admissionApplication.create({
    data: {
      ...(fields as object),
      tenantId,
      branchId,
      applicationNo,
    } as Prisma.AdmissionApplicationUncheckedCreateInput,
  });
}

// ---------------------------------------------------------------------------
// Promotion
// ---------------------------------------------------------------------------

/**
 * Promote a whole section into the next year. Retained students stay in the
 * same class but move into the new academic year, so their history is
 * continuous either way.
 */
export async function promoteSection(
  tenantId: string,
  input: {
    fromAcademicYearId: string;
    toAcademicYearId: string;
    fromSectionId: string;
    toClassId: string;
    toSectionId: string;
    retainStudentIds: string[];
  },
  actorId: string,
): Promise<{ promoted: number; retained: number }> {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      academicYearId: input.fromAcademicYearId,
      sectionId: input.fromSectionId,
      isCurrent: true,
      student: { tenantId, status: 'ACTIVE', deletedAt: null },
    },
    select: { studentId: true, classId: true, sectionId: true },
  });

  if (enrollments.length === 0) {
    throw AppError.badRequest('No active students found in that section');
  }

  const retained = new Set(input.retainStudentIds);
  let promotedCount = 0;
  let retainedCount = 0;

  await prisma.$transaction(async (tx) => {
    // Close out the old year first so `isCurrent` is never true twice.
    await tx.enrollment.updateMany({
      where: {
        academicYearId: input.fromAcademicYearId,
        sectionId: input.fromSectionId,
      },
      data: { isCurrent: false },
    });

    for (const enrollment of enrollments) {
      const isRetained = retained.has(enrollment.studentId);

      await tx.enrollment.create({
        data: {
          studentId: enrollment.studentId,
          academicYearId: input.toAcademicYearId,
          classId: isRetained ? enrollment.classId : input.toClassId,
          sectionId: isRetained ? enrollment.sectionId : input.toSectionId,
          isCurrent: true,
        },
      });

      await tx.promotion.create({
        data: {
          studentId: enrollment.studentId,
          academicYearId: input.fromAcademicYearId,
          fromClassId: enrollment.classId,
          toClassId: isRetained ? enrollment.classId : input.toClassId,
          result: isRetained ? 'RETAINED' : 'PROMOTED',
          processedById: actorId,
        },
      });

      if (isRetained) retainedCount++;
      else promotedCount++;
    }
  });

  log.info(
    { tenantId, promoted: promotedCount, retained: retainedCount },
    'Section promotion completed',
  );

  return { promoted: promotedCount, retained: retainedCount };
}

export async function issueTransferCertificate(
  tenantId: string,
  studentId: string,
  actorId: string,
  input: { reason: string; conductRemark: string; issueDate?: Date | undefined },
) {
  const student = await prisma.student.findFirst({
    where: { id: studentId, tenantId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNo: true,
      enrollments: {
        where: { isCurrent: true },
        take: 1,
        select: { class: { select: { name: true } } },
      },
      reportCards: {
        where: { isPublished: true },
        select: { percentage: true, overallGrade: true, examTerm: { select: { name: true } } },
      },
    },
  });

  if (!student) throw AppError.notFound('Student');

  const count = await prisma.transferCertificate.count({
    where: { student: { tenantId } },
  });
  const certificateNo = `TC-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;

  const tc = await prisma.transferCertificate.create({
    data: {
      studentId,
      certificateNo,
      issueDate: input.issueDate ?? new Date(),
      reason: input.reason,
      conductRemark: input.conductRemark,
      lastClassName: student.enrollments[0]?.class.name ?? '—',
      // Freeze the academic record so the certificate can be reprinted verbatim.
      academicSummary: student.reportCards as never,
      issuedById: actorId,
    },
  });

  await prisma.student.update({
    where: { id: studentId },
    data: { status: 'TRANSFERRED', exitDate: new Date(), exitReason: input.reason },
  });

  return tc;
}

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

export async function recordBehaviour(
  auth: RequestAuth,
  studentId: string,
  input: {
    category: string;
    title: string;
    description: string;
    points: number;
    occurredOn: Date;
    actionTaken?: string | undefined;
    notifyParent: boolean;
  },
) {
  const record = await prisma.behaviourRecord.create({
    data: {
      studentId,
      recordedById: auth.employeeId!,
      category: input.category,
      title: input.title,
      description: input.description,
      points: input.points,
      occurredOn: input.occurredOn,
      actionTaken: input.actionTaken ?? null,
      parentNotified: input.notifyParent,
    },
  });

  if (input.notifyParent) {
    const { guardianUserIds } = await import(
      '../../core/notifications/notification.service.js'
    );
    const recipients = await guardianUserIds([studentId]);

    await notify({
      tenantId: auth.tenantId,
      userIds: recipients,
      title: `Behaviour note: ${input.title}`,
      body: input.description,
      channels: ['IN_APP', 'PUSH'],
      priority: input.category === 'INCIDENT' ? 'HIGH' : 'NORMAL',
      module: 'student',
      actionUrl: `/parent/students/${studentId}/behaviour`,
    });
  }

  return record;
}
