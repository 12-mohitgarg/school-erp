/**
 * Platform layer — the control plane *above* the schools.
 *
 * A school is a `Tenant`. Everything else in the codebase is already tenant
 * scoped, so provisioning a school is not a special mode: it creates one more
 * tenant row and the entire ERP works inside it unchanged. What this module
 * adds is (a) the ability to create schools, (b) a cross-school view for the
 * operator, and (c) the ability to open a school's own panel.
 *
 * Provisioning is deliberately opinionated. A school created here comes up
 * usable rather than empty: one campus, the current academic year, the
 * standard fee heads, leave types, a campus geofence and the notification
 * templates the automated jobs send. An admin who has to build all of that by
 * hand before the product does anything has not really been onboarded.
 */

import { ROLE_DEFINITIONS, type SchoolSummary } from '@erp/shared';
import { prisma } from '../../core/db/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { hashPassword, randomToken } from '../../core/auth/password.js';
import { moduleLogger } from '../../core/logger.js';

const log = moduleLogger('platform');

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface SchoolListFilters {
  search?: string | undefined;
  status?: 'active' | 'suspended' | undefined;
  skip: number;
  take: number;
}

export async function listSchools(
  filters: SchoolListFilters,
): Promise<{ items: SchoolSummary[]; total: number }> {
  const where = {
    ...(filters.status === 'active' ? { isActive: true } : {}),
    ...(filters.status === 'suspended' ? { isActive: false } : {}),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: 'insensitive' as const } },
            { code: { contains: filters.search, mode: 'insensitive' as const } },
            { city: { contains: filters.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [tenants, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      skip: filters.skip,
      take: filters.take,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { branches: true, students: true, employees: true, users: true, vehicles: true } },
        users: {
          where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, deletedAt: null },
          take: 3,
          orderBy: { createdAt: 'asc' },
          select: { id: true, firstName: true, lastName: true, email: true, lastLoginAt: true },
        },
      },
    }),
    prisma.tenant.count({ where }),
  ]);

  return { items: tenants.map(toSummary), total };
}

function toSummary(tenant: {
  id: string;
  name: string;
  code: string;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  primaryColor: string;
  isActive: boolean;
  suspendedAt: Date | null;
  suspendedReason: string | null;
  subscriptionTier: string;
  subscriptionEndsAt: Date | null;
  locationRetentionDays: number;
  createdAt: Date;
  _count: { branches: number; students: number; employees: number; users: number; vehicles: number };
  users: Array<{ id: string; firstName: string; lastName: string; email: string | null; lastLoginAt: Date | null }>;
}): SchoolSummary {
  return {
    id: tenant.id,
    name: tenant.name,
    code: tenant.code,
    city: tenant.city,
    state: tenant.state,
    logoUrl: tenant.logoUrl,
    primaryColor: tenant.primaryColor,
    isActive: tenant.isActive,
    suspendedAt: tenant.suspendedAt?.toISOString() ?? null,
    suspendedReason: tenant.suspendedReason,
    subscriptionTier: tenant.subscriptionTier,
    subscriptionEndsAt: tenant.subscriptionEndsAt?.toISOString() ?? null,
    locationRetentionDays: tenant.locationRetentionDays,
    createdAt: tenant.createdAt.toISOString(),
    counts: {
      branches: tenant._count.branches,
      students: tenant._count.students,
      staff: tenant._count.employees,
      users: tenant._count.users,
      vehicles: tenant._count.vehicles,
    },
    admins: tenant.users.map((u) => ({
      id: u.id,
      fullName: `${u.firstName} ${u.lastName}`.trim(),
      email: u.email,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    })),
  };
}

/** Aggregate figures across every school, for the platform dashboard. */
export async function platformOverview() {
  const [schools, activeSchools, students, staff, users, vehicles, activeSos, recentSchools] =
    await Promise.all([
      prisma.tenant.count(),
      prisma.tenant.count({ where: { isActive: true } }),
      prisma.student.count({ where: { status: 'ACTIVE' } }),
      prisma.employee.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      prisma.vehicle.count(),
      prisma.sosAlert.count({ where: { status: 'ACTIVE' } }),
      prisma.tenant.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, name: true, code: true, createdAt: true, isActive: true },
      }),
    ]);

  return {
    schools,
    activeSchools,
    suspendedSchools: schools - activeSchools,
    students,
    staff,
    users,
    vehicles,
    activeSos,
    recentSchools,
  };
}

export async function getSchool(tenantId: string): Promise<SchoolSummary> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      _count: { select: { branches: true, students: true, employees: true, users: true, vehicles: true } },
      users: {
        where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, deletedAt: null },
        take: 10,
        orderBy: { createdAt: 'asc' },
        select: { id: true, firstName: true, lastName: true, email: true, lastLoginAt: true },
      },
    },
  });

  if (!tenant) throw AppError.notFound('School');
  return toSummary(tenant);
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

export interface CreateSchoolInput {
  name: string;
  code: string;
  legalName?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  website?: string | undefined;
  addressLine1?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  postalCode?: string | undefined;
  primaryColor?: string | undefined;
  logoUrl?: string | undefined;
  gstin?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
  locationRetentionDays?: number | undefined;
  subscriptionTier?: string | undefined;
  onboardingNotes?: string | undefined;
  admin: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | undefined;
    password?: string | undefined;
  };
}

export interface CreatedSchool {
  school: SchoolSummary;
  admin: { id: string; email: string | null; fullName: string };
  temporaryPassword?: string;
}

/**
 * Create a school and everything it needs to be immediately usable.
 *
 * One transaction: a half-provisioned school — a tenant with no branch, or a
 * branch with no admin able to sign in — is worse than no school at all,
 * because the operator has to clean it up by hand before retrying.
 */
export async function createSchool(input: CreateSchoolInput): Promise<CreatedSchool> {
  const code = input.code.trim().toUpperCase();

  const [codeTaken, emailTaken] = await Promise.all([
    prisma.tenant.findUnique({ where: { code }, select: { id: true } }),
    prisma.user.findFirst({
      where: { email: input.admin.email.toLowerCase(), deletedAt: null },
      select: { id: true },
    }),
  ]);

  if (codeTaken) throw AppError.conflict(`School code "${code}" is already in use`);
  if (emailTaken) {
    throw AppError.conflict(
      `${input.admin.email} already has an account. Use a different address for this school's administrator.`,
    );
  }

  const generatedPassword = input.admin.password ? null : randomToken(9);
  const passwordHash = await hashPassword(input.admin.password ?? generatedPassword!);

  const tenantId = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: input.name.trim(),
        code,
        legalName: input.legalName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        website: input.website ?? null,
        addressLine1: input.addressLine1 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postalCode: input.postalCode ?? null,
        primaryColor: input.primaryColor ?? '#4F46E5',
        logoUrl: input.logoUrl ?? null,
        gstin: input.gstin ?? null,
        locationRetentionDays: input.locationRetentionDays ?? 30,
        subscriptionTier: input.subscriptionTier ?? 'STANDARD',
        onboardingNotes: input.onboardingNotes ?? null,
        isActive: true,
      },
      select: { id: true, name: true },
    });

    const branch = await tx.branch.create({
      data: {
        tenantId: tenant.id,
        name: 'Main Campus',
        code: 'MAIN',
        isHeadOffice: true,
        addressLine1: input.addressLine1 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postalCode: input.postalCode ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
      },
      select: { id: true },
    });

    // The school's own Super Admin: unrestricted inside this school, invisible
    // to every other one. Not a platform admin — that flag stays with us.
    const admin = await tx.user.create({
      data: {
        tenantId: tenant.id,
        branchId: branch.id,
        email: input.admin.email.trim().toLowerCase(),
        phone: input.admin.phone ?? null,
        firstName: input.admin.firstName.trim(),
        lastName: input.admin.lastName.trim(),
        role: 'SUPER_ADMIN',
        scope: ROLE_DEFINITIONS.SUPER_ADMIN.scope,
        passwordHash,
        // A generated password must be rotated on first sign-in.
        mustChangePassword: generatedPassword !== null,
        status: 'ACTIVE',
        isPlatformAdmin: false,
      },
      select: { id: true },
    });

    await seedSchoolDefaults(tx, tenant.id, branch.id, tenant.name, input);

    log.info({ tenantId: tenant.id, code, adminId: admin.id }, 'School provisioned');
    return tenant.id;
  });

  const school = await getSchool(tenantId);
  const admin = school.admins[0]!;

  return {
    school,
    admin: { id: admin.id, email: admin.email, fullName: admin.fullName },
    ...(generatedPassword ? { temporaryPassword: generatedPassword } : {}),
  };
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** The baseline configuration every new school starts with. */
async function seedSchoolDefaults(
  tx: Tx,
  tenantId: string,
  branchId: string,
  schoolName: string,
  input: CreateSchoolInput,
): Promise<void> {
  // Academic year — April to March, the Indian school year.
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

  await tx.academicYear.create({
    data: {
      tenantId,
      name: `${startYear}-${String(startYear + 1).slice(2)}`,
      startDate: new Date(Date.UTC(startYear, 3, 1)),
      endDate: new Date(Date.UTC(startYear + 1, 2, 31)),
      isCurrent: true,
    },
  });

  await tx.feeHead.createMany({
    data: [
      { tenantId, name: 'Tuition Fee', code: 'TUITION', category: 'TUITION', frequency: 'MONTHLY' },
      { tenantId, name: 'Admission Fee', code: 'ADMISSION', category: 'ADMISSION', frequency: 'ONE_TIME' },
      { tenantId, name: 'Transport Fee', code: 'TRANSPORT', category: 'TRANSPORT', frequency: 'MONTHLY' },
      { tenantId, name: 'Examination Fee', code: 'EXAM', category: 'EXAM', frequency: 'HALF_YEARLY' },
      { tenantId, name: 'Library Fee', code: 'LIBRARY', category: 'LIBRARY', frequency: 'ANNUAL' },
    ],
    skipDuplicates: true,
  });

  await tx.leaveType.createMany({
    data: [
      { tenantId, name: 'Casual Leave', code: 'CL', annualQuota: 12, isPaid: true },
      { tenantId, name: 'Sick Leave', code: 'SL', annualQuota: 10, isPaid: true },
      { tenantId, name: 'Earned Leave', code: 'EL', annualQuota: 15, isPaid: true },
      { tenantId, name: 'Loss of Pay', code: 'LOP', annualQuota: 0, isPaid: false },
    ],
    skipDuplicates: true,
  });

  await tx.department.createMany({
    data: [
      { tenantId, name: 'Teaching', code: 'TEACH' },
      { tenantId, name: 'Administration', code: 'ADMIN' },
      { tenantId, name: 'Transport', code: 'TRANS' },
      { tenantId, name: 'Support Staff', code: 'SUPP' },
    ],
    skipDuplicates: true,
  });

  // A campus geofence is what makes arrival/departure alerts work on day one.
  if (input.latitude !== undefined && input.longitude !== undefined) {
    await tx.geofence.create({
      data: {
        tenantId,
        branchId,
        name: `${schoolName} campus`,
        type: 'SCHOOL',
        shape: 'CIRCLE',
        centerLatitude: input.latitude,
        centerLongitude: input.longitude,
        radiusMeters: 200,
        notifyOnEntry: true,
        notifyOnExit: true,
      },
    });
  }

  // Templates the scheduled jobs render. Without these the automated fee and
  // attendance reminders have nothing to send.
  await tx.notificationTemplate.createMany({
    data: [
      {
        tenantId,
        key: 'fees.due_reminder',
        name: 'Fee due reminder',
        channel: 'IN_APP',
        subject: 'Fee due for {{studentName}}',
        body: 'Invoice {{invoiceNo}} of {{amount}} for {{studentName}} is due on {{dueDate}}.',
        variables: ['studentName', 'invoiceNo', 'amount', 'dueDate'],
      },
      {
        tenantId,
        key: 'fees.overdue',
        name: 'Fee overdue notice',
        channel: 'IN_APP',
        subject: 'Fee overdue for {{studentName}}',
        body: 'Invoice {{invoiceNo}} of {{amount}} is now overdue. Please pay at the earliest.',
        variables: ['studentName', 'invoiceNo', 'amount'],
      },
      {
        tenantId,
        key: 'attendance.absent',
        name: 'Absence alert',
        channel: 'IN_APP',
        subject: '{{studentName}} was marked absent',
        body: '{{studentName}} was marked absent on {{date}}. Contact the class teacher if this is unexpected.',
        variables: ['studentName', 'date'],
      },
      {
        tenantId,
        key: 'library.overdue',
        name: 'Library overdue',
        channel: 'IN_APP',
        subject: 'Library book overdue',
        body: '"{{bookTitle}}" was due on {{dueDate}}. A fine of {{fine}} has accrued.',
        variables: ['bookTitle', 'dueDate', 'fine'],
      },
      {
        tenantId,
        key: 'tracking.sos',
        name: 'Emergency SOS',
        channel: 'PUSH',
        subject: 'Emergency alert',
        body: '{{raisedBy}} triggered an emergency alert. Live location is available in the app.',
        variables: ['raisedBy'],
      },
    ],
    skipDuplicates: true,
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function setSchoolStatus(
  tenantId: string,
  active: boolean,
  reason: string | null,
): Promise<SchoolSummary> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) throw AppError.notFound('School');

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      isActive: active,
      suspendedAt: active ? null : new Date(),
      suspendedReason: active ? null : reason,
    },
  });

  // Suspension has to bite immediately: revoke every live session in the
  // school rather than waiting for tokens to age out.
  if (!active) {
    await prisma.refreshToken.updateMany({
      where: { user: { tenantId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    log.warn({ tenantId, reason }, 'School suspended — all sessions revoked');
  }

  return getSchool(tenantId);
}

export async function updateSchool(
  tenantId: string,
  patch: Record<string, unknown>,
): Promise<SchoolSummary> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) throw AppError.notFound('School');

  await prisma.tenant.update({ where: { id: tenantId }, data: patch as never });
  return getSchool(tenantId);
}

/** Add another administrator to a school that has lost access to its own. */
export async function addSchoolAdmin(
  tenantId: string,
  input: { firstName: string; lastName: string; email: string; phone?: string | undefined },
): Promise<{ id: string; email: string | null; temporaryPassword: string }> {
  const [tenant, branch, existing] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }),
    prisma.branch.findFirst({
      where: { tenantId },
      orderBy: { isHeadOffice: 'desc' },
      select: { id: true },
    }),
    prisma.user.findFirst({
      where: { email: input.email.toLowerCase(), deletedAt: null },
      select: { id: true },
    }),
  ]);

  if (!tenant) throw AppError.notFound('School');
  if (!branch) throw AppError.conflict('This school has no campus yet');
  if (existing) throw AppError.conflict(`${input.email} already has an account`);

  const temporaryPassword = randomToken(9);

  const user = await prisma.user.create({
    data: {
      tenantId,
      branchId: branch.id,
      email: input.email.trim().toLowerCase(),
      phone: input.phone ?? null,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      role: 'SUPER_ADMIN',
      scope: ROLE_DEFINITIONS.SUPER_ADMIN.scope,
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
      status: 'ACTIVE',
    },
    select: { id: true, email: true },
  });

  return { ...user, temporaryPassword };
}
