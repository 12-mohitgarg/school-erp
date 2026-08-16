/** HR & Payroll: employees, leave, payroll runs, payslips, appraisal (PRD §5.9). */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok, created, paginated, pageParams } from '../../core/http/respond.js';
import { validate, idParam, uuidSchema, dateOnly, emailSchema, phoneSchema, money, listQuery, Validated } from '../../core/http/validate.js';
import { requireAuth, requirePermission } from '../../core/auth/middleware.js';
import { scopedRequest, resolveWriteBranch } from '../../core/tenancy/scope.js';
import { auditFromRequest } from '../../core/audit/audit.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { prisma } from '../../core/db/prisma.js';
import { notify } from '../../core/notifications/notification.service.js';

const router = Router();

// --- Departments & designations -------------------------------------------

router.get('/departments', requirePermission('hr:view'), asyncHandler(async (req, res) => {
  const { auth } = scopedRequest(req);
  return ok(res, await prisma.department.findMany({
    where: { tenantId: auth.tenantId, isActive: true },
    orderBy: { name: 'asc' },
    include: { _count: { select: { employees: true } } },
  }));
}));

router.post('/departments', requirePermission('hr:create'),
  validate({ body: z.object({ name: z.string().trim().min(1).max(80), code: z.string().trim().min(1).max(20) }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    return created(res, await prisma.department.create({
      data: { tenantId: auth.tenantId, ...(req.body as Validated) },
    }));
  }));

router.get('/designations', requirePermission('hr:view'), asyncHandler(async (req, res) => {
  const { auth } = scopedRequest(req);
  return ok(res, await prisma.designation.findMany({
    where: { tenantId: auth.tenantId, isActive: true },
    orderBy: { level: 'desc' },
  }));
}));

router.post('/designations', requirePermission('hr:create'),
  validate({ body: z.object({
    name: z.string().trim().min(1).max(80),
    code: z.string().trim().min(1).max(20),
    level: z.coerce.number().int().min(1).max(20).default(1),
    isTeaching: z.boolean().default(true),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    return created(res, await prisma.designation.create({
      data: { tenantId: auth.tenantId, ...(req.body as Validated) },
    }));
  }));

// --- Employees -------------------------------------------------------------

router.get('/employees', requirePermission('hr:view'),
  validate({ query: listQuery.extend({ departmentId: uuidSchema.optional(), status: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const { tenant } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);
    const q = req.query as { search?: string; departmentId?: string; status?: string };

    const where = {
      ...tenant,
      deletedAt: null,
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.search ? { OR: [
        { firstName: { contains: q.search, mode: 'insensitive' as const } },
        { lastName: { contains: q.search, mode: 'insensitive' as const } },
        { employeeCode: { contains: q.search, mode: 'insensitive' as const } },
      ] } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.employee.findMany({
        where, skip, take,
        orderBy: { firstName: 'asc' },
        select: {
          id: true, employeeCode: true, firstName: true, lastName: true, photoUrl: true,
          email: true, phone: true, status: true, employmentType: true, joiningDate: true,
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, name: true, isTeaching: true } },
        },
      }),
      prisma.employee.count({ where }),
    ]);

    return paginated(res, items.map((e) => ({ ...e, fullName: `${e.firstName} ${e.lastName}` })), total, page, limit);
  }));

router.get('/employees/:id', requirePermission('hr:view'), validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const employee = await prisma.employee.findFirst({
      where: { id: req.params['id']!, tenantId: auth.tenantId, deletedAt: null },
      include: {
        department: true, designation: true, branch: { select: { name: true } },
        documents: true,
        leaveBalances: { include: { leaveType: { select: { name: true, code: true } } } },
        salaryStructures: { where: { isActive: true }, take: 1 },
        reportsTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!employee) throw AppError.notFound('Employee');
    return ok(res, { ...employee, fullName: `${employee.firstName} ${employee.lastName}` });
  }));

router.post('/employees', requirePermission('hr:create'),
  validate({ body: z.object({
    employeeCode: z.string().trim().min(1).max(40).optional(),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    dateOfBirth: dateOnly.optional(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED']),
    email: emailSchema.optional(),
    phone: phoneSchema,
    departmentId: uuidSchema.optional(),
    designationId: uuidSchema.optional(),
    reportsToId: uuidSchema.optional(),
    employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'VISITING', 'INTERN']).default('FULL_TIME'),
    joiningDate: dateOnly,
    qualification: z.string().max(200).optional(),
    experienceYears: z.coerce.number().int().min(0).max(60).optional(),
    subjectExpertise: z.array(uuidSchema).default([]),
    branchId: uuidSchema.optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;
    const branchId = resolveWriteBranch(auth, body['branchId'] as string | undefined);
    const { branchId: _b, employeeCode, ...fields } = body;

    const count = await prisma.employee.count({ where: { tenantId: auth.tenantId } });
    const code = (employeeCode as string) ?? `EMP${String(count + 1).padStart(5, '0')}`;

    const employee = await prisma.employee.create({
      data: { tenantId: auth.tenantId, branchId, employeeCode: code, ...(fields as Validated) },
    });

    await auditFromRequest(req, {
      action: 'CREATE', module: 'hr', entityType: 'Employee', entityId: employee.id,
      after: { employeeCode: code, name: `${employee.firstName} ${employee.lastName}` },
    });

    return created(res, employee);
  }));

// --- Leave -----------------------------------------------------------------

router.get('/leave-types', requirePermission('hr:view'), asyncHandler(async (req, res) => {
  const { auth } = scopedRequest(req);
  return ok(res, await prisma.leaveType.findMany({ where: { tenantId: auth.tenantId, isActive: true } }));
}));

router.post('/leave-types', requirePermission('hr:create'),
  validate({ body: z.object({
    name: z.string().trim().min(1).max(60),
    code: z.string().trim().min(1).max(20),
    annualQuota: z.coerce.number().int().min(0).max(365).default(12),
    isPaid: z.boolean().default(true),
    carryForward: z.boolean().default(false),
    maxCarryForward: z.coerce.number().int().min(0).max(365).default(0),
    requiresDocument: z.boolean().default(false),
    minNoticeDays: z.coerce.number().int().min(0).max(90).default(1),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    return created(res, await prisma.leaveType.create({
      data: { tenantId: auth.tenantId, ...(req.body as Validated) },
    }));
  }));

router.get('/leave-requests', requirePermission('hr:view'),
  validate({ query: listQuery.extend({ status: z.string().optional(), employeeId: uuidSchema.optional() }) }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);

    const where = {
      employee: { tenantId: auth.tenantId },
      // Staff without HR permissions see only their own requests.
      ...(auth.role !== 'HR' && auth.role !== 'ADMIN' && auth.role !== 'SUPER_ADMIN' && auth.employeeId
        ? { employeeId: auth.employeeId }
        : req.query['employeeId'] ? { employeeId: req.query['employeeId'] as string } : {}),
      ...(req.query['status'] ? { status: req.query['status'] as never } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.leaveRequest.findMany({
        where, skip, take,
        orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { employeeCode: true, firstName: true, lastName: true } },
          leaveType: { select: { name: true, code: true, colorHex: true } },
        },
      }),
      prisma.leaveRequest.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }));

router.post('/leave-requests', requirePermission('hr:create'),
  validate({ body: z.object({
    leaveTypeId: uuidSchema,
    fromDate: dateOnly,
    toDate: dateOnly,
    isHalfDay: z.boolean().default(false),
    reason: z.string().min(1).max(1000),
    documentUrl: z.string().url().optional(),
    contactDuringLeave: z.string().max(60).optional(),
    employeeId: uuidSchema.optional(),
  }).refine((d) => d.toDate >= d.fromDate, { message: 'End date cannot precede the start date', path: ['toDate'] }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;
    const employeeId = (body['employeeId'] as string) ?? auth.employeeId;
    if (!employeeId) throw AppError.badRequest('No employee record is linked to this account');

    const from = body['fromDate'] as Date;
    const to = body['toDate'] as Date;
    const days = body['isHalfDay']
      ? 0.5
      : Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;

    // Reject a request that overlaps an existing approved or pending one.
    const clash = await prisma.leaveRequest.findFirst({
      where: {
        employeeId,
        status: { in: ['PENDING', 'APPROVED'] },
        fromDate: { lte: to },
        toDate: { gte: from },
      },
      select: { id: true },
    });
    if (clash) throw AppError.conflict('You already have leave requested for these dates');

    const { employeeId: _e, ...fields } = body;
    const request = await prisma.leaveRequest.create({
      data: { employeeId, totalDays: days, ...(fields as Validated) },
    });

    return created(res, request);
  }));

router.post('/leave-requests/:id/decide', requirePermission('hr:approve'),
  validate({ params: idParam, body: z.object({ approve: z.boolean(), reason: z.string().max(500).optional() }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { approve, reason } = req.body as { approve: boolean; reason?: string };

    const request = await prisma.leaveRequest.findFirst({
      where: { id: req.params['id']!, employee: { tenantId: auth.tenantId } },
      select: { id: true, status: true, employeeId: true, totalDays: true, leaveTypeId: true,
        employee: { select: { userId: true } } },
    });
    if (!request) throw AppError.notFound('Leave request');
    if (request.status !== 'PENDING') throw AppError.conflict('This request has already been decided');

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.leaveRequest.update({
        where: { id: request.id },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          approverId: auth.employeeId ?? null,
          approvedAt: new Date(),
          rejectionReason: approve ? null : (reason ?? null),
        },
      });

      // Draw down the balance only on approval.
      if (approve) {
        await tx.leaveBalance.updateMany({
          where: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year: new Date().getFullYear() },
          data: { used: { increment: request.totalDays }, balance: { decrement: request.totalDays } },
        });
      }

      return result;
    });

    if (request.employee.userId) {
      void notify({
        tenantId: auth.tenantId,
        userIds: [request.employee.userId],
        title: approve ? 'Leave approved' : 'Leave rejected',
        body: approve ? 'Your leave request has been approved.' : `Your leave request was rejected. ${reason ?? ''}`,
        channels: ['IN_APP', 'PUSH'],
        priority: 'HIGH',
        module: 'hr',
      }).catch(() => undefined);
    }

    await auditFromRequest(req, {
      action: approve ? 'APPROVE' : 'REJECT', module: 'hr',
      entityType: 'LeaveRequest', entityId: request.id,
    });

    return ok(res, updated);
  }));

// --- Payroll ---------------------------------------------------------------

router.post('/salary-structures', requirePermission('hr:create'),
  validate({ body: z.object({
    employeeId: uuidSchema,
    effectiveFrom: dateOnly,
    basicSalary: money,
    components: z.array(z.object({
      code: z.string().max(20), name: z.string().max(60),
      type: z.enum(['EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION']), amount: money,
    })).default([]),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as { employeeId: string; effectiveFrom: Date; basicSalary: number;
      components: Array<{ type: string; amount: number }> };

    /*
      The employee id comes from the request body, so it must be proved to
      belong to the caller's school before anything is written against it.
      Without this, a token from one school could supersede and rewrite the
      salary structure of another school's staff — payroll data, cross-tenant.
    */
    const employee = await prisma.employee.findFirst({
      where: { id: body.employeeId, tenantId: auth.tenantId },
      select: { id: true },
    });
    if (!employee) throw AppError.notFound('Employee');

    const earnings = body.components.filter((c) => c.type === 'EARNING').reduce((s, c) => s + c.amount, 0);
    const gross = body.basicSalary + earnings;

    // Supersede the previous structure rather than leaving two active.
    await prisma.salaryStructure.updateMany({
      where: { employeeId: body.employeeId, isActive: true },
      data: { isActive: false, effectiveTo: body.effectiveFrom },
    });

    const structure = await prisma.salaryStructure.create({
      data: {
        employeeId: body.employeeId,
        effectiveFrom: body.effectiveFrom,
        basicSalary: body.basicSalary,
        grossSalary: gross,
        ctcAnnual: gross * 12,
        components: body.components as never,
      },
    });

    await auditFromRequest(req, {
      action: 'CREATE', module: 'hr', entityType: 'SalaryStructure', entityId: structure.id,
    });

    return created(res, structure);
  }));

router.post('/payroll/run', requirePermission('hr:approve'),
  validate({ body: z.object({
    month: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(2020).max(2100),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { month, year } = req.body as { month: number; year: number };

    const service = await import('./payroll.service.js');
    const result = await service.runPayroll(auth, month, year);

    await auditFromRequest(req, {
      action: 'CREATE', module: 'hr', entityType: 'PayrollRun', entityId: result.payrollRunId,
      after: { month, year, employees: result.employeeCount, net: result.totalNet },
    });

    return created(res, result);
  }));

router.get('/payslips', requirePermission('hr:view'),
  validate({ query: listQuery.extend({ employeeId: uuidSchema.optional(), year: z.coerce.number().optional() }) }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);

    const where = {
      employee: { tenantId: auth.tenantId },
      ...(req.query['employeeId'] ? { employeeId: req.query['employeeId'] as string }
        : auth.role !== 'HR' && auth.role !== 'ADMIN' && auth.employeeId ? { employeeId: auth.employeeId } : {}),
      ...(req.query['year'] ? { year: Number(req.query['year']) } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.payslip.findMany({
        where, skip, take,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } } },
      }),
      prisma.payslip.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }));

export default router;
