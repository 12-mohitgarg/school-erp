/** Reports & Analytics — the nine report families in PRD §7. */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../core/http/respond.js';
import { validate, uuidSchema, dateRangeQuery } from '../../core/http/validate.js';
import { requirePermission } from '../../core/auth/middleware.js';
import { scopedRequest } from '../../core/tenancy/scope.js';
import { auditFromRequest } from '../../core/audit/audit.service.js';
import { prisma } from '../../core/db/prisma.js';
import { percentage } from '@erp/shared';

const router = Router();

const reportQuery = dateRangeQuery.extend({
  classId: uuidSchema.optional(),
  sectionId: uuidSchema.optional(),
});

/** Academic performance across classes and subjects. */
router.get('/academic', requirePermission('reports:view'), validate({ query: reportQuery }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const q = req.query as unknown as { classId?: string };

    const marks = await prisma.markEntry.groupBy({
      by: ['subjectId'],
      where: {
        exam: { tenantId: auth.tenantId, ...(q.classId ? { classId: q.classId } : {}) },
        isAbsent: false,
      },
      _avg: { percentage: true },
      _count: { _all: true },
    });

    const subjects = await prisma.subject.findMany({
      where: { id: { in: marks.map((m) => m.subjectId) } },
      select: { id: true, name: true, code: true },
    });
    const nameById = new Map(subjects.map((s) => [s.id, s]));

    return ok(res, {
      bySubject: marks.map((m) => ({
        subject: nameById.get(m.subjectId)?.name ?? 'Unknown',
        code: nameById.get(m.subjectId)?.code ?? '',
        averagePercent: m._avg.percentage?.toNumber() ?? 0,
        entriesEvaluated: m._count._all,
      })).sort((a, b) => b.averagePercent - a.averagePercent),
    });
  }));

/** Examination results distribution. */
router.get('/examination', requirePermission('reports:view'), validate({ query: reportQuery }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);

    const [byGrade, aggregate] = await Promise.all([
      prisma.reportCard.groupBy({
        by: ['overallGrade'],
        where: { isPublished: true, student: { tenantId: auth.tenantId } },
        _count: { _all: true },
      }),
      prisma.reportCard.aggregate({
        where: { isPublished: true, student: { tenantId: auth.tenantId } },
        _avg: { percentage: true, gpa: true },
        _count: { _all: true },
      }),
    ]);

    return ok(res, {
      gradeDistribution: byGrade.map((g) => ({ grade: g.overallGrade ?? '—', count: g._count._all })),
      averagePercent: aggregate._avg.percentage?.toNumber() ?? 0,
      averageGpa: aggregate._avg.gpa?.toNumber() ?? 0,
      reportCards: aggregate._count._all,
    });
  }));

/** Fee collection, dues and transaction summary. */
router.get('/financial', requirePermission('reports:view'), validate({ query: dateRangeQuery }),
  asyncHandler(async (req, res) => {
    const { auth, tenant } = scopedRequest(req);
    const q = req.query as unknown as { from?: Date; to?: Date };

    const service = await import('../fees/fees.service.js');
    const report = await service.getCollectionReport(auth.tenantId, tenant, q);

    await auditFromRequest(req, { action: 'EXPORT', module: 'reports', entityType: 'FinancialReport' });
    return ok(res, report);
  }));

/** Daily / monthly / consolidated attendance. */
router.get('/attendance', requirePermission('reports:view'),
  validate({ query: reportQuery.extend({ groupBy: z.enum(['day', 'month', 'section', 'class']).default('month') }) }),
  asyncHandler(async (req, res) => {
    const { auth, tenant } = scopedRequest(req);
    const service = await import('../attendance/attendance.service.js');
    return ok(res, await service.getSummary(auth, tenant, req.query as never));
  }));

/** Books issued, returned, dues and inventory. */
router.get('/library', requirePermission('reports:view'), asyncHandler(async (req, res) => {
  const { auth, tenant } = scopedRequest(req);

  const [byStatus, fines, stock, popular] = await Promise.all([
    prisma.bookLoan.groupBy({
      by: ['status'],
      where: { bookCopy: { book: { tenantId: auth.tenantId } } },
      _count: { _all: true },
    }),
    prisma.bookLoan.aggregate({
      where: { bookCopy: { book: { tenantId: auth.tenantId } }, finePaid: false },
      _sum: { fineAmount: true },
    }),
    prisma.book.aggregate({
      where: { ...tenant },
      _sum: { totalCopies: true, availableCopies: true },
      _count: { _all: true },
    }),
    prisma.bookLoan.groupBy({
      by: ['bookCopyId'],
      where: { bookCopy: { book: { tenantId: auth.tenantId } } },
      _count: { _all: true },
      orderBy: { _count: { bookCopyId: 'desc' } },
      take: 10,
    }),
  ]);

  return ok(res, {
    loansByStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
    outstandingFines: fines._sum.fineAmount?.toNumber() ?? 0,
    titles: stock._count._all,
    totalCopies: stock._sum.totalCopies ?? 0,
    availableCopies: stock._sum.availableCopies ?? 0,
    mostBorrowedCopyIds: popular.map((p) => ({ bookCopyId: p.bookCopyId, loans: p._count._all })),
  });
}));

/** Route-wise and vehicle utilisation. */
router.get('/transport', requirePermission('reports:view'), asyncHandler(async (req, res) => {
  const { auth, tenant } = scopedRequest(req);

  const routes = await prisma.transportRoute.findMany({
    where: { ...tenant, isActive: true },
    select: {
      id: true, name: true, distanceKm: true,
      vehicle: { select: { registrationNo: true, capacity: true } },
      _count: { select: { allocations: { where: { isActive: true } } } },
    },
  });

  return ok(res, {
    routes: routes.map((r) => ({
      routeId: r.id,
      name: r.name,
      vehicle: r.vehicle?.registrationNo ?? null,
      capacity: r.vehicle?.capacity ?? 0,
      allocated: r._count.allocations,
      utilisationPercent: r.vehicle ? percentage(r._count.allocations, r.vehicle.capacity) : 0,
      distanceKm: r.distanceKm?.toNumber() ?? null,
    })),
  });
}));

/** Trip logs, geofence events, SOS incidents and route deviations (PRD §7). */
router.get('/safety', requirePermission('reports:view', 'tracking:view'),
  validate({ query: dateRangeQuery }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const q = req.query as unknown as { from?: Date; to?: Date };
    const range = q.from || q.to
      ? { gte: q.from ?? undefined, lte: q.to ?? undefined }
      : { gte: new Date(Date.now() - 30 * 86_400_000) };

    const [trips, alertsByType, sosByStatus, geofenceEvents] = await Promise.all([
      prisma.trip.aggregate({
        where: { tenantId: auth.tenantId, tripDate: range },
        _count: { _all: true },
        _sum: { distanceKm: true, studentsBoarded: true, alertCount: true },
      }),
      prisma.safetyAlert.groupBy({
        by: ['type'],
        where: { tenantId: auth.tenantId, occurredAt: range },
        _count: { _all: true },
      }),
      prisma.sosAlert.groupBy({
        by: ['status'],
        where: { tenantId: auth.tenantId, triggeredAt: range },
        _count: { _all: true },
      }),
      prisma.geofenceEvent.count({ where: { tenantId: auth.tenantId, occurredAt: range } }),
    ]);

    await auditFromRequest(req, { action: 'EXPORT', module: 'reports', entityType: 'SafetyReport' });

    return ok(res, {
      trips: trips._count._all,
      totalDistanceKm: trips._sum.distanceKm?.toNumber() ?? 0,
      studentsTransported: trips._sum.studentsBoarded ?? 0,
      totalAlerts: trips._sum.alertCount ?? 0,
      alertsByType: alertsByType.map((a) => ({ type: a.type, count: a._count._all })),
      sosByStatus: sosByStatus.map((s) => ({ status: s.status, count: s._count._all })),
      geofenceEvents,
    });
  }));

/** Parent engagement: live-view usage and notification adoption (PRD §7). */
router.get('/parent-engagement', requirePermission('reports:view'), asyncHandler(async (req, res) => {
  const { auth } = scopedRequest(req);
  const since = new Date(Date.now() - 30 * 86_400_000);

  const [locationViews, guardians, appAdopted, notifications, reads] = await Promise.all([
    prisma.locationAccessLog.count({ where: { viewer: { tenantId: auth.tenantId }, createdAt: { gte: since } } }),
    prisma.guardian.count({ where: { tenantId: auth.tenantId } }),
    prisma.guardian.count({ where: { tenantId: auth.tenantId, inviteAcceptedAt: { not: null } } }),
    prisma.notification.count({ where: { tenantId: auth.tenantId, createdAt: { gte: since } } }),
    prisma.notification.count({ where: { tenantId: auth.tenantId, createdAt: { gte: since }, readAt: { not: null } } }),
  ]);

  return ok(res, {
    locationViews30d: locationViews,
    guardiansTotal: guardians,
    guardiansOnApp: appAdopted,
    appAdoptionPercent: percentage(appAdopted, guardians),
    notificationsSent30d: notifications,
    notificationReadPercent: percentage(reads, notifications),
  });
}));

/** HR: attendance, leave and payroll summary. */
router.get('/hr', requirePermission('reports:view'), asyncHandler(async (req, res) => {
  const { auth, tenant } = scopedRequest(req);

  const [headcount, byDepartment, leaveByStatus, payroll] = await Promise.all([
    prisma.employee.count({ where: { ...tenant, status: 'ACTIVE', deletedAt: null } }),
    prisma.employee.groupBy({
      by: ['departmentId'],
      where: { ...tenant, status: 'ACTIVE', deletedAt: null },
      _count: { _all: true },
    }),
    prisma.leaveRequest.groupBy({
      by: ['status'],
      where: { employee: { tenantId: auth.tenantId } },
      _count: { _all: true },
    }),
    prisma.payrollRun.findFirst({
      where: { tenantId: auth.tenantId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: { month: true, year: true, totalEmployees: true, totalGross: true, totalNet: true, status: true },
    }),
  ]);

  const departments = await prisma.department.findMany({
    where: { tenantId: auth.tenantId },
    select: { id: true, name: true },
  });
  const deptName = new Map(departments.map((d) => [d.id, d.name]));

  return ok(res, {
    headcount,
    byDepartment: byDepartment.map((d) => ({
      department: d.departmentId ? (deptName.get(d.departmentId) ?? 'Unknown') : 'Unassigned',
      count: d._count._all,
    })),
    leaveByStatus: leaveByStatus.map((l) => ({ status: l.status, count: l._count._all })),
    latestPayroll: payroll ? {
      ...payroll,
      totalGross: payroll.totalGross.toNumber(),
      totalNet: payroll.totalNet.toNumber(),
    } : null,
  });
}));

/** Append-only audit trail, exportable for compliance review. */
router.get('/audit-log', requirePermission('settings:view'), asyncHandler(async (req, res) => {
  const { auth } = scopedRequest(req);
  const { pageParams: pp, paginated: pg } = await import('../../core/http/respond.js');
  const { page, limit, skip, take } = pp(req.query);

  const where = {
    tenantId: auth.tenantId,
    ...(req.query['module'] ? { module: req.query['module'] as string } : {}),
    ...(req.query['action'] ? { action: req.query['action'] as string } : {}),
    ...(req.query['entityType'] ? { entityType: req.query['entityType'] as string } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.auditLog.count({ where }),
  ]);

  return pg(res, items, total, page, limit);
}));

export default router;
