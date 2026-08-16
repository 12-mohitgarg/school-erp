/**
 * Role-aware dashboard.
 *
 * One endpoint that returns the KPI set appropriate to the caller's role, so
 * each panel's landing page is a single request rather than a dozen.
 */

import { Router } from 'express';
import { asyncHandler, ok } from '../../core/http/respond.js';
import { requireAuth } from '../../core/auth/middleware.js';
import { scopedRequest, visibleStudentIds } from '../../core/tenancy/scope.js';
import { prisma } from '../../core/db/prisma.js';
import { cached, keys } from '../../core/cache/redis.js';
import { percentage } from '@erp/shared';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { auth, tenant } = scopedRequest(req);

  // Dashboards are read-heavy and tolerate a short staleness window.
  const payload = await cached(
    keys.dashboard(auth.tenantId, auth.role, auth.branchId),
    60,
    () => buildDashboard(auth, tenant),
  );

  return ok(res, payload);
}));

type Auth = ReturnType<typeof requireAuth>;

async function buildDashboard(auth: Auth, tenant: { tenantId: string; branchId?: string }) {
  switch (auth.role) {
    case 'SUPER_ADMIN':
    case 'ADMIN':
    case 'ADMINISTRATION':
      return adminDashboard(auth, tenant);
    case 'TEACHER':
      return teacherDashboard(auth);
    case 'ACCOUNTANT':
      return accountantDashboard(auth, tenant);
    case 'LIBRARIAN':
      return librarianDashboard(auth, tenant);
    case 'HR':
      return hrDashboard(auth, tenant);
    case 'PARENT':
    case 'STUDENT':
      return familyDashboard(auth);
    case 'DRIVER':
      return driverDashboard(auth);
    default:
      return { stats: [], updatedAt: new Date().toISOString() };
  }
}

const today = () => new Date(new Date().toISOString().slice(0, 10));

async function adminDashboard(auth: Auth, tenant: { tenantId: string; branchId?: string }) {
  const [students, staff, todayAttendance, feeAgg, activeTrips, openSos, recentAlerts] =
    await Promise.all([
      prisma.student.count({ where: { ...tenant, status: 'ACTIVE', deletedAt: null } }),
      prisma.employee.count({ where: { ...tenant, status: 'ACTIVE', deletedAt: null } }),
      prisma.attendanceSession.aggregate({
        where: { tenantId: auth.tenantId, date: today() },
        _sum: { totalStudents: true, presentCount: true, absentCount: true },
      }),
      prisma.invoice.aggregate({
        where: { ...tenant, status: { notIn: ['CANCELLED', 'DRAFT'] } },
        _sum: { totalAmount: true, paidAmount: true, balanceAmount: true },
      }),
      prisma.trip.count({ where: { tenantId: auth.tenantId, status: 'IN_PROGRESS' } }),
      prisma.sosAlert.count({ where: { tenantId: auth.tenantId, status: 'ACTIVE' } }),
      prisma.safetyAlert.findMany({
        where: { tenantId: auth.tenantId, occurredAt: { gte: new Date(Date.now() - 86_400_000) } },
        orderBy: { occurredAt: 'desc' },
        take: 8,
        select: { id: true, type: true, severity: true, message: true, occurredAt: true,
          vehicle: { select: { registrationNo: true } } },
      }),
    ]);

  const marked = todayAttendance._sum.totalStudents ?? 0;
  const present = todayAttendance._sum.presentCount ?? 0;

  return {
    stats: [
      { key: 'students', label: 'Active students', value: students, format: 'number' },
      { key: 'staff', label: 'Staff on roll', value: staff, format: 'number' },
      {
        key: 'attendance',
        label: "Today's attendance",
        value: marked === 0 ? '—' : `${percentage(present, marked)}%`,
        hint: marked === 0 ? 'Not marked yet' : `${present} of ${marked} present`,
      },
      {
        key: 'collected',
        label: 'Fees collected',
        value: feeAgg._sum.paidAmount?.toNumber() ?? 0,
        format: 'currency',
      },
      {
        key: 'outstanding',
        label: 'Fees outstanding',
        value: feeAgg._sum.balanceAmount?.toNumber() ?? 0,
        format: 'currency',
      },
      { key: 'trips', label: 'Buses on the road', value: activeTrips, format: 'number' },
      { key: 'sos', label: 'Open SOS alerts', value: openSos, format: 'number',
        hint: openSos > 0 ? 'Requires immediate attention' : 'All clear' },
    ],
    alerts: recentAlerts,
    updatedAt: new Date().toISOString(),
  };
}

async function teacherDashboard(auth: Auth) {
  const sectionIds = auth.assignedSectionIds ?? [];
  const dayOfWeek = new Date().getDay() === 0 ? 7 : new Date().getDay();

  const [sections, pendingRegisters, todayPeriods, ungraded] = await Promise.all([
    prisma.section.count({ where: { id: { in: sectionIds } } }),
    // Sections assigned to this teacher with no register taken today.
    prisma.section.count({
      where: {
        id: { in: sectionIds },
        attendanceSessions: { none: { date: today() } },
      },
    }),
    prisma.timetableSlot.findMany({
      where: { teacherId: auth.employeeId ?? '', dayOfWeek },
      orderBy: { periodNumber: 'asc' },
      select: {
        periodNumber: true, startTime: true, endTime: true,
        subject: { select: { name: true, colorHex: true } },
        section: { select: { name: true, class: { select: { name: true } } } },
        room: { select: { name: true } },
      },
    }),
    prisma.assignmentSubmission.count({
      where: { assignment: { teacherId: auth.employeeId ?? '' }, status: { in: ['SUBMITTED', 'LATE'] } },
    }),
  ]);

  return {
    stats: [
      { key: 'sections', label: 'My sections', value: sections, format: 'number' },
      { key: 'pending', label: 'Registers to take', value: pendingRegisters, format: 'number',
        hint: pendingRegisters > 0 ? 'Attendance not yet marked today' : 'All done' },
      { key: 'periods', label: "Today's periods", value: todayPeriods.length, format: 'number' },
      { key: 'ungraded', label: 'Submissions to grade', value: ungraded, format: 'number' },
    ],
    timetable: todayPeriods,
    updatedAt: new Date().toISOString(),
  };
}

async function accountantDashboard(auth: Auth, tenant: { tenantId: string; branchId?: string }) {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [agg, thisMonth, overdue, recent] = await Promise.all([
    prisma.invoice.aggregate({
      where: { ...tenant, status: { notIn: ['CANCELLED', 'DRAFT'] } },
      _sum: { totalAmount: true, paidAmount: true, balanceAmount: true },
    }),
    prisma.payment.aggregate({
      where: { tenantId: auth.tenantId, status: 'SUCCESS', paidAt: { gte: monthStart } },
      _sum: { amount: true }, _count: { _all: true },
    }),
    prisma.invoice.aggregate({
      where: { ...tenant, status: 'OVERDUE' },
      _sum: { balanceAmount: true }, _count: { _all: true },
    }),
    prisma.payment.findMany({
      where: { tenantId: auth.tenantId, status: 'SUCCESS' },
      orderBy: { createdAt: 'desc' }, take: 10,
      select: { id: true, receiptNo: true, amount: true, mode: true, paidAt: true,
        student: { select: { firstName: true, lastName: true, admissionNo: true } } },
    }),
  ]);

  return {
    stats: [
      { key: 'billed', label: 'Total billed', value: agg._sum.totalAmount?.toNumber() ?? 0, format: 'currency' },
      { key: 'collected', label: 'Total collected', value: agg._sum.paidAmount?.toNumber() ?? 0, format: 'currency' },
      { key: 'outstanding', label: 'Outstanding', value: agg._sum.balanceAmount?.toNumber() ?? 0, format: 'currency' },
      { key: 'month', label: 'Collected this month', value: thisMonth._sum.amount?.toNumber() ?? 0,
        format: 'currency', hint: `${thisMonth._count._all} transactions` },
      { key: 'overdue', label: 'Overdue amount', value: overdue._sum.balanceAmount?.toNumber() ?? 0,
        format: 'currency', hint: `${overdue._count._all} invoices` },
    ],
    recentPayments: recent,
    updatedAt: new Date().toISOString(),
  };
}

async function librarianDashboard(auth: Auth, tenant: { tenantId: string; branchId?: string }) {
  const [stock, issued, overdue, fines] = await Promise.all([
    prisma.book.aggregate({ where: { ...tenant }, _sum: { totalCopies: true, availableCopies: true }, _count: { _all: true } }),
    prisma.bookLoan.count({ where: { bookCopy: { book: { tenantId: auth.tenantId } }, status: 'ISSUED' } }),
    prisma.bookLoan.count({ where: { bookCopy: { book: { tenantId: auth.tenantId } }, status: 'OVERDUE' } }),
    prisma.bookLoan.aggregate({
      where: { bookCopy: { book: { tenantId: auth.tenantId } }, finePaid: false },
      _sum: { fineAmount: true },
    }),
  ]);

  return {
    stats: [
      { key: 'titles', label: 'Titles catalogued', value: stock._count._all, format: 'number' },
      { key: 'copies', label: 'Total copies', value: stock._sum.totalCopies ?? 0, format: 'number' },
      { key: 'available', label: 'Available now', value: stock._sum.availableCopies ?? 0, format: 'number' },
      { key: 'issued', label: 'Currently issued', value: issued, format: 'number' },
      { key: 'overdue', label: 'Overdue', value: overdue, format: 'number' },
      { key: 'fines', label: 'Fines outstanding', value: fines._sum.fineAmount?.toNumber() ?? 0, format: 'currency' },
    ],
    updatedAt: new Date().toISOString(),
  };
}

async function hrDashboard(auth: Auth, tenant: { tenantId: string; branchId?: string }) {
  const [headcount, onLeaveToday, pendingLeave, presentToday] = await Promise.all([
    prisma.employee.count({ where: { ...tenant, status: 'ACTIVE', deletedAt: null } }),
    prisma.leaveRequest.count({
      where: { employee: { tenantId: auth.tenantId }, status: 'APPROVED',
        fromDate: { lte: today() }, toDate: { gte: today() } },
    }),
    prisma.leaveRequest.count({ where: { employee: { tenantId: auth.tenantId }, status: 'PENDING' } }),
    prisma.employeeAttendance.count({
      where: { employee: { tenantId: auth.tenantId }, date: today(), status: { in: ['PRESENT', 'LATE'] } },
    }),
  ]);

  return {
    stats: [
      { key: 'headcount', label: 'Employees', value: headcount, format: 'number' },
      { key: 'present', label: 'Present today', value: presentToday, format: 'number',
        hint: headcount > 0 ? `${percentage(presentToday, headcount)}% of staff` : undefined },
      { key: 'onLeave', label: 'On leave today', value: onLeaveToday, format: 'number' },
      { key: 'pendingLeave', label: 'Leave approvals pending', value: pendingLeave, format: 'number' },
    ],
    updatedAt: new Date().toISOString(),
  };
}

async function familyDashboard(auth: Auth) {
  const studentIds = visibleStudentIds(auth) ?? [];
  if (studentIds.length === 0) {
    return { stats: [], children: [], updatedAt: new Date().toISOString() };
  }

  const [attendanceRows, feeAgg, unread, pendingWork] = await Promise.all([
    prisma.attendanceRecord.groupBy({
      by: ['status'], where: { studentId: { in: studentIds } }, _count: { _all: true },
    }),
    prisma.invoice.aggregate({
      where: { studentId: { in: studentIds }, status: { notIn: ['CANCELLED', 'DRAFT'] } },
      _sum: { balanceAmount: true },
    }),
    prisma.notification.count({ where: { userId: auth.userId, readAt: null, archivedAt: null } }),
    prisma.assignment.count({
      where: {
        status: 'PUBLISHED', dueAt: { gte: new Date() },
        submissions: { none: { studentId: { in: studentIds }, status: { in: ['SUBMITTED', 'GRADED', 'LATE'] } } },
      },
    }),
  ]);

  const totalMarked = attendanceRows.reduce((s, r) => s + r._count._all, 0);
  const present = attendanceRows
    .filter((r) => r.status === 'PRESENT' || r.status === 'LATE')
    .reduce((s, r) => s + r._count._all, 0);

  return {
    stats: [
      { key: 'attendance', label: 'Attendance', value: totalMarked === 0 ? '—' : `${percentage(present, totalMarked)}%`,
        hint: `${present} of ${totalMarked} days` },
      { key: 'dues', label: 'Fees due', value: feeAgg._sum.balanceAmount?.toNumber() ?? 0, format: 'currency' },
      { key: 'homework', label: 'Homework pending', value: pendingWork, format: 'number' },
      { key: 'unread', label: 'Unread notifications', value: unread, format: 'number' },
    ],
    updatedAt: new Date().toISOString(),
  };
}

async function driverDashboard(auth: Auth) {
  const trip = await prisma.trip.findFirst({
    where: { driverId: auth.employeeId ?? '', status: 'IN_PROGRESS' },
    select: {
      id: true, direction: true, startedAt: true, studentsBoarded: true, studentsAlighted: true,
      route: { select: { name: true, _count: { select: { stops: true } } } },
      vehicle: { select: { registrationNo: true } },
    },
  });

  const completedToday = await prisma.trip.count({
    where: { driverId: auth.employeeId ?? '', tripDate: today(), status: 'COMPLETED' },
  });

  return {
    stats: [
      { key: 'activeTrip', label: 'Active trip', value: trip ? trip.route.name : 'None' },
      { key: 'onBoard', label: 'Students on board',
        value: trip ? trip.studentsBoarded - trip.studentsAlighted : 0, format: 'number' },
      { key: 'stops', label: 'Stops on route', value: trip?.route._count.stops ?? 0, format: 'number' },
      { key: 'completed', label: 'Trips completed today', value: completedToday, format: 'number' },
    ],
    activeTrip: trip,
    updatedAt: new Date().toISOString(),
  };
}

export default router;
