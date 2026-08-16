/** Examination evaluation, result publication and assignment grading. */

import { Prisma } from '@prisma/client';
import { resolveGrade, calculateGpa, percentage } from '@erp/shared';
import type { RequestAuth } from '../../types/express.js';
import { prisma } from '../../core/db/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { notify, guardianUserIds } from '../../core/notifications/notification.service.js';
import { moduleLogger } from '../../core/logger.js';

const log = moduleLogger('examination');

const dec = (n: number) => new Prisma.Decimal(n);

/** Marks sheet for one subject sitting, pre-filled with any saved entries. */
export async function getMarksSheet(tenantId: string, examScheduleId: string) {
  const schedule = await prisma.examSchedule.findFirst({
    where: { id: examScheduleId, exam: { tenantId } },
    select: {
      id: true,
      maxMarks: true,
      passingMarks: true,
      examDate: true,
      subject: { select: { id: true, name: true, code: true } },
      exam: {
        select: {
          id: true,
          name: true,
          status: true,
          gradingSystem: true,
          classId: true,
        },
      },
      markEntries: {
        select: {
          studentId: true,
          marksObtained: true,
          theoryMarks: true,
          practicalMarks: true,
          isAbsent: true,
          remarks: true,
          grade: true,
        },
      },
    },
  });

  if (!schedule) throw AppError.notFound('Exam schedule');

  const enrollments = await prisma.enrollment.findMany({
    where: {
      classId: schedule.exam.classId,
      isCurrent: true,
      student: { deletedAt: null, status: 'ACTIVE' },
    },
    orderBy: [{ rollNumber: 'asc' }],
    select: {
      rollNumber: true,
      student: { select: { id: true, admissionNo: true, firstName: true, lastName: true } },
      section: { select: { name: true } },
    },
  });

  const byStudent = new Map(schedule.markEntries.map((m) => [m.studentId, m]));

  return {
    schedule: {
      id: schedule.id,
      subject: schedule.subject,
      maxMarks: schedule.maxMarks.toNumber(),
      passingMarks: schedule.passingMarks.toNumber(),
      examDate: schedule.examDate,
      exam: schedule.exam,
    },
    students: enrollments.map((e) => {
      const entry = byStudent.get(e.student.id);
      return {
        studentId: e.student.id,
        admissionNo: e.student.admissionNo,
        rollNumber: e.rollNumber,
        sectionName: e.section.name,
        fullName: `${e.student.firstName} ${e.student.lastName}`,
        marksObtained: entry?.marksObtained?.toNumber() ?? null,
        theoryMarks: entry?.theoryMarks?.toNumber() ?? null,
        practicalMarks: entry?.practicalMarks?.toNumber() ?? null,
        isAbsent: entry?.isAbsent ?? false,
        grade: entry?.grade ?? null,
        remarks: entry?.remarks ?? null,
      };
    }),
  };
}

export async function saveMarks(
  auth: RequestAuth,
  examScheduleId: string,
  entries: Array<{
    studentId: string;
    marksObtained?: number | undefined;
    theoryMarks?: number | undefined;
    practicalMarks?: number | undefined;
    isAbsent: boolean;
    remarks?: string | undefined;
  }>,
): Promise<{ saved: number }> {
  const schedule = await prisma.examSchedule.findFirst({
    where: { id: examScheduleId, exam: { tenantId: auth.tenantId } },
    select: {
      id: true,
      examId: true,
      subjectId: true,
      maxMarks: true,
      passingMarks: true,
      exam: { select: { status: true } },
    },
  });

  if (!schedule) throw AppError.notFound('Exam schedule');
  if (schedule.exam.status === 'PUBLISHED') {
    throw AppError.conflict('Results are published; marks can no longer be edited');
  }

  const maxMarks = schedule.maxMarks.toNumber();
  const passing = schedule.passingMarks.toNumber();

  for (const entry of entries) {
    const total =
      entry.marksObtained ??
      ((entry.theoryMarks ?? 0) + (entry.practicalMarks ?? 0) || undefined);

    if (!entry.isAbsent && total !== undefined && total > maxMarks) {
      throw AppError.badRequest(
        `Marks (${total}) exceed the maximum of ${maxMarks} for student ${entry.studentId}`,
      );
    }
  }

  await prisma.$transaction(
    entries.map((entry) => {
      const total = entry.isAbsent
        ? null
        : (entry.marksObtained ??
          ((entry.theoryMarks ?? 0) + (entry.practicalMarks ?? 0) || null));

      const pct = total === null ? null : percentage(total, maxMarks, 2);
      const band = pct === null ? null : resolveGrade(pct);

      const data = {
        marksObtained: total === null ? null : dec(total),
        theoryMarks: entry.theoryMarks === undefined ? null : dec(entry.theoryMarks),
        practicalMarks: entry.practicalMarks === undefined ? null : dec(entry.practicalMarks),
        percentage: pct === null ? null : dec(pct),
        grade: band?.grade ?? null,
        gradePoints: band ? dec(band.points) : null,
        isAbsent: entry.isAbsent,
        isPassed: total !== null && total >= passing,
        remarks: entry.remarks ?? null,
        evaluatedById: auth.userId,
        evaluatedAt: new Date(),
      };

      return prisma.markEntry.upsert({
        where: {
          examScheduleId_studentId: { examScheduleId, studentId: entry.studentId },
        },
        create: {
          examId: schedule.examId,
          examScheduleId,
          studentId: entry.studentId,
          subjectId: schedule.subjectId,
          ...data,
        },
        update: data,
      });
    }),
  );

  // Move the exam into evaluation once marks start arriving.
  await prisma.exam.updateMany({
    where: { id: schedule.examId, status: { in: ['SCHEDULED', 'ONGOING'] } },
    data: { status: 'EVALUATION' },
  });

  return { saved: entries.length };
}

/**
 * Publish results: build a report card per student, rank the cohort, then
 * notify students and guardians.
 */
export async function publishResults(
  auth: RequestAuth,
  examId: string,
): Promise<{ reportCards: number; published: boolean }> {
  const exam = await prisma.exam.findFirst({
    where: { id: examId, tenantId: auth.tenantId },
    select: {
      id: true,
      name: true,
      examTermId: true,
      classId: true,
      status: true,
      schedules: { select: { id: true, maxMarks: true, subjectId: true } },
    },
  });

  if (!exam) throw AppError.notFound('Exam');
  if (exam.status === 'PUBLISHED') throw AppError.conflict('Results are already published');
  if (exam.schedules.length === 0) throw AppError.badRequest('This exam has no scheduled subjects');

  const marks = await prisma.markEntry.findMany({
    where: { examId },
    select: {
      studentId: true,
      subjectId: true,
      marksObtained: true,
      percentage: true,
      grade: true,
      isAbsent: true,
      isPassed: true,
      subject: { select: { name: true, code: true, credits: true } },
      examSchedule: { select: { maxMarks: true } },
    },
  });

  if (marks.length === 0) throw AppError.badRequest('No marks have been entered for this exam');

  // Group by student and compute totals.
  const byStudent = new Map<string, typeof marks>();
  for (const m of marks) {
    const list = byStudent.get(m.studentId) ?? [];
    list.push(m);
    byStudent.set(m.studentId, list);
  }

  const computed = [...byStudent.entries()].map(([studentId, rows]) => {
    const totalMarks = rows.reduce((sum, r) => sum + r.examSchedule.maxMarks.toNumber(), 0);
    const obtained = rows.reduce((sum, r) => sum + (r.marksObtained?.toNumber() ?? 0), 0);
    const pct = percentage(obtained, totalMarks, 2);

    const gpa = calculateGpa(
      rows.map((r) => ({
        percent: r.percentage?.toNumber() ?? 0,
        credits: r.subject.credits,
      })),
    );

    return {
      studentId,
      totalMarks,
      obtained,
      percentage: pct,
      gpa,
      overallGrade: resolveGrade(pct).grade,
      allPassed: rows.every((r) => r.isPassed || r.isAbsent),
      breakdown: rows.map((r) => ({
        subject: r.subject.name,
        code: r.subject.code,
        maxMarks: r.examSchedule.maxMarks.toNumber(),
        obtained: r.marksObtained?.toNumber() ?? null,
        percentage: r.percentage?.toNumber() ?? null,
        grade: r.grade,
        isAbsent: r.isAbsent,
        isPassed: r.isPassed,
      })),
    };
  });

  // Rank by percentage, highest first. Ties share a rank.
  const ranked = [...computed].sort((a, b) => b.percentage - a.percentage);
  const rankByStudent = new Map<string, number>();
  let lastPercent = Number.NaN;
  let lastRank = 0;

  ranked.forEach((row, index) => {
    const rank = row.percentage === lastPercent ? lastRank : index + 1;
    rankByStudent.set(row.studentId, rank);
    lastPercent = row.percentage;
    lastRank = rank;
  });

  await prisma.$transaction(async (tx) => {
    for (const row of computed) {
      await tx.reportCard.upsert({
        where: {
          studentId_examTermId: { studentId: row.studentId, examTermId: exam.examTermId },
        },
        create: {
          studentId: row.studentId,
          examTermId: exam.examTermId,
          totalMarks: dec(row.totalMarks),
          obtainedMarks: dec(row.obtained),
          percentage: dec(row.percentage),
          gpa: dec(row.gpa),
          overallGrade: row.overallGrade,
          rank: rankByStudent.get(row.studentId) ?? null,
          rankOutOf: computed.length,
          subjectBreakdown: row.breakdown as never,
          isPublished: true,
          publishedAt: new Date(),
        },
        update: {
          totalMarks: dec(row.totalMarks),
          obtainedMarks: dec(row.obtained),
          percentage: dec(row.percentage),
          gpa: dec(row.gpa),
          overallGrade: row.overallGrade,
          rank: rankByStudent.get(row.studentId) ?? null,
          rankOutOf: computed.length,
          subjectBreakdown: row.breakdown as never,
          isPublished: true,
          publishedAt: new Date(),
        },
      });
    }

    await tx.exam.update({
      where: { id: examId },
      data: { status: 'PUBLISHED', resultPublishedAt: new Date(), publishedById: auth.userId },
    });
  });

  // Notify families out of band.
  void (async () => {
    const studentIds = computed.map((c) => c.studentId);
    const [studentUsers, guardians] = await Promise.all([
      prisma.student.findMany({
        where: { id: { in: studentIds }, userId: { not: null } },
        select: { userId: true },
      }),
      guardianUserIds(studentIds),
    ]);

    const recipients = [
      ...new Set([
        ...studentUsers.map((s) => s.userId).filter((id): id is string => id !== null),
        ...guardians,
      ]),
    ];

    await notify({
      tenantId: auth.tenantId,
      userIds: recipients,
      title: 'Results published',
      body: `Results for ${exam.name} are now available. Open the app to view the report card.`,
      channels: ['IN_APP', 'PUSH', 'SMS'],
      priority: 'HIGH',
      module: 'examination',
      actionUrl: '/results',
    });
  })().catch((err: unknown) => log.error({ err, examId }, 'Result notification failed'));

  log.info({ examId, reportCards: computed.length }, 'Results published');
  return { reportCards: computed.length, published: true };
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export async function createAssignment(
  auth: RequestAuth,
  input: {
    classId: string;
    sectionId?: string | undefined;
    subjectId: string;
    title: string;
    description: string;
    instructions?: string | undefined;
    maxMarks: number;
    assignedOn: Date;
    dueAt: Date;
    allowLateSubmission: boolean;
    latePenaltyPercent: number;
    publish: boolean;
  },
) {
  const { publish, ...fields } = input;

  const assignment = await prisma.assignment.create({
    data: {
      tenantId: auth.tenantId,
      teacherId: auth.employeeId!,
      ...fields,
      maxMarks: dec(input.maxMarks),
      status: publish ? 'PUBLISHED' : 'DRAFT',
      publishedAt: publish ? new Date() : null,
    },
  });

  if (publish) {
    void notifyAssignmentPublished(auth.tenantId, assignment.id).catch((err: unknown) =>
      log.error({ err }, 'Assignment notification failed'),
    );
  }

  return assignment;
}

async function notifyAssignmentPublished(tenantId: string, assignmentId: string): Promise<void> {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      title: true,
      dueAt: true,
      classId: true,
      sectionId: true,
      subject: { select: { name: true } },
    },
  });

  if (!assignment) return;

  const students = await prisma.student.findMany({
    where: {
      enrollments: {
        some: {
          isCurrent: true,
          classId: assignment.classId,
          ...(assignment.sectionId ? { sectionId: assignment.sectionId } : {}),
        },
      },
      status: 'ACTIVE',
    },
    select: { id: true, userId: true },
  });

  const guardians = await guardianUserIds(students.map((s) => s.id));
  const recipients = [
    ...new Set([
      ...students.map((s) => s.userId).filter((id): id is string => id !== null),
      ...guardians,
    ]),
  ];

  await notify({
    tenantId,
    userIds: recipients,
    title: `New ${assignment.subject.name} assignment`,
    body: `${assignment.title} — due ${assignment.dueAt.toLocaleDateString('en-IN')}.`,
    channels: ['IN_APP', 'PUSH'],
    priority: 'NORMAL',
    module: 'examination',
    actionUrl: `/assignments/${assignmentId}`,
  });
}

export async function submitAssignment(
  studentId: string,
  assignmentId: string,
  input: { content?: string | undefined; attachmentUrls: string[] },
) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      status: true,
      dueAt: true,
      lateUntil: true,
      allowLateSubmission: true,
    },
  });

  if (!assignment) throw AppError.notFound('Assignment');
  if (assignment.status !== 'PUBLISHED') throw AppError.conflict('This assignment is not open');

  const now = new Date();
  const isLate = now > assignment.dueAt;

  if (isLate && !assignment.allowLateSubmission) {
    throw AppError.conflict('The submission window has closed');
  }
  if (isLate && assignment.lateUntil && now > assignment.lateUntil) {
    throw AppError.conflict('The late-submission window has closed');
  }

  return prisma.assignmentSubmission.upsert({
    where: { assignmentId_studentId: { assignmentId, studentId } },
    create: {
      assignmentId,
      studentId,
      content: input.content ?? null,
      attachmentUrls: input.attachmentUrls as never,
      status: isLate ? 'LATE' : 'SUBMITTED',
      submittedAt: now,
      isLate,
    },
    update: {
      content: input.content ?? null,
      attachmentUrls: input.attachmentUrls as never,
      status: isLate ? 'LATE' : 'SUBMITTED',
      submittedAt: now,
      isLate,
    },
  });
}

export async function gradeSubmission(
  auth: RequestAuth,
  submissionId: string,
  input: {
    marksObtained: number;
    feedback?: string | undefined;
    rubricScores?: Record<string, number> | undefined;
  },
) {
  const submission = await prisma.assignmentSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      isLate: true,
      studentId: true,
      assignment: {
        select: { id: true, title: true, maxMarks: true, latePenaltyPercent: true, tenantId: true },
      },
    },
  });

  if (!submission) throw AppError.notFound('Submission');
  if (submission.assignment.tenantId !== auth.tenantId) throw AppError.notFound('Submission');

  const maxMarks = submission.assignment.maxMarks.toNumber();
  if (input.marksObtained > maxMarks) {
    throw AppError.badRequest(`Marks cannot exceed the maximum of ${maxMarks}`);
  }

  // Apply the late penalty at grading time so the teacher enters the raw score.
  const penalty = submission.isLate
    ? (input.marksObtained * submission.assignment.latePenaltyPercent) / 100
    : 0;
  const finalMarks = Number(Math.max(0, input.marksObtained - penalty).toFixed(2));

  const graded = await prisma.assignmentSubmission.update({
    where: { id: submissionId },
    data: {
      marksObtained: dec(finalMarks),
      rubricScores: (input.rubricScores as never) ?? undefined,
      feedback: input.feedback ?? null,
      status: 'GRADED',
      gradedById: auth.userId,
      gradedAt: new Date(),
    },
  });

  const guardians = await guardianUserIds([submission.studentId]);
  if (guardians.length > 0) {
    void notify({
      tenantId: auth.tenantId,
      userIds: guardians,
      title: 'Assignment graded',
      body: `${submission.assignment.title}: ${finalMarks}/${maxMarks}${penalty > 0 ? ' (late penalty applied)' : ''}.`,
      channels: ['IN_APP', 'PUSH'],
      module: 'examination',
    }).catch(() => undefined);
  }

  return { ...graded, penaltyApplied: penalty };
}
