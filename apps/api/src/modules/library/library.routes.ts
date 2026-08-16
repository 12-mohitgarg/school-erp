/** Library: catalogue, copies, issue/return/renew, reservations, fines (PRD §5.7). */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok, created, paginated, pageParams } from '../../core/http/respond.js';
import { validate, uuidSchema, listQuery, Validated } from '../../core/http/validate.js';
import { requireAuth, requirePermission } from '../../core/auth/middleware.js';
import { scopedRequest, resolveWriteBranch, studentScopeWhere } from '../../core/tenancy/scope.js';
import { auditFromRequest } from '../../core/audit/audit.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { prisma } from '../../core/db/prisma.js';
import { DEFAULT_LOAN_DAYS, DEFAULT_FINE_PER_DAY, DEFAULT_MAX_BOOKS_PER_STUDENT } from '@erp/shared';

const router = Router();

// --- Catalogue -------------------------------------------------------------

router.get('/books', requirePermission('library:view'),
  validate({ query: listQuery.extend({ categoryId: uuidSchema.optional(), available: z.coerce.boolean().optional() }) }),
  asyncHandler(async (req, res) => {
    const { tenant } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);
    const q = req.query as { search?: string; categoryId?: string; available?: boolean };

    const where = {
      ...tenant,
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.available ? { availableCopies: { gt: 0 } } : {}),
      ...(q.search ? { OR: [
        { title: { contains: q.search, mode: 'insensitive' as const } },
        { author: { contains: q.search, mode: 'insensitive' as const } },
        { isbn: { contains: q.search } },
      ] } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.book.findMany({ where, skip, take, orderBy: { title: 'asc' },
        include: { category: { select: { id: true, name: true } } } }),
      prisma.book.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }));

router.post('/books', requirePermission('library:create'),
  validate({ body: z.object({
    isbn: z.string().max(20).optional(),
    title: z.string().trim().min(1).max(300),
    subtitle: z.string().max(300).optional(),
    author: z.string().trim().min(1).max(200),
    publisher: z.string().max(160).optional(),
    edition: z.string().max(40).optional(),
    publishYear: z.coerce.number().int().min(1400).max(2100).optional(),
    language: z.string().max(40).default('English'),
    categoryId: uuidSchema.optional(),
    rackLocation: z.string().max(60).optional(),
    price: z.coerce.number().min(0).optional(),
    /** Accession numbers to create as physical copies. */
    copies: z.array(z.string().max(40)).min(1).max(100),
    branchId: uuidSchema.optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;
    const branchId = resolveWriteBranch(auth, body['branchId'] as string | undefined);
    const { branchId: _b, copies, ...fields } = body;
    const accessionNos = copies as string[];

    const book = await prisma.book.create({
      data: {
        tenantId: auth.tenantId, branchId,
        ...(fields as Validated),
        totalCopies: accessionNos.length,
        availableCopies: accessionNos.length,
        copies: { create: accessionNos.map((accessionNo) => ({ accessionNo })) },
      },
      include: { copies: true },
    });

    await auditFromRequest(req, {
      action: 'CREATE', module: 'library', entityType: 'Book', entityId: book.id,
    });

    return created(res, book);
  }));

// --- Circulation -----------------------------------------------------------

router.post('/issue', requirePermission('library:create'),
  validate({ body: z.object({
    // Either a specific physical copy, or just the title — a librarian at the
    // desk cares which book is going out, not which accession number.
    bookCopyId: uuidSchema.optional(),
    bookId: uuidSchema.optional(),
    studentId: uuidSchema.optional(),
    employeeId: uuidSchema.optional(),
    loanDays: z.coerce.number().int().min(1).max(90).optional(),
  })
    .refine((d) => Boolean(d.bookCopyId) !== Boolean(d.bookId), {
      message: 'Provide exactly one of bookCopyId or bookId',
    })
    .refine((d) => Boolean(d.studentId) !== Boolean(d.employeeId), {
      message: 'Provide exactly one of studentId or employeeId',
    }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as {
      bookCopyId?: string; bookId?: string;
      studentId?: string; employeeId?: string; loanDays?: number;
    };

    const copy = body.bookCopyId
      ? await prisma.bookCopy.findFirst({
          where: { id: body.bookCopyId, book: { tenantId: auth.tenantId } },
          select: { id: true, status: true, bookId: true, book: { select: { title: true } } },
        })
      : await prisma.bookCopy.findFirst({
          // Pick any free copy of the requested title, oldest accession first
          // so the collection wears evenly.
          where: { bookId: body.bookId, status: 'AVAILABLE', book: { tenantId: auth.tenantId } },
          orderBy: { accessionNo: 'asc' },
          select: { id: true, status: true, bookId: true, book: { select: { title: true } } },
        });

    if (!copy) {
      throw body.bookId
        ? AppError.conflict('No copies of this title are available right now')
        : AppError.notFound('Book copy');
    }
    if (copy.status !== 'AVAILABLE') throw AppError.conflict(`This copy is currently ${copy.status.toLowerCase()}`);

    // Enforce the per-member borrowing cap.
    if (body.studentId) {
      const openLoans = await prisma.bookLoan.count({
        where: { studentId: body.studentId, status: { in: ['ISSUED', 'OVERDUE'] } },
      });
      if (openLoans >= DEFAULT_MAX_BOOKS_PER_STUDENT) {
        throw AppError.conflict(`A student may hold at most ${DEFAULT_MAX_BOOKS_PER_STUDENT} books at a time`);
      }
    }

    const dueDate = new Date(Date.now() + (body.loanDays ?? DEFAULT_LOAN_DAYS) * 86_400_000);

    const loan = await prisma.$transaction(async (tx) => {
      const created_ = await tx.bookLoan.create({
        data: {
          bookCopyId: copy.id,
          studentId: body.studentId ?? null,
          employeeId: body.employeeId ?? null,
          dueDate,
          status: 'ISSUED',
          issuedById: auth.userId,
        },
      });

      await tx.bookCopy.update({ where: { id: copy.id }, data: { status: 'ISSUED' } });
      await tx.book.update({
        where: { id: copy.bookId },
        data: { availableCopies: { decrement: 1 } },
      });

      return created_;
    });

    await auditFromRequest(req, {
      action: 'CREATE', module: 'library', entityType: 'BookLoan', entityId: loan.id,
      after: { book: copy.book.title, dueDate },
    });

    return created(res, loan);
  }));

router.post('/return/:loanId', requirePermission('library:update'),
  validate({ params: z.object({ loanId: uuidSchema }),
    body: z.object({
      condition: z.enum(['GOOD', 'FAIR', 'POOR', 'DAMAGED', 'LOST']).default('GOOD'),
      waiveFine: z.boolean().default(false),
    }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { condition, waiveFine } = req.body as { condition: string; waiveFine: boolean };

    const loan = await prisma.bookLoan.findFirst({
      where: { id: req.params['loanId']!, bookCopy: { book: { tenantId: auth.tenantId } } },
      select: { id: true, status: true, dueDate: true, bookCopyId: true,
        bookCopy: { select: { bookId: true, price: true } } },
    });
    if (!loan) throw AppError.notFound('Loan');
    if (loan.status === 'RETURNED') throw AppError.conflict('This loan is already closed');

    const now = new Date();
    const overdueDays = Math.max(0, Math.floor((now.getTime() - loan.dueDate.getTime()) / 86_400_000));
    const fine = waiveFine ? 0 : overdueDays * DEFAULT_FINE_PER_DAY;
    const isLost = condition === 'LOST';

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.bookLoan.update({
        where: { id: loan.id },
        data: {
          status: isLost ? 'LOST' : 'RETURNED',
          returnedAt: now,
          fineAmount: fine,
          replacementCharge: isLost ? loan.bookCopy.price : null,
          receivedById: auth.userId,
        },
      });

      await tx.bookCopy.update({
        where: { id: loan.bookCopyId },
        data: { status: isLost ? 'LOST' : condition === 'DAMAGED' ? 'DAMAGED' : 'AVAILABLE', condition },
      });

      // A lost or damaged copy does not return to the available pool.
      if (!isLost && condition !== 'DAMAGED') {
        await tx.book.update({
          where: { id: loan.bookCopy.bookId },
          data: { availableCopies: { increment: 1 } },
        });
      } else {
        await tx.book.update({
          where: { id: loan.bookCopy.bookId },
          data: { totalCopies: { decrement: 1 } },
        });
      }

      return result;
    });

    return ok(res, { ...updated, overdueDays, fine });
  }));

router.post('/renew/:loanId', requirePermission('library:update'),
  validate({ params: z.object({ loanId: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);

    const loan = await prisma.bookLoan.findFirst({
      where: { id: req.params['loanId']!, bookCopy: { book: { tenantId: auth.tenantId } } },
      select: { id: true, status: true, renewalCount: true, dueDate: true, bookCopy: { select: { bookId: true } } },
    });
    if (!loan) throw AppError.notFound('Loan');
    if (loan.status === 'RETURNED') throw AppError.conflict('This loan is closed');
    if (loan.renewalCount >= 2) throw AppError.conflict('This loan has reached its renewal limit');

    // A reserved title cannot be renewed — the queue takes priority.
    const reserved = await prisma.bookReservation.count({
      where: { bookId: loan.bookCopy.bookId, status: 'ACTIVE' },
    });
    if (reserved > 0) throw AppError.conflict('Another member has reserved this title');

    return ok(res, await prisma.bookLoan.update({
      where: { id: loan.id },
      data: {
        dueDate: new Date(Date.now() + DEFAULT_LOAN_DAYS * 86_400_000),
        renewalCount: { increment: 1 },
        status: 'ISSUED',
      },
    }));
  }));

router.get('/loans', requirePermission('library:view'),
  validate({ query: listQuery.extend({ status: z.string().optional(), studentId: uuidSchema.optional() }) }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);

    const where = {
      bookCopy: { book: { tenantId: auth.tenantId } },
      ...studentScopeWhere(auth),
      ...(req.query['studentId'] ? { studentId: req.query['studentId'] as string } : {}),
      ...(req.query['status'] ? { status: req.query['status'] as never } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.bookLoan.findMany({
        where, skip, take, orderBy: { issuedAt: 'desc' },
        include: {
          bookCopy: { select: { accessionNo: true, book: { select: { title: true, author: true } } } },
          student: { select: { admissionNo: true, firstName: true, lastName: true } },
          employee: { select: { employeeCode: true, firstName: true, lastName: true } },
        },
      }),
      prisma.bookLoan.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }));

router.get('/categories', requirePermission('library:view'), asyncHandler(async (req, res) => {
  const { auth } = scopedRequest(req);
  return ok(res, await prisma.bookCategory.findMany({
    where: { tenantId: auth.tenantId }, orderBy: { name: 'asc' },
  }));
}));

router.post('/categories', requirePermission('library:create'),
  validate({ body: z.object({
    name: z.string().trim().min(1).max(80),
    code: z.string().trim().min(1).max(20),
    classificationCode: z.string().max(20).optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    return created(res, await prisma.bookCategory.create({
      data: { tenantId: auth.tenantId, ...(req.body as Validated) },
    }));
  }));

export default router;
