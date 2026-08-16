/**
 * Platform control plane — managing the schools themselves.
 *
 * Every route here is gated on `requirePlatformAdmin`, which checks a flag on
 * the account rather than a role. A school's own Super Admin is unrestricted
 * *inside* their school and must still get nothing from these endpoints.
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok, created, paginated, pageParams } from '../../core/http/respond.js';
import {
  validate,
  idParam,
  emailSchema,
  phoneSchema,
  passwordSchema,
  latitude,
  longitude,
  listQuery,
} from '../../core/http/validate.js';
import { requireAuth, requirePlatformAdmin } from '../../core/auth/middleware.js';
import { auditFromRequest, recordAudit, clientIp } from '../../core/audit/audit.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { prisma } from '../../core/db/prisma.js';
import { issueTokens, revokeRefreshToken } from '../../core/auth/tokens.js';
import { assertStorableUrl } from '../../core/storage/cloudinary.js';
import { isProduction } from '../../config/env.js';
import { moduleLogger } from '../../core/logger.js';
import * as service from './platform.service.js';

const router = Router();
const log = moduleLogger('platform');

router.use(requirePlatformAdmin);

// ---------------------------------------------------------------------------
// Overview & listing
// ---------------------------------------------------------------------------

router.get(
  '/overview',
  asyncHandler(async (_req, res) => ok(res, await service.platformOverview())),
);

router.get(
  '/schools',
  validate({ query: listQuery.extend({ status: z.enum(['active', 'suspended']).optional() }) }),
  asyncHandler(async (req, res) => {
    const { page, limit, skip, take } = pageParams(req.query);
    const q = req.query as { search?: string; status?: 'active' | 'suspended' };

    const { items, total } = await service.listSchools({
      search: q.search,
      status: q.status,
      skip,
      take,
    });

    return paginated(res, items, total, page, limit);
  }),
);

router.get(
  '/schools/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => ok(res, await service.getSchool(req.params['id']!))),
);

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

const createSchoolBody = z.object({
  name: z.string().trim().min(2).max(160),
  // The code prefixes admission numbers, invoice numbers and the like, so it
  // is restricted to characters that stay readable in a document reference.
  code: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, 'Code may contain letters, numbers and hyphens only'),
  legalName: z.string().max(200).optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  website: z.string().url().max(200).optional(),
  addressLine1: z.string().max(200).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  postalCode: z.string().max(12).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logoUrl: z.string().url().max(500).optional(),
  gstin: z.string().max(20).optional(),
  latitude: latitude.optional(),
  longitude: longitude.optional(),
  locationRetentionDays: z.coerce.number().int().min(1).max(365).optional(),
  subscriptionTier: z.enum(['STANDARD', 'PREMIUM', 'ENTERPRISE']).optional(),
  onboardingNotes: z.string().max(2000).optional(),
  admin: z.object({
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    email: emailSchema,
    phone: phoneSchema.optional(),
    password: passwordSchema.optional(),
  }),
});

router.post(
  '/schools',
  validate({ body: createSchoolBody }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as z.infer<typeof createSchoolBody>;

    if (body.logoUrl) assertStorableUrl(body.logoUrl, 'logoUrl');

    const result = await service.createSchool(body);

    // Audited against the *new* school, so the record lives with the school it
    // describes and survives in its own audit trail.
    await recordAudit({
      tenantId: result.school.id,
      actorId: auth.userId,
      actorName: auth.fullName,
      actorRole: auth.role,
      action: 'CREATE',
      module: 'settings',
      entityType: 'Tenant',
      entityId: result.school.id,
      after: { name: result.school.name, code: result.school.code },
      ipAddress: clientIp(req),
    });

    return created(res, result);
  }),
);

const updateSchoolBody = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  legalName: z.string().max(200).nullish(),
  email: emailSchema.nullish(),
  phone: phoneSchema.nullish(),
  website: z.string().url().max(200).nullish(),
  addressLine1: z.string().max(200).nullish(),
  city: z.string().max(80).nullish(),
  state: z.string().max(80).nullish(),
  postalCode: z.string().max(12).nullish(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logoUrl: z.string().url().max(500).nullish(),
  gstin: z.string().max(20).nullish(),
  locationRetentionDays: z.coerce.number().int().min(1).max(365).optional(),
  subscriptionTier: z.enum(['STANDARD', 'PREMIUM', 'ENTERPRISE']).optional(),
  subscriptionEndsAt: z.coerce.date().nullish(),
  onboardingNotes: z.string().max(2000).nullish(),
});

router.patch(
  '/schools/:id',
  validate({ params: idParam, body: updateSchoolBody }),
  asyncHandler(async (req, res) => {
    const id = req.params['id']!;
    const patch = req.body as Record<string, unknown>;

    if (typeof patch['logoUrl'] === 'string') {
      assertStorableUrl(patch['logoUrl'], 'logoUrl');
    }

    const school = await service.updateSchool(id, patch);

    await auditFromRequest(req, {
      action: 'UPDATE',
      module: 'settings',
      entityType: 'Tenant',
      entityId: id,
      after: patch,
    });

    return ok(res, school);
  }),
);

router.post(
  '/schools/:id/status',
  validate({
    params: idParam,
    body: z.object({
      active: z.boolean(),
      reason: z.string().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const id = req.params['id']!;
    const { active, reason } = req.body as { active: boolean; reason?: string };

    const school = await service.setSchoolStatus(id, active, reason ?? null);

    await auditFromRequest(req, {
      action: active ? 'UPDATE' : 'DELETE',
      module: 'settings',
      entityType: 'Tenant',
      entityId: id,
      after: { isActive: active, reason: reason ?? null },
    });

    return ok(res, school);
  }),
);

router.post(
  '/schools/:id/admins',
  validate({
    params: idParam,
    body: z.object({
      firstName: z.string().trim().min(1).max(60),
      lastName: z.string().trim().min(1).max(60),
      email: emailSchema,
      phone: phoneSchema.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const id = req.params['id']!;
    const admin = await service.addSchoolAdmin(
      id,
      req.body as { firstName: string; lastName: string; email: string; phone?: string },
    );

    await auditFromRequest(req, {
      action: 'CREATE',
      module: 'settings',
      entityType: 'User',
      entityId: admin.id,
      after: { email: admin.email, role: 'SUPER_ADMIN', tenantId: id },
    });

    return created(res, admin);
  }),
);

// ---------------------------------------------------------------------------
// Opening a school's panel
// ---------------------------------------------------------------------------

/**
 * Switch the caller's session into another school.
 *
 * Rather than a parallel "impersonation" code path, this reissues the normal
 * token pair with `tenantId` pointing at the target school. Every handler,
 * query filter and socket room downstream then resolves to that school with no
 * further knowledge of what happened — which is precisely why there is no
 * second set of rules to get wrong.
 *
 * The old refresh token is revoked so a session cannot be live in two schools
 * at once, and the switch is written to both schools' audit trails.
 */
router.post(
  '/schools/:id/open',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const targetId = req.params['id']!;

    const target = await prisma.tenant.findUnique({
      where: { id: targetId },
      select: { id: true, name: true, isActive: true },
    });

    if (!target) throw AppError.notFound('School');
    if (!target.isActive) {
      throw AppError.conflict('This school is suspended. Reactivate it before opening its panel.');
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { id: true, role: true, scope: true, tenantId: true, branchId: true },
    });

    const isHome = target.id === user.tenantId;

    const tokens = await issueTokens(
      {
        userId: user.id,
        role: user.role,
        tenantId: target.id,
        // Their own branch belongs to a different school, so scoping drops to
        // the whole tenant while they are working inside another one.
        branchId: isHome ? user.branchId : null,
        scope: user.scope,
        ...(isHome ? {} : { actingAsPlatformAdmin: true }),
      },
      {
        userAgent: req.headers['user-agent'],
        ipAddress: clientIp(req) ?? undefined,
      },
    );

    // One live session per operator: drop the token they arrived with.
    const presented = (req.cookies as Record<string, string> | undefined)?.['refresh_token'];
    if (presented) await revokeRefreshToken(presented);

    setRefreshCookie(res, tokens.refreshToken);

    for (const tenantId of new Set([auth.tenantId, target.id])) {
      await recordAudit({
        tenantId,
        actorId: auth.userId,
        actorName: auth.fullName,
        actorRole: auth.role,
        action: 'UPDATE',
        module: 'settings',
        entityType: 'Tenant',
        entityId: target.id,
        after: { openedSchool: target.name, platformAdmin: true },
        ipAddress: clientIp(req),
      });
    }

    log.info(
      { userId: auth.userId, from: auth.tenantId, to: target.id },
      'Platform admin opened a school panel',
    );

    return ok(res, {
      tokens: { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, tokenType: 'Bearer' },
      school: { id: target.id, name: target.name },
      impersonating: !isHome,
    });
  }),
);

/** Cookie settings mirrored from the auth controller. */
function setRefreshCookie(res: import('express').Response, token: string): void {
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export default router;
