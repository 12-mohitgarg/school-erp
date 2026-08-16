/** System Settings: institution profile, branches, users, RBAC, integrations. */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok, created, paginated, pageParams } from '../../core/http/respond.js';
import { validate, idParam, uuidSchema, emailSchema, phoneSchema, passwordSchema, latitude, longitude, listQuery, Validated } from '../../core/http/validate.js';
import { requireAuth, requirePermission } from '../../core/auth/middleware.js';
import { scopedRequest } from '../../core/tenancy/scope.js';
import { auditFromRequest } from '../../core/audit/audit.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { prisma } from '../../core/db/prisma.js';
import { storageConfig, assertStorableUrl } from '../../core/storage/cloudinary.js';
import { JOBS, findJob, runJob } from '../../core/jobs/scheduler.js';
import { hashPassword, encryptSecret, randomToken } from '../../core/auth/password.js';
import { invalidateUserContext, invalidateManyContexts } from '../../core/auth/context.js';
import { revokeAllUserTokens } from '../../core/auth/tokens.js';
import { ALL_PERMISSIONS, ROLE_DEFINITIONS } from '@erp/shared';

const router = Router();

// --- Institution -----------------------------------------------------------

router.get('/institution', requirePermission('settings:view'), asyncHandler(async (req, res) => {
  const { auth } = scopedRequest(req);
  return ok(res, await prisma.tenant.findUniqueOrThrow({
    where: { id: auth.tenantId },
    include: { branches: { where: { isActive: true } } },
  }));
}));

router.patch('/institution', requirePermission('settings:update'),
  validate({ body: z.object({
    name: z.string().trim().min(1).max(160).optional(),
    legalName: z.string().max(200).optional(),
    logoUrl: z.string().url().max(500).optional(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    website: z.string().url().max(200).optional(),
    addressLine1: z.string().max(200).optional(),
    city: z.string().max(80).optional(),
    state: z.string().max(80).optional(),
    postalCode: z.string().max(12).optional(),
    timezone: z.string().max(60).optional(),
    currency: z.string().length(3).optional(),
    locale: z.string().max(10).optional(),
    gstin: z.string().max(20).optional(),
    // PRD 6.3 — each school sets its own location-retention window.
    locationRetentionDays: z.coerce.number().int().min(1).max(365).optional(),
    settings: z.record(z.unknown()).optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;

    // A logo is a stored file reference, so it goes through the same origin
    // check as every other upload rather than being trusted as a plain URL.
    if (typeof body['logoUrl'] === 'string') assertStorableUrl(body['logoUrl'], 'logoUrl');

    const tenant = await prisma.tenant.update({
      where: { id: auth.tenantId }, data: body as never,
    });

    await auditFromRequest(req, {
      action: 'UPDATE', module: 'settings', entityType: 'Tenant', entityId: tenant.id,
      after: req.body,
    });

    return ok(res, tenant);
  }));

// --- Branches --------------------------------------------------------------

router.post('/branches', requirePermission('settings:update'),
  validate({ body: z.object({
    name: z.string().trim().min(1).max(160),
    code: z.string().trim().min(1).max(20),
    addressLine1: z.string().max(200).optional(),
    city: z.string().max(80).optional(),
    state: z.string().max(80).optional(),
    phone: phoneSchema.optional(),
    email: emailSchema.optional(),
    principalName: z.string().max(120).optional(),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    isHeadOffice: z.boolean().default(false),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;

    const branch = await prisma.branch.create({
      data: { tenantId: auth.tenantId, ...(body as Validated) },
    });

    // A campus with coordinates gets a default SCHOOL geofence so arrival and
    // departure alerts work without extra setup.
    if (body['latitude'] && body['longitude']) {
      await prisma.geofence.create({
        data: {
          tenantId: auth.tenantId, branchId: branch.id,
          name: `${branch.name} campus`, type: 'SCHOOL', shape: 'CIRCLE',
          centerLatitude: body['latitude'] as number,
          centerLongitude: body['longitude'] as number,
          radiusMeters: 200,
        },
      });
    }

    await auditFromRequest(req, { action: 'CREATE', module: 'settings', entityType: 'Branch', entityId: branch.id });
    return created(res, branch);
  }));

// --- Users & RBAC ----------------------------------------------------------

router.get('/users', requirePermission('settings:view'),
  validate({ query: listQuery.extend({ role: z.string().optional(), status: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const { auth } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);
    const q = req.query as { search?: string; role?: string; status?: string };

    const where = {
      tenantId: auth.tenantId, deletedAt: null,
      ...(q.role ? { role: q.role as never } : {}),
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.search ? { OR: [
        { firstName: { contains: q.search, mode: 'insensitive' as const } },
        { lastName: { contains: q.search, mode: 'insensitive' as const } },
        { email: { contains: q.search, mode: 'insensitive' as const } },
      ] } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where, skip, take, orderBy: { createdAt: 'desc' },
        select: {
          id: true, email: true, phone: true, firstName: true, lastName: true,
          role: true, scope: true, status: true, avatarUrl: true, lastLoginAt: true,
          twoFactorEnabled: true, createdAt: true,
          branch: { select: { id: true, name: true } },
          customRole: { select: { id: true, name: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }));

router.post('/users', requirePermission('settings:update'),
  validate({ body: z.object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    role: z.enum(['SUPER_ADMIN', 'ADMIN', 'ADMINISTRATION', 'TEACHER', 'STUDENT', 'PARENT', 'ACCOUNTANT', 'LIBRARIAN', 'DRIVER', 'HR']),
    branchId: uuidSchema.optional(),
    password: passwordSchema.optional(),
    employeeId: uuidSchema.optional(),
    customRoleId: uuidSchema.optional(),
  }).refine((d) => d.email || d.phone, { message: 'Provide an email or a phone number' }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;

    // Only a super admin may mint another super admin.
    if (body['role'] === 'SUPER_ADMIN' && auth.role !== 'SUPER_ADMIN') {
      throw AppError.forbidden('Only a Super Admin can create another Super Admin');
    }

    const { password, employeeId, ...fields } = body;
    const temporary = (password as string) ?? randomToken(9);

    const user = await prisma.user.create({
      data: {
        tenantId: auth.tenantId,
        ...(fields as Validated),
        scope: ROLE_DEFINITIONS[body['role'] as keyof typeof ROLE_DEFINITIONS].scope,
        passwordHash: await hashPassword(temporary),
        // Force a rotation when we generated the password for them.
        mustChangePassword: !password,
        status: 'ACTIVE',
      },
      select: { id: true, email: true, phone: true, firstName: true, lastName: true, role: true },
    });

    if (employeeId) {
      await prisma.employee.update({ where: { id: employeeId as string }, data: { userId: user.id } });
    }

    await auditFromRequest(req, {
      action: 'CREATE', module: 'settings', entityType: 'User', entityId: user.id,
      after: { email: user.email, role: user.role },
    });

    // The temporary password is returned once, for the admin to hand over.
    return created(res, { ...user, temporaryPassword: password ? undefined : temporary });
  }));

router.patch('/users/:id', requirePermission('settings:update'),
  validate({ params: idParam, body: z.object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
    role: z.string().optional(),
    branchId: uuidSchema.nullable().optional(),
    extraPermissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).optional(),
    deniedPermissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).optional(),
    customRoleId: uuidSchema.nullable().optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const targetId = req.params['id']!;
    const patch = req.body as Record<string, unknown>;

    const target = await prisma.user.findFirst({
      where: { id: targetId, tenantId: auth.tenantId },
      select: { id: true, role: true },
    });
    if (!target) throw AppError.notFound('User');

    if ((target.role === 'SUPER_ADMIN' || patch['role'] === 'SUPER_ADMIN') && auth.role !== 'SUPER_ADMIN') {
      throw AppError.forbidden('Only a Super Admin can modify Super Admin accounts');
    }

    const updated = await prisma.user.update({ where: { id: targetId }, data: patch as never });

    // Permission and status changes take effect immediately.
    await invalidateUserContext(targetId);
    if (patch['status'] && patch['status'] !== 'ACTIVE') {
      await revokeAllUserTokens(targetId);
    }

    await auditFromRequest(req, {
      action: 'PERMISSION_CHANGE', module: 'settings', entityType: 'User', entityId: targetId,
      after: patch,
    });

    return ok(res, updated);
  }));

/** Permission catalogue for the RBAC editor. */
router.get('/permissions', requirePermission('settings:view'), asyncHandler(async (_req, res) =>
  ok(res, {
    permissions: ALL_PERMISSIONS,
    roles: Object.values(ROLE_DEFINITIONS).map((d) => ({
      role: d.role, label: d.label, description: d.description, scope: d.scope,
      permissions: d.permissions === '*' ? ['*'] : d.permissions,
    })),
  }),
));

router.get('/custom-roles', requirePermission('settings:view'), asyncHandler(async (req, res) => {
  const { auth } = scopedRequest(req);
  return ok(res, await prisma.customRole.findMany({
    where: { tenantId: auth.tenantId },
    include: { _count: { select: { users: true } } },
  }));
}));

router.post('/custom-roles', requirePermission('settings:update'),
  validate({ body: z.object({
    name: z.string().trim().min(1).max(60),
    description: z.string().max(300).optional(),
    baseRole: z.enum(['ADMIN', 'ADMINISTRATION', 'TEACHER', 'ACCOUNTANT', 'LIBRARIAN', 'HR']),
    scope: z.enum(['TENANT', 'BRANCH', 'ASSIGNED', 'SELF', 'CHILDREN']).default('BRANCH'),
    permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).min(1),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const role = await prisma.customRole.create({
      data: { tenantId: auth.tenantId, ...(req.body as Validated) },
    });

    await auditFromRequest(req, {
      action: 'CREATE', module: 'settings', entityType: 'CustomRole', entityId: role.id, after: role,
    });

    return created(res, role);
  }));

router.patch('/custom-roles/:id', requirePermission('settings:update'),
  validate({ params: idParam, body: z.object({
    name: z.string().max(60).optional(),
    description: z.string().max(300).optional(),
    permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const roleId = req.params['id']!;

    /*
      Scoped by tenant, not just by id. Updating on the primary key alone let a
      token from one school rewrite another school's custom role — and since a
      custom role carries an explicit permission list, that is a direct
      privilege-escalation path into the other school.
    */
    const existing = await prisma.customRole.findFirst({
      where: { id: roleId, tenantId: auth.tenantId },
      select: { id: true },
    });
    if (!existing) throw AppError.notFound('Custom role');

    const role = await prisma.customRole.update({
      where: { id: roleId }, data: req.body as never,
      include: { users: { select: { id: true } } },
    });

    // Everyone holding this role needs their cached permissions dropped.
    await invalidateManyContexts(role.users.map((u) => u.id));

    await auditFromRequest(req, {
      action: 'PERMISSION_CHANGE', module: 'settings', entityType: 'CustomRole', entityId: roleId,
      after: req.body,
    });

    return ok(res, role);
  }));

// --- Integrations ----------------------------------------------------------

router.get('/integrations', requirePermission('settings:view'), asyncHandler(async (req, res) => {
  const { auth } = scopedRequest(req);
  const integrations = await prisma.integration.findMany({
    where: { tenantId: auth.tenantId },
    // `credentials` is deliberately excluded — the vault is write-only.
    select: {
      id: true, category: true, provider: true, label: true, isEnabled: true,
      isSandbox: true, config: true, lastHealthCheckAt: true, lastHealthStatus: true,
      lastErrorMessage: true, updatedAt: true,
    },
  });
  return ok(res, integrations);
}));

router.put('/integrations', requirePermission('settings:update'),
  validate({ body: z.object({
    category: z.enum(['SMS', 'EMAIL', 'PAYMENT', 'MAPS', 'BIOMETRIC', 'STORAGE', 'PUSH', 'WHATSAPP']),
    provider: z.string().trim().min(1).max(60),
    label: z.string().trim().min(1).max(80),
    isEnabled: z.boolean().default(false),
    isSandbox: z.boolean().default(true),
    credentials: z.record(z.string()).optional(),
    config: z.record(z.unknown()).default({}),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;

    // Credentials are encrypted at rest with AES-256-GCM.
    const encrypted = body['credentials']
      ? encryptSecret(JSON.stringify(body['credentials']))
      : undefined;

    const integration = await prisma.integration.upsert({
      where: {
        tenantId_category_provider: {
          tenantId: auth.tenantId,
          category: body['category'] as never,
          provider: body['provider'] as string,
        },
      },
      create: {
        tenantId: auth.tenantId,
        category: body['category'] as never,
        provider: body['provider'] as string,
        label: body['label'] as string,
        isEnabled: body['isEnabled'] as boolean,
        isSandbox: body['isSandbox'] as boolean,
        credentials: encrypted ?? null,
        config: body['config'] as never,
      },
      update: {
        label: body['label'] as string,
        isEnabled: body['isEnabled'] as boolean,
        isSandbox: body['isSandbox'] as boolean,
        ...(encrypted ? { credentials: encrypted } : {}),
        config: body['config'] as never,
      },
      select: { id: true, category: true, provider: true, label: true, isEnabled: true },
    });

    await auditFromRequest(req, {
      action: 'UPDATE', module: 'settings', entityType: 'Integration', entityId: integration.id,
      // Never write the credentials themselves into the audit trail.
      after: { category: integration.category, provider: integration.provider, isEnabled: integration.isEnabled },
    });

    return ok(res, integration);
  }));

// --- Cloud storage -----------------------------------------------------------

/**
 * Upload configuration for the browser.
 *
 * The cloud name and unsigned preset are public by design — they are what
 * lets the browser post a file straight to Cloudinary without it transiting
 * this API. Serving them from here rather than baking them into the bundle
 * means storage can be re-pointed without a front-end rebuild.
 */
/*
  No extra guard beyond the router's own `authenticate`. `requireAuth` is an
  assertion helper that takes a Request and returns the auth context — passing
  it here as middleware silently swallowed the request, because it never calls
  `next()`. Any signed-in user may read this: the values are public by design.
*/
router.get('/storage', asyncHandler(async (_req, res) => ok(res, storageConfig())));

// --- Scheduler ---------------------------------------------------------------

/**
 * The background jobs, what each one is for, and how the last runs went.
 *
 * Scheduled work that nobody can inspect is scheduled work nobody trusts, so
 * every job declares the PRD clause it satisfies and carries its own run
 * history rather than living only in the server log.
 */
router.get('/scheduler', requirePermission('settings:view'), asyncHandler(async (_req, res) => {
  const [latest, recent] = await Promise.all([
    // One row per job — the most recent run of each.
    prisma.jobRun.findMany({
      orderBy: { startedAt: 'desc' },
      distinct: ['job'],
      take: JOBS.length,
    }),
    prisma.jobRun.findMany({ orderBy: { startedAt: 'desc' }, take: 40 }),
  ]);

  const lastByJob = new Map(latest.map((run) => [run.job, run]));

  // Failure counts over the last day, so a job that fails intermittently is
  // visible even when its most recent run happened to succeed.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const failures = await prisma.jobRun.groupBy({
    by: ['job'],
    where: { status: 'FAILED', startedAt: { gte: since } },
    _count: { _all: true },
  });
  const failuresByJob = new Map(failures.map((f) => [f.job, f._count._all]));

  return ok(res, {
    jobs: JOBS.map((job) => {
      const last = lastByJob.get(job.name);
      return {
        name: job.name,
        label: job.label,
        relatesTo: job.relatesTo,
        description: job.description,
        intervalMs: job.intervalMs,
        manualRunnable: job.manualRunnable,
        failures24h: failuresByJob.get(job.name) ?? 0,
        lastRun: last
          ? {
              status: last.status,
              startedAt: last.startedAt,
              finishedAt: last.finishedAt,
              durationMs: last.durationMs,
              affected: last.affected,
              summary: last.summary,
              error: last.error,
              manual: last.manual,
            }
          : null,
        nextRunAt: last
          ? new Date(last.startedAt.getTime() + job.intervalMs).toISOString()
          : null,
      };
    }),
    recentRuns: recent,
  });
}));

/** Trigger a job by hand — for verifying a fix without waiting for the timer. */
router.post('/scheduler/:name/run', requirePermission('settings:update'),
  validate({ params: z.object({ name: z.string().min(1).max(60) }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const job = findJob(req.params['name']!);

    if (!job) throw AppError.notFound('Job');
    if (!job.manualRunnable) {
      throw AppError.badRequest(`"${job.label}" cannot be triggered manually`);
    }

    const outcome = await runJob(job, { manual: true, triggeredById: auth.userId });

    await auditFromRequest(req, {
      action: 'UPDATE', module: 'settings', entityType: 'JobRun', entityId: job.name,
      after: { status: outcome.status, affected: outcome.affected },
    });

    return ok(res, outcome);
  }));

export default router;
