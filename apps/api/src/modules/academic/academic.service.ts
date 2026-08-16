/** Academic Management business logic. */

import type { RequestAuth } from '../../types/express.js';
import { prisma } from '../../core/db/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { assertSectionAccess } from '../../core/tenancy/scope.js';
import { notify } from '../../core/notifications/notification.service.js';

// ---------------------------------------------------------------------------
// Academic years
// ---------------------------------------------------------------------------

export async function createAcademicYear(
  tenantId: string,
  input: { name: string; startDate: Date; endDate: Date; isCurrent: boolean },
) {
  // Overlapping sessions would make "which year is this enrolment in?" ambiguous.
  const overlapping = await prisma.academicYear.findFirst({
    where: {
      tenantId,
      startDate: { lte: input.endDate },
      endDate: { gte: input.startDate },
    },
    select: { id: true, name: true },
  });

  if (overlapping) {
    throw AppError.conflict(`These dates overlap with the "${overlapping.name}" session`);
  }

  return prisma.$transaction(async (tx) => {
    if (input.isCurrent) {
      await tx.academicYear.updateMany({ where: { tenantId }, data: { isCurrent: false } });
    }
    return tx.academicYear.create({ data: { tenantId, ...input } });
  });
}

/** Exactly one year may be current, so activation is a swap, not a set. */
export async function activateAcademicYear(tenantId: string, id: string) {
  const year = await prisma.academicYear.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!year) throw AppError.notFound('Academic year');

  return prisma.$transaction(async (tx) => {
    await tx.academicYear.updateMany({ where: { tenantId }, data: { isCurrent: false } });
    return tx.academicYear.update({ where: { id }, data: { isCurrent: true } });
  });
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export async function listClasses(tenant: { tenantId: string; branchId?: string }) {
  const classes = await prisma.class.findMany({
    where: { ...tenant, isActive: true },
    orderBy: { level: 'asc' },
    select: {
      id: true,
      name: true,
      code: true,
      level: true,
      stream: true,
      sections: {
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          capacity: true,
          classTeacher: { select: { id: true, firstName: true, lastName: true } },
          room: { select: { id: true, name: true } },
          _count: { select: { enrollments: { where: { isCurrent: true } } } },
        },
      },
    },
  });

  return classes.map((cls) => ({
    ...cls,
    totalStudents: cls.sections.reduce((sum, s) => sum + s._count.enrollments, 0),
    sections: cls.sections.map((s) => ({
      id: s.id,
      name: s.name,
      capacity: s.capacity,
      enrolled: s._count.enrollments,
      // Surfaced so the UI can flag over-subscribed sections.
      seatsAvailable: Math.max(0, s.capacity - s._count.enrollments),
      classTeacher: s.classTeacher
        ? {
            id: s.classTeacher.id,
            name: `${s.classTeacher.firstName} ${s.classTeacher.lastName}`,
          }
        : null,
      room: s.room,
    })),
  }));
}

export async function listSectionStudents(auth: RequestAuth, sectionId: string) {
  assertSectionAccess(auth, sectionId);

  const enrollments = await prisma.enrollment.findMany({
    where: {
      sectionId,
      isCurrent: true,
      student: { tenantId: auth.tenantId, deletedAt: null, status: 'ACTIVE' },
    },
    orderBy: [{ rollNumber: 'asc' }, { student: { firstName: 'asc' } }],
    select: {
      rollNumber: true,
      student: {
        select: {
          id: true,
          admissionNo: true,
          firstName: true,
          lastName: true,
          photoUrl: true,
          gender: true,
        },
      },
    },
  });

  return enrollments.map((e) => ({
    ...e.student,
    fullName: `${e.student.firstName} ${e.student.lastName}`,
    rollNumber: e.rollNumber,
  }));
}

// ---------------------------------------------------------------------------
// Timetable
// ---------------------------------------------------------------------------

export async function getTimetable(
  tenantId: string,
  filter: { sectionId?: string | undefined; teacherId?: string | undefined; academicYearId?: string | undefined },
) {
  const slots = await prisma.timetableSlot.findMany({
    where: {
      tenantId,
      ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
      ...(filter.teacherId ? { teacherId: filter.teacherId } : {}),
      ...(filter.academicYearId ? { academicYearId: filter.academicYearId } : {}),
    },
    orderBy: [{ dayOfWeek: 'asc' }, { periodNumber: 'asc' }],
    select: {
      id: true,
      dayOfWeek: true,
      periodNumber: true,
      startTime: true,
      endTime: true,
      isBreak: true,
      subject: { select: { id: true, name: true, code: true, colorHex: true } },
      teacher: { select: { id: true, firstName: true, lastName: true } },
      room: { select: { id: true, name: true } },
      section: { select: { id: true, name: true, class: { select: { name: true } } } },
    },
  });

  // Return a day-keyed grid — the shape the timetable UI renders directly.
  const grid: Record<number, typeof slots> = {};
  for (let day = 1; day <= 7; day++) grid[day] = [];
  for (const slot of slots) grid[slot.dayOfWeek]?.push(slot);

  return { slots, grid };
}

/**
 * Create a timetable slot, rejecting the three ways a schedule can conflict:
 * the section is already busy, the teacher is already teaching, or the room is
 * already occupied at that time.
 */
export async function createTimetableSlot(
  tenantId: string,
  input: {
    academicYearId: string;
    classId: string;
    sectionId: string;
    subjectId: string;
    teacherId?: string | undefined;
    roomId?: string | undefined;
    dayOfWeek: number;
    periodNumber: number;
    startTime: string;
    endTime: string;
    isBreak: boolean;
  },
) {
  if (input.endTime <= input.startTime) {
    throw AppError.badRequest('End time must be after the start time');
  }

  const conflicts = await prisma.timetableSlot.findMany({
    where: {
      tenantId,
      academicYearId: input.academicYearId,
      dayOfWeek: input.dayOfWeek,
      periodNumber: input.periodNumber,
      OR: [
        { sectionId: input.sectionId },
        ...(input.teacherId ? [{ teacherId: input.teacherId }] : []),
        ...(input.roomId ? [{ roomId: input.roomId }] : []),
      ],
    },
    select: {
      sectionId: true,
      teacherId: true,
      roomId: true,
      section: { select: { name: true, class: { select: { name: true } } } },
      teacher: { select: { firstName: true, lastName: true } },
      room: { select: { name: true } },
    },
  });

  for (const clash of conflicts) {
    if (clash.sectionId === input.sectionId) {
      throw AppError.conflict(
        `${clash.section.class.name}-${clash.section.name} already has a class in period ${input.periodNumber}`,
      );
    }
    if (input.teacherId && clash.teacherId === input.teacherId) {
      throw AppError.conflict(
        `${clash.teacher?.firstName} ${clash.teacher?.lastName} is already teaching in period ${input.periodNumber}`,
      );
    }
    if (input.roomId && clash.roomId === input.roomId) {
      throw AppError.conflict(`Room ${clash.room?.name} is occupied in period ${input.periodNumber}`);
    }
  }

  return prisma.timetableSlot.create({
    data: {
      tenantId,
      academicYearId: input.academicYearId,
      classId: input.classId,
      sectionId: input.sectionId,
      subjectId: input.subjectId,
      teacherId: input.teacherId ?? null,
      roomId: input.roomId ?? null,
      dayOfWeek: input.dayOfWeek,
      periodNumber: input.periodNumber,
      startTime: input.startTime,
      endTime: input.endTime,
      isBreak: input.isBreak,
    },
  });
}

export async function arrangeSubstitution(
  auth: RequestAuth,
  input: { slotId: string; date: Date; substituteTeacherId: string; reason?: string | undefined },
) {
  const slot = await prisma.timetableSlot.findFirst({
    where: { id: input.slotId, tenantId: auth.tenantId },
    select: {
      id: true,
      teacherId: true,
      dayOfWeek: true,
      periodNumber: true,
      academicYearId: true,
      startTime: true,
      subject: { select: { name: true } },
      section: { select: { name: true, class: { select: { name: true } } } },
    },
  });

  if (!slot) throw AppError.notFound('Timetable slot');
  if (!slot.teacherId) throw AppError.badRequest('That period has no assigned teacher to cover');

  if (slot.teacherId === input.substituteTeacherId) {
    throw AppError.badRequest('The substitute must differ from the original teacher');
  }

  // The stand-in must actually be free at that time.
  const busy = await prisma.timetableSlot.findFirst({
    where: {
      tenantId: auth.tenantId,
      academicYearId: slot.academicYearId,
      teacherId: input.substituteTeacherId,
      dayOfWeek: slot.dayOfWeek,
      periodNumber: slot.periodNumber,
    },
    select: { id: true },
  });

  if (busy) throw AppError.conflict('That teacher already has a class in this period');

  const substitution = await prisma.substitution.create({
    data: {
      slotId: slot.id,
      date: input.date,
      originalTeacherId: slot.teacherId,
      substituteTeacherId: input.substituteTeacherId,
      reason: input.reason ?? null,
      createdById: auth.userId,
      notifiedAt: new Date(),
    },
  });

  const substitute = await prisma.employee.findUnique({
    where: { id: input.substituteTeacherId },
    select: { userId: true },
  });

  if (substitute?.userId) {
    await notify({
      tenantId: auth.tenantId,
      userIds: [substitute.userId],
      title: 'Substitution assigned',
      body: `You are covering ${slot.subject.name} for ${slot.section.class.name}-${slot.section.name}, period ${slot.periodNumber} at ${slot.startTime} on ${input.date.toDateString()}.`,
      channels: ['IN_APP', 'PUSH'],
      priority: 'HIGH',
      module: 'academic',
      actionUrl: '/teacher/timetable',
    });
  }

  return substitution;
}

/**
 * Teachers with no class in a given period. Optionally ranked so those who
 * already teach the subject appear first.
 */
export async function findAvailableTeachers(
  tenantId: string,
  input: { date: Date; dayOfWeek: number; periodNumber: number; subjectId?: string | undefined },
) {
  const [allTeachers, busySlots, onLeave] = await Promise.all([
    prisma.employee.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        deletedAt: null,
        designation: { isTeaching: true },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        subjectExpertise: true,
        designation: { select: { name: true } },
      },
    }),
    prisma.timetableSlot.findMany({
      where: { tenantId, dayOfWeek: input.dayOfWeek, periodNumber: input.periodNumber },
      select: { teacherId: true },
    }),
    prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        fromDate: { lte: input.date },
        toDate: { gte: input.date },
        employee: { tenantId },
      },
      select: { employeeId: true },
    }),
  ]);

  const unavailable = new Set<string>([
    ...busySlots.map((s) => s.teacherId).filter((id): id is string => id !== null),
    ...onLeave.map((l) => l.employeeId),
  ]);

  return allTeachers
    .filter((t) => !unavailable.has(t.id))
    .map((t) => ({
      id: t.id,
      name: `${t.firstName} ${t.lastName}`,
      designation: t.designation?.name ?? null,
      // A subject match makes for a far better cover than a free slot alone.
      isSubjectMatch: input.subjectId ? t.subjectExpertise.includes(input.subjectId) : false,
    }))
    .sort((a, b) => Number(b.isSubjectMatch) - Number(a.isSubjectMatch));
}
