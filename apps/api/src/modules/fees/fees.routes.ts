/**
 * Fees & Accounts (PRD §5.5 + gap: "Payments — GST, receipts, reconciliation").
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok, created, paginated, pageParams } from '../../core/http/respond.js';
import {
  validate,
  idParam,
  uuidSchema,
  dateOnly,
  money,
  listQuery,
  dateRangeQuery, Validated } from '../../core/http/validate.js';
import { requireAuth, requirePermission } from '../../core/auth/middleware.js';
import { scopedRequest, assertStudentAccess, studentScopeWhere } from '../../core/tenancy/scope.js';
import { auditFromRequest } from '../../core/audit/audit.service.js';
import { prisma } from '../../core/db/prisma.js';
import * as service from './fees.service.js';

const router = Router();

// --- Fee heads -------------------------------------------------------------

router.get(
  '/heads',
  requirePermission('fees:view'),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    return ok(
      res,
      await prisma.feeHead.findMany({
        where: { tenantId: auth.tenantId, isActive: true },
        orderBy: { name: 'asc' },
      }),
    );
  }),
);

router.post(
  '/heads',
  requirePermission('fees:create'),
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(80),
      code: z.string().trim().min(1).max(20),
      description: z.string().max(300).optional(),
      category: z
        .enum(['TUITION', 'TRANSPORT', 'LIBRARY', 'EXAM', 'ADMISSION', 'HOSTEL', 'MISC'])
        .default('TUITION'),
      frequency: z
        .enum(['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL'])
        .default('MONTHLY'),
      isRefundable: z.boolean().default(false),
      isTaxable: z.boolean().default(false),
      gstRate: z.coerce.number().min(0).max(28).default(0),
      hsnSacCode: z.string().max(12).optional(),
      ledgerCode: z.string().max(20).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const head = await prisma.feeHead.create({
      data: { tenantId: auth.tenantId, ...(req.body as Validated) },
    });

    await auditFromRequest(req, {
      action: 'CREATE',
      module: 'fees',
      entityType: 'FeeHead',
      entityId: head.id,
      after: head,
    });

    return created(res, head);
  }),
);

// --- Fee structures --------------------------------------------------------

router.get(
  '/structures',
  requirePermission('fees:view'),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    return ok(res, await service.listStructures(auth.tenantId));
  }),
);

router.post(
  '/structures',
  requirePermission('fees:create'),
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().max(300).optional(),
      academicYearId: uuidSchema,
      classId: uuidSchema.optional(),
      items: z
        .array(z.object({ feeHeadId: uuidSchema, amount: money, dueDate: dateOnly.optional() }))
        .min(1),
      installments: z
        .array(
          z.object({
            name: z.string().min(1).max(60),
            sequence: z.coerce.number().int().min(1),
            amount: money,
            dueDate: dateOnly,
            lateFeeAmount: money.default(0),
            lateFeeGraceDays: z.coerce.number().int().min(0).max(90).default(7),
          }),
        )
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const structure = await service.createStructure(
      auth.tenantId,
      req.body as Parameters<typeof service.createStructure>[1],
    );

    await auditFromRequest(req, {
      action: 'CREATE',
      module: 'fees',
      entityType: 'FeeStructure',
      entityId: structure.id,
    });

    return created(res, structure);
  }),
);

// --- Invoices --------------------------------------------------------------

router.get(
  '/invoices',
  requirePermission('fees:view'),
  validate({
    query: listQuery.extend({
      studentId: uuidSchema.optional(),
      status: z.string().optional(),
      classId: uuidSchema.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { auth, tenant } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);
    const q = req.query as { studentId?: string; status?: string; classId?: string; search?: string };

    const where = {
      ...tenant,
      ...studentScopeWhere(auth),
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.classId
        ? { student: { enrollments: { some: { classId: q.classId, isCurrent: true } } } }
        : {}),
      ...(q.search ? { invoiceNo: { contains: q.search, mode: 'insensitive' as const } } : {}),
    };

    const [items, total, totals] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take,
        orderBy: { issueDate: 'desc' },
        select: {
          id: true,
          invoiceNo: true,
          status: true,
          issueDate: true,
          dueDate: true,
          totalAmount: true,
          paidAmount: true,
          balanceAmount: true,
          student: {
            select: { id: true, admissionNo: true, firstName: true, lastName: true },
          },
        },
      }),
      prisma.invoice.count({ where }),
      prisma.invoice.aggregate({
        where,
        _sum: { totalAmount: true, paidAmount: true, balanceAmount: true },
      }),
    ]);

    return paginated(res, items, total, page, limit, {
      billed: totals._sum.totalAmount ?? 0,
      collected: totals._sum.paidAmount ?? 0,
      outstanding: totals._sum.balanceAmount ?? 0,
    });
  }),
);

router.get(
  '/invoices/:id',
  requirePermission('fees:view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    return ok(res, await service.getInvoice(auth, req.params['id']!));
  }),
);

/** Generate invoices in bulk for a class or the whole branch. */
router.post(
  '/invoices/generate',
  requirePermission('fees:create'),
  validate({
    body: z.object({
      feeStructureId: uuidSchema,
      installmentId: uuidSchema.optional(),
      classId: uuidSchema.optional(),
      sectionId: uuidSchema.optional(),
      studentIds: z.array(uuidSchema).optional(),
      issueDate: dateOnly,
      dueDate: dateOnly,
      notes: z.string().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const result = await service.generateInvoices(
      auth,
      req.body as Parameters<typeof service.generateInvoices>[1],
    );

    await auditFromRequest(req, {
      action: 'CREATE',
      module: 'fees',
      entityType: 'Invoice',
      after: { generated: result.generated, skipped: result.skipped },
    });

    return created(res, result);
  }),
);

/** Send due reminders over the notification framework. */
router.post(
  '/invoices/remind',
  requirePermission('fees:update'),
  validate({
    body: z.object({
      invoiceIds: z.array(uuidSchema).optional(),
      onlyOverdue: z.boolean().default(true),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const result = await service.sendReminders(
      auth.tenantId,
      req.body as { invoiceIds?: string[]; onlyOverdue: boolean },
    );
    return ok(res, result);
  }),
);

// --- Payments --------------------------------------------------------------

router.post(
  '/payments',
  requirePermission('fees:create'),
  validate({
    body: z.object({
      invoiceId: uuidSchema,
      amount: money,
      mode: z.enum(['UPI', 'CARD', 'NETBANKING', 'WALLET', 'CASH', 'CHEQUE', 'BANK_TRANSFER']),
      gateway: z.enum(['RAZORPAY', 'STRIPE', 'PAYU', 'OFFLINE']).default('OFFLINE'),
      transactionRef: z.string().max(120).optional(),
      chequeNumber: z.string().max(40).optional(),
      bankName: z.string().max(120).optional(),
      paidAt: z.coerce.date().optional(),
      remarks: z.string().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const payment = await service.recordPayment(
      auth,
      req.body as Parameters<typeof service.recordPayment>[1],
    );

    await auditFromRequest(req, {
      action: 'PAYMENT',
      module: 'fees',
      entityType: 'Payment',
      entityId: payment.id,
      after: { receiptNo: payment.receiptNo, amount: payment.amount },
    });

    return created(res, payment);
  }),
);

router.get(
  '/payments',
  requirePermission('fees:view'),
  validate({ query: listQuery.merge(dateRangeQuery).extend({ studentId: uuidSchema.optional() }) }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);
    const q = req.query as unknown as { from?: Date; to?: Date; studentId?: string };

    const where = {
      tenantId: auth.tenantId,
      ...studentScopeWhere(auth),
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.from || q.to
        ? { paidAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          student: { select: { admissionNo: true, firstName: true, lastName: true } },
          invoice: { select: { invoiceNo: true } },
        },
      }),
      prisma.payment.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }),
);

// --- Concessions -----------------------------------------------------------

router.post(
  '/concessions',
  requirePermission('fees:create'),
  validate({
    body: z
      .object({
        studentId: uuidSchema,
        type: z.enum([
          'SCHOLARSHIP',
          'SIBLING',
          'STAFF_WARD',
          'MERIT',
          'NEED_BASED',
          'RTE',
          'OTHER',
        ]),
        name: z.string().trim().min(1).max(120),
        percentage: z.coerce.number().min(0).max(100).optional(),
        flatAmount: money.optional(),
        feeHeadIds: z.array(uuidSchema).default([]),
        validFrom: dateOnly,
        validTo: dateOnly.optional(),
        reason: z.string().max(500).optional(),
      })
      // Exactly one of percentage / flatAmount, otherwise the discount is ambiguous.
      .refine(
        (d) =>
          (d.percentage !== undefined) !== (d.flatAmount !== undefined),
        { message: 'Provide either a percentage or a flat amount, not both' },
      ),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const concession = await prisma.concession.create({
      data: {
        requestedById: auth.userId,
        ...(req.body as Validated),
      },
    });

    return created(res, concession);
  }),
);

router.post(
  '/concessions/:id/approve',
  requirePermission('fees:approve'),
  validate({
    params: idParam,
    body: z.object({ approve: z.boolean(), reason: z.string().max(500).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { approve, reason } = req.body as { approve: boolean; reason?: string };

    const concession = await prisma.concession.update({
      where: { id: req.params['id']! },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        approvedById: auth.userId,
        approvedAt: new Date(),
        rejectionReason: approve ? null : (reason ?? null),
      },
    });

    await auditFromRequest(req, {
      action: approve ? 'APPROVE' : 'REJECT',
      module: 'fees',
      entityType: 'Concession',
      entityId: concession.id,
    });

    return ok(res, concession);
  }),
);

// --- Refunds ---------------------------------------------------------------

router.post(
  '/refunds',
  requirePermission('fees:create'),
  validate({
    body: z.object({
      paymentId: uuidSchema,
      amount: money,
      reason: z.string().min(1).max(500),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const refund = await service.requestRefund(
      auth,
      req.body as { paymentId: string; amount: number; reason: string },
    );

    await auditFromRequest(req, {
      action: 'REFUND',
      module: 'fees',
      entityType: 'Refund',
      entityId: refund.id,
    });

    return created(res, refund);
  }),
);

// --- Parent-facing summary -------------------------------------------------

router.get(
  '/student/:id/summary',
  requirePermission('fees:view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const studentId = req.params['id']!;

    assertStudentAccess(auth, studentId);
    return ok(res, await service.getStudentFeeSummary(studentId));
  }),
);

// --- Collection reporting --------------------------------------------------

router.get(
  '/collection-report',
  requirePermission('fees:view', 'reports:view'),
  validate({ query: dateRangeQuery }),
  asyncHandler(async (req, res) => {
    const { auth, tenant } = scopedRequest(req);
    const q = req.query as unknown as { from?: Date; to?: Date };
    return ok(res, await service.getCollectionReport(auth.tenantId, tenant, q));
  }),
);

export default router;
