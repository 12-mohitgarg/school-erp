/**
 * Payroll processing.
 *
 * A run is idempotent per (branch, month, year): re-running replaces the draft
 * payslips rather than double-paying. Loss-of-pay is derived from approved
 * leave and recorded attendance, so payroll and attendance cannot disagree.
 */

import { Prisma } from '@prisma/client';
import type { RequestAuth } from '../../types/express.js';
import { prisma } from '../../core/db/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { moduleLogger } from '../../core/logger.js';

const log = moduleLogger('payroll');
const dec = (n: number) => new Prisma.Decimal(n);

/** Statutory rates (India). Tenants can override these in settings later. */
const PF_EMPLOYEE_RATE = 0.12;
const PF_WAGE_CEILING = 15_000;
const ESI_EMPLOYEE_RATE = 0.0075;
const ESI_WAGE_CEILING = 21_000;
const PROFESSIONAL_TAX_MONTHLY = 200;

export interface PayrollResult {
  payrollRunId: string;
  employeeCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
}

export async function runPayroll(
  auth: RequestAuth,
  month: number,
  year: number,
): Promise<PayrollResult> {
  const existing = await prisma.payrollRun.findFirst({
    where: { tenantId: auth.tenantId, branchId: auth.branchId, month, year },
    select: { id: true, status: true },
  });

  if (existing && existing.status !== 'DRAFT') {
    throw AppError.conflict(
      `Payroll for ${month}/${year} is already ${existing.status.toLowerCase()} and cannot be re-run`,
    );
  }

  const employees = await prisma.employee.findMany({
    where: {
      tenantId: auth.tenantId,
      ...(auth.branchId ? { branchId: auth.branchId } : {}),
      status: { in: ['ACTIVE', 'ON_LEAVE'] },
      deletedAt: null,
    },
    select: {
      id: true,
      salaryStructures: {
        where: { isActive: true },
        take: 1,
        select: { basicSalary: true, grossSalary: true, components: true },
      },
    },
  });

  const payable = employees.filter((e) => e.salaryStructures.length > 0);
  if (payable.length === 0) {
    throw AppError.badRequest('No employees have an active salary structure');
  }

  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 0));
  const workingDays = periodEnd.getUTCDate();

  const employeeIds = payable.map((e) => e.id);

  // Gather attendance and unpaid-leave totals for the whole cohort up front,
  // OUTSIDE the transaction. Doing these per employee inside it was both an
  // N+1 and the reason the transaction timed out against a remote database.
  const [attendanceByEmployee, leaveByEmployee] = await Promise.all([
    prisma.employeeAttendance.groupBy({
      by: ['employeeId'],
      where: {
        employeeId: { in: employeeIds },
        date: { gte: periodStart, lte: periodEnd },
        status: { in: ['PRESENT', 'LATE', 'HALF_DAY'] },
      },
      _count: { _all: true },
    }),
    prisma.leaveRequest.groupBy({
      by: ['employeeId'],
      where: {
        employeeId: { in: employeeIds },
        status: 'APPROVED',
        leaveType: { isPaid: false },
        fromDate: { lte: periodEnd },
        toDate: { gte: periodStart },
      },
      _sum: { totalDays: true },
    }),
  ]);

  const presentDaysByEmployee = new Map(
    attendanceByEmployee.map((row) => [row.employeeId, row._count._all]),
  );
  const lopDaysByEmployee = new Map(
    leaveByEmployee.map((row) => [row.employeeId, row._sum.totalDays?.toNumber() ?? 0]),
  );

  // Compute every payslip before opening the transaction, so the transaction
  // contains writes only.
  const payslips = payable.map((employee) => {
    const structure = employee.salaryStructures[0]!;
    const basic = structure.basicSalary.toNumber();
    const gross = structure.grossSalary.toNumber();

    const presentDays = presentDaysByEmployee.get(employee.id) ?? 0;
    const lopDays = lopDaysByEmployee.get(employee.id) ?? 0;
    const paidDays = Math.max(0, workingDays - lopDays);
    // Pro-rate on loss-of-pay days only; paid leave does not reduce salary.
    const proRataFactor = workingDays === 0 ? 1 : paidDays / workingDays;

    const grossEarnings = Number((gross * proRataFactor).toFixed(2));
    const basicEarned = Number((basic * proRataFactor).toFixed(2));

    const pfWage = Math.min(basicEarned, PF_WAGE_CEILING);
    const pfEmployee = Number((pfWage * PF_EMPLOYEE_RATE).toFixed(2));
    const esi =
      grossEarnings <= ESI_WAGE_CEILING
        ? Number((grossEarnings * ESI_EMPLOYEE_RATE).toFixed(2))
        : 0;
    const professionalTax = grossEarnings > 15_000 ? PROFESSIONAL_TAX_MONTHLY : 0;

    const componentDeductions =
      (structure.components as Array<{ type: string; amount: number }> | null)
        ?.filter((c) => c.type === 'DEDUCTION')
        .reduce((sum, c) => sum + Number(c.amount ?? 0), 0) ?? 0;

    const deductions = Number(
      (pfEmployee + esi + professionalTax + componentDeductions).toFixed(2),
    );
    const netPay = Number((grossEarnings - deductions).toFixed(2));

    return {
      employeeId: employee.id,
      workingDays, presentDays, lopDays,
      basicEarned, grossEarnings, deductions, netPay,
      pfEmployee, esi, professionalTax,
      components: structure.components,
    };
  });

  const totalGross = Number(payslips.reduce((s, p) => s + p.grossEarnings, 0).toFixed(2));
  const totalDeductions = Number(payslips.reduce((s, p) => s + p.deductions, 0).toFixed(2));
  const totalNet = Number(payslips.reduce((s, p) => s + p.netPay, 0).toFixed(2));

  const run = await prisma.$transaction(async (tx) => {
    const payrollRun = existing
      ? await tx.payrollRun.update({
          where: { id: existing.id },
          data: { status: 'PROCESSING', processedById: auth.userId, processedAt: new Date() },
        })
      : await tx.payrollRun.create({
          data: {
            tenantId: auth.tenantId,
            branchId: auth.branchId,
            month,
            year,
            status: 'PROCESSING',
            processedById: auth.userId,
            processedAt: new Date(),
          },
        });

    // Clear any prior draft payslips so a re-run is a clean replacement.
    await tx.payslip.deleteMany({ where: { payrollRunId: payrollRun.id } });

    // One bulk insert rather than a query per employee — the whole point of
    // pre-computing above.
    await tx.payslip.createMany({
      data: payslips.map((p) => ({
        payrollRunId: payrollRun.id,
        employeeId: p.employeeId,
        month,
        year,
        workingDays: dec(p.workingDays),
        presentDays: dec(p.presentDays),
        lopDays: dec(p.lopDays),
        basicSalary: dec(p.basicEarned),
        grossEarnings: dec(p.grossEarnings),
        totalDeductions: dec(p.deductions),
        netPay: dec(p.netPay),
        earnings: (p.components as never) ?? [],
        deductions: [
          { code: 'PF', name: 'Provident Fund', amount: p.pfEmployee },
          { code: 'ESI', name: 'ESI', amount: p.esi },
          { code: 'PT', name: 'Professional Tax', amount: p.professionalTax },
        ] as never,
        pfEmployee: dec(p.pfEmployee),
        esi: dec(p.esi),
        professionalTax: dec(p.professionalTax),
      })),
    });

    return tx.payrollRun.update({
      where: { id: payrollRun.id },
      data: {
        status: 'DRAFT',
        totalEmployees: payable.length,
        totalGross: dec(totalGross),
        totalDeductions: dec(totalDeductions),
        totalNet: dec(totalNet),
      },
    });
  });

  log.info({ month, year, employees: payable.length, net: totalNet }, 'Payroll run completed');

  return {
    payrollRunId: run.id,
    employeeCount: payable.length,
    totalGross: Number(totalGross.toFixed(2)),
    totalDeductions: Number(totalDeductions.toFixed(2)),
    totalNet: Number(totalNet.toFixed(2)),
  };
}
