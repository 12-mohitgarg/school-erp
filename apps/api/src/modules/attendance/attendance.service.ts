/** Attendance rules engine, marking and reporting. */

import type { Validated } from '../../core/http/validate.js';
import { percentage } from '@erp/shared';
import type { RequestAuth } from '../../types/express.js';
import { prisma } from '../../core/db/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { notify, guardianUserIds } from '../../core/notifications/notification.service.js';
import { emitToStudent } from '../../core/realtime/socket.js';
import { WS_EVENTS } from '@erp/shared';
import { moduleLogger } from '../../core/logger.js';

const log = moduleLogger('attendance');

interface RuleSet {
  id: string;
  graceMinutes: number;
  halfDayAfterMinutes: number;
  absenceAlertThreshold: number;
  minAttendancePercent: number;
  notifyParentOnAbsence: boolean;
  notifyParentOnLate: boolean;
  lockAfterHours: number;
  schoolStartTime: string;
}

const DEFAULT_RULES: Omit<RuleSet, 'id'> = {
  graceMinutes: 10,
  halfDayAfterMinutes: 120,
  absenceAlertThreshold: 3,
  minAttendancePercent: 75,
  notifyParentOnAbsence: true,
  notifyParentOnLate: false,
  lockAfterHours: 24,
  schoolStartTime: '08:00',
};

export async function getRules(tenantId: string, branchId: string | null): Promise<RuleSet> {
  const rule = await prisma.attendanceRule.findFirst({
    where: { tenantId, isActive: true, OR: [{ branchId }, { branchId: null }] },
    // A branch-specific rule takes precedence over the tenant default.
    orderBy: { branchId: 'desc' },
  });

  return rule ?? { id: 'default', ...DEFAULT_RULES };
}

export async function upsertRules(
  tenantId: string,
  branchId: string | null,
  input: Record<string, unknown>,
) {
  const existing = await prisma.attendanceRule.findFirst({
    where: { tenantId, branchId },
    select: { id: true },
  });

  if (existing) {
    return prisma.attendanceRule.update({ where: { id: existing.id }, data: input as never });
  }

  return prisma.attendanceRule.create({
    data: { tenantId, branchId, ...(input as Validated) },
  });
}

/**
 * Apply grace-time and half-day rules to a raw check-in.
 * Returns the status the rules imply, which overrides a plain PRESENT mark.
 */
function applyTimeRules(
  status: string,
  checkInAt: Date | undefined,
  rules: RuleSet,
): { status: string; lateByMinutes: number | null } {
  if (status !== 'PRESENT' || !checkInAt) return { status, lateByMinutes: null };

  const [h = 0, m = 0] = rules.schoolStartTime.split(':').map(Number);
  const startMinutes = h * 60 + m;
  const arrivalMinutes = checkInAt.getHours() * 60 + checkInAt.getMinutes();
  const lateBy = arrivalMinutes - startMinutes;

  if (lateBy <= rules.graceMinutes) return { status: 'PRESENT', lateByMinutes: null };
  if (lateBy >= rules.halfDayAfterMinutes) return { status: 'HALF_DAY', lateByMinutes: lateBy };
  return { status: 'LATE', lateByMinutes: lateBy };
}

export async function markAttendance(
  auth: RequestAuth,
  input: {
    sectionId: string;
    subjectId?: string | undefined;
    date: Date;
    periodNumber?: number | undefined;
    source: string;
    records: Array<{
      studentId: string;
      status: string;
      remarks?: string | undefined;
      checkInAt?: Date | undefined;
      lateByMinutes?: number | undefined;
    }>;
  },
): Promise<{ sessionId: string; marked: number; absent: number; late: number }> {
  const rules = await getRules(auth.tenantId, auth.branchId);

  // Refuse to backfill beyond the editing window.
  const ageHours = (Date.now() - input.date.getTime()) / 3_600_000;
  if (ageHours > rules.lockAfterHours && auth.scope === 'ASSIGNED') {
    throw AppError.forbidden(
      `Attendance can only be edited within ${rules.lockAfterHours} hours. Ask an administrator to amend it.`,
    );
  }

  const existing = await prisma.attendanceSession.findUnique({
    where: {
      sectionId_date_periodNumber: {
        sectionId: input.sectionId,
        date: input.date,
        periodNumber: input.periodNumber ?? 0,
      },
    },
    select: { id: true, isLocked: true },
  });

  if (existing?.isLocked) throw AppError.conflict('This attendance register is locked');

  // Resolve rule-driven statuses before counting, so the totals match the rows.
  const resolved = input.records.map((r) => {
    const applied = applyTimeRules(r.status, r.checkInAt, rules);
    return { ...r, status: applied.status, lateByMinutes: r.lateByMinutes ?? applied.lateByMinutes };
  });

  const presentCount = resolved.filter((r) => r.status === 'PRESENT').length;
  const absentCount = resolved.filter((r) => r.status === 'ABSENT').length;
  const lateCount = resolved.filter((r) => r.status === 'LATE').length;

  const session = await prisma.$transaction(async (tx) => {
    const s = await tx.attendanceSession.upsert({
      where: {
        sectionId_date_periodNumber: {
          sectionId: input.sectionId,
          date: input.date,
          periodNumber: input.periodNumber ?? 0,
        },
      },
      create: {
        tenantId: auth.tenantId,
        sectionId: input.sectionId,
        subjectId: input.subjectId ?? null,
        date: input.date,
        periodNumber: input.periodNumber ?? 0,
        takenById: auth.employeeId ?? null,
        takenAt: new Date(),
        totalStudents: resolved.length,
        presentCount,
        absentCount,
        lateCount,
      },
      update: {
        takenById: auth.employeeId ?? null,
        takenAt: new Date(),
        totalStudents: resolved.length,
        presentCount,
        absentCount,
        lateCount,
      },
      select: { id: true },
    });

    for (const record of resolved) {
      await tx.attendanceRecord.upsert({
        where: { sessionId_studentId: { sessionId: s.id, studentId: record.studentId } },
        create: {
          sessionId: s.id,
          studentId: record.studentId,
          status: record.status as never,
          source: input.source as never,
          checkInAt: record.checkInAt ?? null,
          lateByMinutes: record.lateByMinutes ?? null,
          remarks: record.remarks ?? null,
        },
        update: {
          status: record.status as never,
          source: input.source as never,
          checkInAt: record.checkInAt ?? null,
          lateByMinutes: record.lateByMinutes ?? null,
          remarks: record.remarks ?? null,
        },
      });
    }

    return s;
  });

  // Notify guardians out of band — a slow SMS gateway must not block marking.
  void notifyAbsentees(auth.tenantId, session.id, resolved, rules).catch((err: unknown) =>
    log.error({ err, sessionId: session.id }, 'Absence notification failed'),
  );

  for (const record of resolved) {
    emitToStudent(record.studentId, WS_EVENTS.ATTENDANCE_UPDATE, {
      studentId: record.studentId,
      date: input.date.toISOString(),
      status: record.status,
    });
  }

  return { sessionId: session.id, marked: resolved.length, absent: absentCount, late: lateCount };
}

/** PRD 5.3: automatic parent notification on absence. */
async function notifyAbsentees(
  tenantId: string,
  sessionId: string,
  records: Array<{ studentId: string; status: string }>,
  rules: RuleSet,
): Promise<void> {
  const targets = records.filter(
    (r) =>
      (r.status === 'ABSENT' && rules.notifyParentOnAbsence) ||
      (r.status === 'LATE' && rules.notifyParentOnLate),
  );

  if (targets.length === 0) return;

  const students = await prisma.student.findMany({
    where: { id: { in: targets.map((t) => t.studentId) } },
    select: { id: true, firstName: true, lastName: true },
  });

  const nameById = new Map(students.map((s) => [s.id, `${s.firstName} ${s.lastName}`]));
  const today = new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' });

  for (const target of targets) {
    const recipients = await guardianUserIds([target.studentId]);
    if (recipients.length === 0) continue;

    const name = nameById.get(target.studentId) ?? 'Your child';
    const isAbsent = target.status === 'ABSENT';

    await notify({
      tenantId,
      userIds: recipients,
      title: isAbsent ? 'Absence recorded' : 'Late arrival recorded',
      body: isAbsent
        ? `${name} was marked absent on ${today}. Please contact the school if this is unexpected.`
        : `${name} arrived late on ${today}.`,
      channels: isAbsent ? ['IN_APP', 'PUSH', 'SMS'] : ['IN_APP', 'PUSH'],
      priority: isAbsent ? 'HIGH' : 'NORMAL',
      module: 'attendance',
      actionUrl: `/parent/attendance/${target.studentId}`,
    });
  }

  await prisma.attendanceRecord.updateMany({
    where: { sessionId, studentId: { in: targets.map((t) => t.studentId) } },
    data: { parentNotifiedAt: new Date() },
  });
}

/** Register for a section/date, pre-filled with any existing marks. */
export async function getRegister(
  tenantId: string,
  input: { sectionId: string; date: Date; periodNumber?: number | undefined },
) {
  const [section, session] = await Promise.all([
    prisma.section.findUnique({
      where: { id: input.sectionId },
      select: {
        id: true,
        name: true,
        class: { select: { id: true, name: true } },
        enrollments: {
          where: { isCurrent: true, student: { deletedAt: null, status: 'ACTIVE' } },
          orderBy: [{ rollNumber: 'asc' }],
          select: {
            rollNumber: true,
            student: {
              select: { id: true, admissionNo: true, firstName: true, lastName: true, photoUrl: true },
            },
          },
        },
      },
    }),
    prisma.attendanceSession.findUnique({
      where: {
        sectionId_date_periodNumber: {
          sectionId: input.sectionId,
          date: input.date,
          periodNumber: input.periodNumber ?? 0,
        },
      },
      select: {
        id: true,
        isLocked: true,
        takenAt: true,
        records: {
          select: {
            studentId: true,
            status: true,
            source: true,
            lateByMinutes: true,
            remarks: true,
          },
        },
      },
    }),
  ]);

  if (!section) throw AppError.notFound('Section');

  const marks = new Map((session?.records ?? []).map((r) => [r.studentId, r]));

  return {
    section: { id: section.id, name: section.name, class: section.class },
    date: input.date,
    periodNumber: input.periodNumber ?? 0,
    isMarked: session !== null,
    isLocked: session?.isLocked ?? false,
    takenAt: session?.takenAt ?? null,
    students: section.enrollments.map((e) => {
      const mark = marks.get(e.student.id);
      return {
        studentId: e.student.id,
        admissionNo: e.student.admissionNo,
        rollNumber: e.rollNumber,
        fullName: `${e.student.firstName} ${e.student.lastName}`,
        photoUrl: e.student.photoUrl,
        // Default to PRESENT so a teacher only has to tap the exceptions.
        status: mark?.status ?? 'PRESENT',
        source: mark?.source ?? null,
        lateByMinutes: mark?.lateByMinutes ?? null,
        remarks: mark?.remarks ?? null,
      };
    }),
  };
}

export async function getStudentAttendance(
  studentId: string,
  range: { from?: Date | undefined; to?: Date | undefined },
) {
  const where = {
    studentId,
    ...(range.from || range.to
      ? {
          session: {
            date: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lte: range.to } : {}),
            },
          },
        }
      : {}),
  };

  const [records, breakdown] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where,
      orderBy: { session: { date: 'desc' } },
      take: 400,
      select: {
        status: true,
        source: true,
        lateByMinutes: true,
        remarks: true,
        session: {
          select: {
            date: true,
            periodNumber: true,
            subject: { select: { name: true } },
          },
        },
      },
    }),
    prisma.attendanceRecord.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    }),
  ]);

  const counts = Object.fromEntries(breakdown.map((b) => [b.status, b._count._all]));
  const total = breakdown.reduce((sum, b) => sum + b._count._all, 0);
  const present = (counts['PRESENT'] ?? 0) + (counts['LATE'] ?? 0);

  return {
    records,
    summary: {
      total,
      present: counts['PRESENT'] ?? 0,
      absent: counts['ABSENT'] ?? 0,
      late: counts['LATE'] ?? 0,
      halfDay: counts['HALF_DAY'] ?? 0,
      excused: counts['EXCUSED'] ?? 0,
      // LATE still counts as attending for the percentage.
      attendancePercent: percentage(present, total),
    },
  };
}

export async function getSummary(
  auth: RequestAuth,
  tenant: { tenantId: string; branchId?: string },
  q: {
    from?: Date | undefined;
    to?: Date | undefined;
    classId?: string | undefined;
    sectionId?: string | undefined;
    groupBy: string;
  },
) {
  const sessions = await prisma.attendanceSession.findMany({
    where: {
      tenantId: tenant.tenantId,
      ...(q.from || q.to
        ? { date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
        : {}),
      ...(q.sectionId ? { sectionId: q.sectionId } : {}),
      ...(q.classId ? { section: { classId: q.classId } } : {}),
      ...(auth.scope === 'ASSIGNED'
        ? { sectionId: { in: auth.assignedSectionIds ?? [] } }
        : {}),
    },
    select: {
      date: true,
      totalStudents: true,
      presentCount: true,
      absentCount: true,
      lateCount: true,
      section: {
        select: { id: true, name: true, class: { select: { id: true, name: true } } },
      },
    },
    orderBy: { date: 'asc' },
  });

  // Aggregate in memory: the row count here is bounded by the date range, and
  // this keeps one code path for all four grouping modes.
  const buckets = new Map<
    string,
    { key: string; label: string; total: number; present: number; absent: number; late: number }
  >();

  for (const s of sessions) {
    let key: string;
    let label: string;

    switch (q.groupBy) {
      case 'month':
        key = s.date.toISOString().slice(0, 7);
        label = key;
        break;
      case 'section':
        key = s.section.id;
        label = `${s.section.class.name}-${s.section.name}`;
        break;
      case 'class':
        key = s.section.class.id;
        label = s.section.class.name;
        break;
      default:
        key = s.date.toISOString().slice(0, 10);
        label = key;
    }

    const bucket = buckets.get(key) ?? { key, label, total: 0, present: 0, absent: 0, late: 0 };
    bucket.total += s.totalStudents;
    bucket.present += s.presentCount;
    bucket.absent += s.absentCount;
    bucket.late += s.lateCount;
    buckets.set(key, bucket);
  }

  const series = [...buckets.values()].map((b) => ({
    ...b,
    attendancePercent: percentage(b.present + b.late, b.total),
  }));

  const totals = series.reduce(
    (acc, b) => ({
      total: acc.total + b.total,
      present: acc.present + b.present,
      absent: acc.absent + b.absent,
      late: acc.late + b.late,
    }),
    { total: 0, present: 0, absent: 0, late: 0 },
  );

  return {
    series,
    totals: {
      ...totals,
      attendancePercent: percentage(totals.present + totals.late, totals.total),
    },
  };
}

/** Students below the attendance threshold, worst first. */
export async function getDefaulters(
  tenantId: string,
  tenant: { tenantId: string; branchId?: string },
  q: { from?: Date | undefined; to?: Date | undefined; threshold?: number | undefined; classId?: string | undefined },
) {
  const rules = await getRules(tenantId, tenant.branchId ?? null);
  const threshold = q.threshold ?? rules.minAttendancePercent;

  const grouped = await prisma.attendanceRecord.groupBy({
    by: ['studentId', 'status'],
    where: {
      student: {
        tenantId,
        ...(tenant.branchId ? { branchId: tenant.branchId } : {}),
        deletedAt: null,
        status: 'ACTIVE',
        ...(q.classId ? { enrollments: { some: { classId: q.classId, isCurrent: true } } } : {}),
      },
      ...(q.from || q.to
        ? {
            session: {
              date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) },
            },
          }
        : {}),
    },
    _count: { _all: true },
  });

  const byStudent = new Map<string, { total: number; present: number }>();
  for (const row of grouped) {
    const entry = byStudent.get(row.studentId) ?? { total: 0, present: 0 };
    entry.total += row._count._all;
    if (row.status === 'PRESENT' || row.status === 'LATE') entry.present += row._count._all;
    byStudent.set(row.studentId, entry);
  }

  const defaulterIds: Array<{ studentId: string; percent: number; total: number }> = [];
  for (const [studentId, stats] of byStudent) {
    // Ignore students with too little data to judge.
    if (stats.total < 5) continue;
    const percent = percentage(stats.present, stats.total);
    if (percent < threshold) defaulterIds.push({ studentId, percent, total: stats.total });
  }

  if (defaulterIds.length === 0) return { threshold, students: [] };

  const students = await prisma.student.findMany({
    where: { id: { in: defaulterIds.map((d) => d.studentId) } },
    select: {
      id: true,
      admissionNo: true,
      firstName: true,
      lastName: true,
      photoUrl: true,
      enrollments: {
        where: { isCurrent: true },
        take: 1,
        select: { class: { select: { name: true } }, section: { select: { name: true } } },
      },
    },
  });

  const detailById = new Map(students.map((s) => [s.id, s]));

  return {
    threshold,
    students: defaulterIds
      .map((d) => {
        const student = detailById.get(d.studentId);
        if (!student) return null;
        return {
          studentId: d.studentId,
          admissionNo: student.admissionNo,
          fullName: `${student.firstName} ${student.lastName}`,
          photoUrl: student.photoUrl,
          className: student.enrollments[0]?.class.name ?? null,
          sectionName: student.enrollments[0]?.section.name ?? null,
          attendancePercent: d.percent,
          daysMarked: d.total,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => a.attendancePercent - b.attendancePercent),
  };
}

// ---------------------------------------------------------------------------
// Staff attendance
// ---------------------------------------------------------------------------

export async function staffCheckIn(tenantId: string, employeeId: string, source: string) {
  const rules = await getRules(tenantId, null);
  const now = new Date();
  const date = new Date(now.toISOString().slice(0, 10));

  const existing = await prisma.employeeAttendance.findUnique({
    where: { employeeId_date: { employeeId, date } },
    select: { id: true, checkInAt: true },
  });

  if (existing?.checkInAt) throw AppError.conflict('Already checked in for today');

  const { status, lateByMinutes } = applyTimeRules('PRESENT', now, rules);

  return prisma.employeeAttendance.upsert({
    where: { employeeId_date: { employeeId, date } },
    create: {
      employeeId,
      date,
      status: status as never,
      source: source as never,
      checkInAt: now,
      lateByMinutes,
    },
    update: { checkInAt: now, status: status as never, lateByMinutes },
  });
}

export async function staffCheckOut(employeeId: string) {
  const now = new Date();
  const date = new Date(now.toISOString().slice(0, 10));

  const record = await prisma.employeeAttendance.findUnique({
    where: { employeeId_date: { employeeId, date } },
    select: { id: true, checkInAt: true },
  });

  if (!record?.checkInAt) throw AppError.badRequest('No check-in recorded for today');

  const workedHours = Number(
    ((now.getTime() - record.checkInAt.getTime()) / 3_600_000).toFixed(2),
  );

  return prisma.employeeAttendance.update({
    where: { id: record.id },
    data: { checkOutAt: now, workedHours },
  });
}

