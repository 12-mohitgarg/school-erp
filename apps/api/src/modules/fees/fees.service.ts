/** Fee billing, payment capture, GST computation and collection reporting. */

import { Prisma } from '@prisma/client';
import { documentNumber } from '@erp/shared';
import type { RequestAuth } from '../../types/express.js';
import { prisma } from '../../core/db/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { notify, guardianUserIds } from '../../core/notifications/notification.service.js';
import { sendSms, isSmsConfigured } from '../../core/notifications/channels/sms.channel.js';
import { sendEmail } from '../../core/notifications/channels/email.channel.js';
import { paymentsProcessed } from '../../core/observability/metrics.js';
import { assertStudentAccess } from '../../core/tenancy/scope.js';
import { moduleLogger } from '../../core/logger.js';

const log = moduleLogger('fees');

const dec = (value: number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(value);
const toNumber = (value: Prisma.Decimal | null): number => (value ? value.toNumber() : 0);

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

export async function listStructures(tenantId: string) {
  return prisma.feeStructure.findMany({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: 'desc' },
    include: {
      academicYear: { select: { id: true, name: true } },
      class: { select: { id: true, name: true } },
      items: { include: { feeHead: { select: { id: true, name: true, code: true, gstRate: true } } } },
      installments: { orderBy: { sequence: 'asc' } },
    },
  });
}

export async function createStructure(
  tenantId: string,
  input: {
    name: string;
    description?: string | undefined;
    academicYearId: string;
    classId?: string | undefined;
    items: Array<{ feeHeadId: string; amount: number; dueDate?: Date | undefined }>;
    installments?: Array<{
      name: string;
      sequence: number;
      amount: number;
      dueDate: Date;
      lateFeeAmount: number;
      lateFeeGraceDays: number;
    }> | undefined;
  },
) {
  const totalAmount = input.items.reduce((sum, i) => sum + i.amount, 0);

  // Installments must reconcile with the structure total, or a student would
  // never be fully billed.
  if (input.installments?.length) {
    const installmentTotal = input.installments.reduce((sum, i) => sum + i.amount, 0);
    if (Math.abs(installmentTotal - totalAmount) > 0.01) {
      throw AppError.badRequest(
        `Installments total ${installmentTotal} but the fee items total ${totalAmount}`,
      );
    }
  }

  return prisma.feeStructure.create({
    data: {
      tenantId,
      name: input.name,
      description: input.description ?? null,
      academicYearId: input.academicYearId,
      classId: input.classId ?? null,
      totalAmount: dec(totalAmount),
      items: {
        create: input.items.map((i) => ({
          feeHeadId: i.feeHeadId,
          amount: dec(i.amount),
          dueDate: i.dueDate ?? null,
        })),
      },
      installments: input.installments
        ? {
            create: input.installments.map((i) => ({
              name: i.name,
              sequence: i.sequence,
              amount: dec(i.amount),
              dueDate: i.dueDate,
              lateFeeAmount: dec(i.lateFeeAmount),
              lateFeeGraceDays: i.lateFeeGraceDays,
            })),
          }
        : undefined,
    },
    include: { items: true, installments: true },
  });
}

// ---------------------------------------------------------------------------
// Invoicing
// ---------------------------------------------------------------------------

/**
 * Compute the GST split for a line.
 *
 * Intra-state supply splits into CGST + SGST; inter-state uses IGST. Most
 * school fees are exempt (rate 0), but transport and merchandise are not.
 */
function splitGst(
  taxable: number,
  rate: number,
  isInterState: boolean,
): { cgst: number; sgst: number; igst: number; total: number } {
  const total = Number(((taxable * rate) / 100).toFixed(2));
  if (rate === 0) return { cgst: 0, sgst: 0, igst: 0, total: 0 };

  if (isInterState) return { cgst: 0, sgst: 0, igst: total, total };

  const half = Number((total / 2).toFixed(2));
  return { cgst: half, sgst: total - half, igst: 0, total };
}

/** Concessions applicable to a student on a given date, per fee head. */
async function activeConcessions(studentId: string, on: Date) {
  return prisma.concession.findMany({
    where: {
      studentId,
      status: 'APPROVED',
      validFrom: { lte: on },
      OR: [{ validTo: null }, { validTo: { gte: on } }],
    },
    select: { percentage: true, flatAmount: true, feeHeadIds: true },
  });
}

function discountFor(
  feeHeadId: string,
  amount: number,
  concessions: Array<{ percentage: Prisma.Decimal | null; flatAmount: Prisma.Decimal | null; feeHeadIds: string[] }>,
): number {
  let discount = 0;

  for (const c of concessions) {
    // An empty feeHeadIds list means the concession applies to every head.
    const applies = c.feeHeadIds.length === 0 || c.feeHeadIds.includes(feeHeadId);
    if (!applies) continue;

    if (c.percentage) discount += (amount * c.percentage.toNumber()) / 100;
    else if (c.flatAmount) discount += c.flatAmount.toNumber();
  }

  // Never discount below zero.
  return Math.min(discount, amount);
}

export async function generateInvoices(
  auth: RequestAuth,
  input: {
    feeStructureId: string;
    installmentId?: string | undefined;
    classId?: string | undefined;
    sectionId?: string | undefined;
    studentIds?: string[] | undefined;
    issueDate: Date;
    dueDate: Date;
    notes?: string | undefined;
  },
): Promise<{ generated: number; skipped: number; totalBilled: number }> {
  const structure = await prisma.feeStructure.findFirst({
    where: { id: input.feeStructureId, tenantId: auth.tenantId },
    include: { items: { include: { feeHead: true } }, academicYear: { select: { id: true, name: true } } },
  });

  if (!structure) throw AppError.notFound('Fee structure');
  if (structure.items.length === 0) throw AppError.badRequest('That fee structure has no items');

  const students = await prisma.student.findMany({
    where: {
      tenantId: auth.tenantId,
      ...(auth.branchId ? { branchId: auth.branchId } : {}),
      status: 'ACTIVE',
      deletedAt: null,
      ...(input.studentIds ? { id: { in: input.studentIds } } : {}),
      ...(input.classId || input.sectionId
        ? {
            enrollments: {
              some: {
                isCurrent: true,
                ...(input.classId ? { classId: input.classId } : {}),
                ...(input.sectionId ? { sectionId: input.sectionId } : {}),
              },
            },
          }
        : {}),
    },
    select: { id: true, branchId: true, state: true },
  });

  if (students.length === 0) throw AppError.badRequest('No matching active students found');

  // One counter read, then increment locally — far fewer round trips than
  // querying the max invoice number per student.
  let sequence = await prisma.invoice.count({ where: { tenantId: auth.tenantId } });

  let generated = 0;
  let skipped = 0;
  let totalBilled = 0;

  for (const student of students) {
    // Idempotency: never bill the same installment twice.
    if (input.installmentId) {
      const duplicate = await prisma.invoice.findFirst({
        where: {
          studentId: student.id,
          installmentId: input.installmentId,
          status: { not: 'CANCELLED' },
        },
        select: { id: true },
      });
      if (duplicate) {
        skipped++;
        continue;
      }
    }

    const concessions = await activeConcessions(student.id, input.issueDate);
    const isInterState = false;

    let subtotal = 0;
    let discountTotal = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    const lines = structure.items.map((item) => {
      const amount = item.amount.toNumber();
      const discount = discountFor(item.feeHeadId, amount, concessions);
      const taxable = amount - discount;
      const rate = item.feeHead.isTaxable ? item.feeHead.gstRate.toNumber() : 0;
      const gst = splitGst(taxable, rate, isInterState);

      subtotal += amount;
      discountTotal += discount;
      cgst += gst.cgst;
      sgst += gst.sgst;
      igst += gst.igst;

      return {
        feeHeadId: item.feeHeadId,
        description: item.feeHead.name,
        quantity: 1,
        unitAmount: dec(amount),
        discountAmount: dec(discount),
        gstRate: dec(rate),
        taxAmount: dec(gst.total),
        lineTotal: dec(taxable + gst.total),
        hsnSacCode: item.feeHead.hsnSacCode,
      };
    });

    const taxAmount = Number((cgst + sgst + igst).toFixed(2));
    const total = Number((subtotal - discountTotal + taxAmount).toFixed(2));

    sequence++;

    await prisma.invoice.create({
      data: {
        tenantId: auth.tenantId,
        branchId: student.branchId,
        studentId: student.id,
        academicYearId: structure.academicYearId,
        installmentId: input.installmentId ?? null,
        invoiceNo: documentNumber('INV', structure.academicYear.name, sequence),
        status: 'ISSUED',
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        subtotal: dec(subtotal),
        discountAmount: dec(discountTotal),
        taxAmount: dec(taxAmount),
        totalAmount: dec(total),
        paidAmount: dec(0),
        balanceAmount: dec(total),
        cgstAmount: dec(cgst),
        sgstAmount: dec(sgst),
        igstAmount: dec(igst),
        placeOfSupply: student.state ?? null,
        notes: input.notes ?? null,
        createdById: auth.userId,
        lines: { create: lines },
      },
    });

    generated++;
    totalBilled += total;
  }

  log.info({ tenantId: auth.tenantId, generated, skipped }, 'Invoices generated');
  return { generated, skipped, totalBilled: Number(totalBilled.toFixed(2)) };
}

export async function getInvoice(auth: RequestAuth, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId: auth.tenantId },
    include: {
      lines: { include: { feeHead: { select: { name: true, code: true } } } },
      payments: { orderBy: { createdAt: 'desc' } },
      student: {
        select: {
          id: true,
          admissionNo: true,
          firstName: true,
          lastName: true,
          enrollments: {
            where: { isCurrent: true },
            take: 1,
            select: { class: { select: { name: true } }, section: { select: { name: true } } },
          },
        },
      },
      academicYear: { select: { name: true } },
    },
  });

  if (!invoice) throw AppError.notFound('Invoice');
  assertStudentAccess(auth, invoice.studentId);

  return invoice;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * Record a payment against an invoice and roll the invoice's status forward.
 * Runs in a transaction so the invoice balance can never drift from the sum of
 * its payments.
 */
export async function recordPayment(
  auth: RequestAuth,
  input: {
    invoiceId: string;
    amount: number;
    mode: string;
    gateway: string;
    transactionRef?: string | undefined;
    chequeNumber?: string | undefined;
    bankName?: string | undefined;
    paidAt?: Date | undefined;
    remarks?: string | undefined;
  },
) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: input.invoiceId, tenantId: auth.tenantId },
      select: {
        id: true,
        studentId: true,
        invoiceNo: true,
        status: true,
        totalAmount: true,
        paidAmount: true,
      },
    });

    if (!invoice) throw AppError.notFound('Invoice');
    if (invoice.status === 'CANCELLED') throw AppError.conflict('That invoice has been cancelled');

    const alreadyPaid = invoice.paidAmount.toNumber();
    const total = invoice.totalAmount.toNumber();
    const balance = Number((total - alreadyPaid).toFixed(2));

    if (input.amount > balance + 0.01) {
      throw AppError.badRequest(
        `Payment of ${input.amount} exceeds the outstanding balance of ${balance}`,
      );
    }

    const sequence = await tx.payment.count({ where: { tenantId: auth.tenantId } });
    const newPaid = Number((alreadyPaid + input.amount).toFixed(2));
    const newBalance = Number((total - newPaid).toFixed(2));

    const payment = await tx.payment.create({
      data: {
        tenantId: auth.tenantId,
        invoiceId: invoice.id,
        studentId: invoice.studentId,
        receiptNo: `RCP-${new Date().getFullYear()}-${String(sequence + 1).padStart(6, '0')}`,
        amount: dec(input.amount),
        mode: input.mode as never,
        gateway: input.gateway as never,
        // Offline instruments are settled the moment they are recorded.
        status: 'SUCCESS',
        transactionRef: input.transactionRef ?? null,
        chequeNumber: input.chequeNumber ?? null,
        bankName: input.bankName ?? null,
        paidAt: input.paidAt ?? new Date(),
        collectedById: auth.userId,
        remarks: input.remarks ?? null,
      },
    });

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount: dec(newPaid),
        balanceAmount: dec(newBalance),
        status: newBalance <= 0.01 ? 'PAID' : 'PARTIALLY_PAID',
      },
    });

    // Double-entry: debit cash/bank, credit fee income.
    await tx.ledgerEntry.createMany({
      data: [
        {
          tenantId: auth.tenantId,
          entryDate: input.paidAt ?? new Date(),
          accountCode: input.mode === 'CASH' ? '1001' : '1002',
          accountName: input.mode === 'CASH' ? 'Cash in hand' : 'Bank account',
          sourceType: 'PAYMENT',
          sourceId: payment.id,
          debit: dec(input.amount),
          credit: dec(0),
          narration: `Receipt ${payment.receiptNo} against ${invoice.invoiceNo}`,
        },
        {
          tenantId: auth.tenantId,
          entryDate: input.paidAt ?? new Date(),
          accountCode: '4001',
          accountName: 'Fee income',
          sourceType: 'PAYMENT',
          sourceId: payment.id,
          debit: dec(0),
          credit: dec(input.amount),
          narration: `Receipt ${payment.receiptNo}`,
        },
      ],
    });

    paymentsProcessed.inc({ gateway: input.gateway, status: 'success' });

    // Receipt confirmation to the family.
    const recipients = await guardianUserIds([invoice.studentId]);
    if (recipients.length > 0) {
      void notify({
        tenantId: auth.tenantId,
        userIds: recipients,
        title: 'Payment received',
        body: `We have received ₹${input.amount.toLocaleString('en-IN')} against invoice ${invoice.invoiceNo}. Receipt no: ${payment.receiptNo}.`,
        channels: ['IN_APP', 'PUSH', 'SMS'],
        priority: 'NORMAL',
        module: 'fees',
        actionUrl: `/parent/fees/invoice/${invoice.id}`,
      }).catch((err: unknown) => log.error({ err }, 'Receipt notification failed'));
    }

    return { ...payment, amount: payment.amount.toNumber() };
  });
}

export async function requestRefund(
  auth: RequestAuth,
  input: { paymentId: string; amount: number; reason: string },
) {
  const payment = await prisma.payment.findFirst({
    where: { id: input.paymentId, tenantId: auth.tenantId },
    select: { id: true, amount: true, invoiceId: true, status: true },
  });

  if (!payment) throw AppError.notFound('Payment');
  if (payment.status !== 'SUCCESS') throw AppError.conflict('Only settled payments can be refunded');

  const alreadyRefunded = await prisma.refund.aggregate({
    where: { paymentId: payment.id, status: { in: ['PENDING', 'APPROVED'] } },
    _sum: { amount: true },
  });

  const refundable = payment.amount.toNumber() - toNumber(alreadyRefunded._sum.amount);
  if (input.amount > refundable + 0.01) {
    throw AppError.badRequest(`Only ${refundable} remains refundable on this payment`);
  }

  const sequence = await prisma.refund.count();

  return prisma.refund.create({
    data: {
      paymentId: payment.id,
      invoiceId: payment.invoiceId,
      refundNo: `REF-${new Date().getFullYear()}-${String(sequence + 1).padStart(5, '0')}`,
      amount: dec(input.amount),
      reason: input.reason,
      status: 'PENDING',
      requestedById: auth.userId,
    },
  });
}

// ---------------------------------------------------------------------------
// Reminders & reporting
// ---------------------------------------------------------------------------

/**
 * Send due/overdue reminders.
 *
 * Fault-isolated per invoice: one family's notification failing (a bad phone
 * number, a provider hiccup) must not abort the run and leave the rest
 * un-reminded but partially marked. Failures are counted and returned so the
 * caller can surface them rather than seeing a bare 500.
 */
export async function sendReminders(
  tenantId: string,
  input: { invoiceIds?: string[] | undefined; onlyOverdue: boolean },
): Promise<{
  sent: number;
  skipped: number;
  failed: number;
  /** Of `sent`, how many went by direct SMS to a guardian with no app account. */
  bySms: number;
  /** False when no SMS provider is configured, so direct sends were logged only. */
  smsConfigured: boolean;
}> {
  const invoices = await prisma.invoice.findMany({
    where: {
      tenantId,
      ...(input.invoiceIds ? { id: { in: input.invoiceIds } } : {}),
      status: input.onlyOverdue ? 'OVERDUE' : { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
      // Do not re-badger a parent reminded within the last day.
      OR: [
        { lastReminderAt: null },
        { lastReminderAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      ],
    },
    select: {
      id: true,
      invoiceNo: true,
      studentId: true,
      balanceAmount: true,
      dueDate: true,
    },
    take: 500,
  });

  const smsConfigured = isSmsConfigured();

  if (invoices.length === 0) {
    return { sent: 0, skipped: 0, failed: 0, bySms: 0, smsConfigured };
  }

  // Resolve every guardian in one query rather than one per invoice — the
  // previous per-invoice lookup was an N+1 that made a 500-invoice run take
  // minutes against a remote database.
  const links = await prisma.studentGuardian.findMany({
    where: { studentId: { in: invoices.map((i) => i.studentId) } },
    select: {
      studentId: true,
      guardian: { select: { userId: true, phone: true, email: true, firstName: true } },
    },
  });

  interface Contact {
    userIds: string[];
    /** Guardians with no app account — reachable only by SMS/email. */
    offApp: Array<{ phone: string; email: string | null; firstName: string }>;
  }

  const contactsByStudent = new Map<string, Contact>();
  for (const link of links) {
    const entry = contactsByStudent.get(link.studentId) ?? { userIds: [], offApp: [] };

    if (link.guardian.userId) {
      entry.userIds.push(link.guardian.userId);
    } else if (link.guardian.phone) {
      entry.offApp.push({
        phone: link.guardian.phone,
        email: link.guardian.email,
        firstName: link.guardian.firstName,
      });
    }

    contactsByStudent.set(link.studentId, entry);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let bySms = 0;

  for (const invoice of invoices) {
    const contact = contactsByStudent.get(invoice.studentId);
    const balance = invoice.balanceAmount.toNumber().toLocaleString('en-IN');
    const due = invoice.dueDate.toLocaleDateString('en-IN');
    const message = `Fee reminder: invoice ${invoice.invoiceNo} has an outstanding balance of Rs ${balance}, due ${due}.`;

    // Nobody reachable at all — neither an account nor a phone number.
    if (!contact || (contact.userIds.length === 0 && contact.offApp.length === 0)) {
      skipped++;
      continue;
    }

    try {
      if (contact.userIds.length > 0) {
        await notify({
          tenantId,
          userIds: contact.userIds,
          title: 'Fee payment due',
          body: `Invoice ${invoice.invoiceNo} has an outstanding balance of ₹${balance}, due ${due}.`,
          channels: ['IN_APP', 'PUSH', 'SMS'],
          priority: 'HIGH',
          module: 'fees',
          actionUrl: `/parent/fees/invoice/${invoice.id}`,
        });
      }

      // Guardians who never installed the app still need the reminder. This is
      // the normal case for a school, not an edge case — most parents are
      // reached by SMS long before they adopt an app.
      for (const guardian of contact.offApp) {
        await sendSms(guardian.phone, message);
        bySms++;

        if (guardian.email) {
          await sendEmail({
            to: guardian.email,
            subject: `Fee payment due — invoice ${invoice.invoiceNo}`,
            html: `<p>Dear ${guardian.firstName},</p><p>${message}</p><p>You can pay online through the Parent App, or at the school office.</p>`,
          }).catch(() => undefined);
        }
      }

      // Only stamp the invoice once the reminder actually went out, so a
      // failed send is retried on the next run rather than silently suppressed.
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { lastReminderAt: new Date(), reminderCount: { increment: 1 } },
      });

      sent++;
    } catch (err) {
      failed++;
      log.error({ err, invoiceId: invoice.id }, 'Fee reminder failed for invoice');
    }
  }

  log.info({ tenantId, sent, skipped, failed, bySms, smsConfigured }, 'Fee reminders dispatched');
  return { sent, skipped, failed, bySms, smsConfigured };
}

export async function getStudentFeeSummary(studentId: string) {
  const [invoices, aggregate, payments] = await Promise.all([
    prisma.invoice.findMany({
      where: { studentId, status: { not: 'CANCELLED' } },
      orderBy: { dueDate: 'desc' },
      select: {
        id: true,
        invoiceNo: true,
        status: true,
        issueDate: true,
        dueDate: true,
        totalAmount: true,
        paidAmount: true,
        balanceAmount: true,
      },
    }),
    prisma.invoice.aggregate({
      where: { studentId, status: { not: 'CANCELLED' } },
      _sum: { totalAmount: true, paidAmount: true, balanceAmount: true },
    }),
    prisma.payment.findMany({
      where: { studentId, status: 'SUCCESS' },
      orderBy: { paidAt: 'desc' },
      take: 20,
      select: { id: true, receiptNo: true, amount: true, mode: true, paidAt: true },
    }),
  ]);

  const overdue = invoices.filter((i) => i.status === 'OVERDUE');

  return {
    invoices,
    recentPayments: payments,
    summary: {
      totalBilled: toNumber(aggregate._sum.totalAmount),
      totalPaid: toNumber(aggregate._sum.paidAmount),
      outstanding: toNumber(aggregate._sum.balanceAmount),
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((sum, i) => sum + i.balanceAmount.toNumber(), 0),
    },
  };
}

export async function getCollectionReport(
  tenantId: string,
  tenant: { tenantId: string; branchId?: string },
  range: { from?: Date | undefined; to?: Date | undefined },
) {
  const where = {
    tenantId,
    status: 'SUCCESS' as const,
    ...(range.from || range.to
      ? { paidAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
      : {}),
  };

  const [byMode, total, outstanding] = await Promise.all([
    prisma.payment.groupBy({
      by: ['mode'],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.payment.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
    prisma.invoice.aggregate({
      where: {
        tenantId,
        ...(tenant.branchId ? { branchId: tenant.branchId } : {}),
        status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
      },
      _sum: { balanceAmount: true },
      _count: { _all: true },
    }),
  ]);

  return {
    collected: toNumber(total._sum.amount),
    transactionCount: total._count._all,
    outstanding: toNumber(outstanding._sum.balanceAmount),
    outstandingInvoices: outstanding._count._all,
    byMode: byMode.map((m) => ({
      mode: m.mode,
      amount: toNumber(m._sum.amount),
      count: m._count._all,
    })),
  };
}
