/**
 * Authentication business logic.
 *
 * Security posture:
 *   * Login is identifier-agnostic (email or phone) but always reports the
 *     same generic error, so it cannot be used to enumerate accounts.
 *   * Failed attempts are counted and the account locks temporarily.
 *   * A successful login resets the counter and rotates a fresh token family.
 */

import type { AuthUser, LinkedChild, LoginResponse, Role } from '@erp/shared';
import { ROLE_DEFINITIONS, homeRouteForRole } from '@erp/shared';
import { prisma } from '../../core/db/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { hashPassword, verifyPassword, hashToken, randomToken } from '../../core/auth/password.js';
import {
  issueTokens,
  revokeAllUserTokens,
  type DeviceContext,
} from '../../core/auth/tokens.js';
import { loadUserContext, invalidateUserContext } from '../../core/auth/context.js';
import { recordAudit } from '../../core/audit/audit.service.js';
import { env } from '../../config/env.js';
import { redis, keys } from '../../core/cache/redis.js';
import { moduleLogger } from '../../core/logger.js';
import { notify } from '../../core/notifications/notification.service.js';

const log = moduleLogger('auth');

/** Shape the client-facing user object from a loaded context. */
async function buildAuthUser(userId: string): Promise<AuthUser> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      avatarUrl: true,
      role: true,
      locale: true,
      mustChangePassword: true,
      twoFactorEnabled: true,
      tenantId: true,
      branchId: true,
      tenant: { select: { name: true } },
      branch: { select: { name: true } },
      student: { select: { id: true } },
      employee: { select: { id: true } },
    },
  });

  const context = await loadUserContext(userId);

  const authUser: AuthUser = {
    id: user.id,
    email: user.email ?? '',
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    avatarUrl: user.avatarUrl,
    role: user.role,
    permissions: context.permissions as AuthUser['permissions'],
    scope: context.scope,
    tenantId: user.tenantId,
    tenantName: user.tenant.name,
    branchId: user.branchId,
    branchName: user.branch?.name ?? null,
    locale: user.locale,
    mustChangePassword: user.mustChangePassword,
    twoFactorEnabled: user.twoFactorEnabled,
  };

  if (user.student) authUser.studentId = user.student.id;
  if (user.employee) authUser.employeeId = user.employee.id;

  if (user.role === 'PARENT' && context.guardianId) {
    authUser.children = await loadLinkedChildren(context.guardianId);
  }

  return authUser;
}

/** The children a guardian may see, with their location-visibility flag. */
async function loadLinkedChildren(guardianId: string): Promise<LinkedChild[]> {
  const links = await prisma.studentGuardian.findMany({
    where: { guardianId },
    select: {
      custody: true,
      canViewLocation: true,
      student: {
        select: {
          id: true,
          admissionNo: true,
          firstName: true,
          lastName: true,
          photoUrl: true,
          enrollments: {
            where: { isCurrent: true },
            take: 1,
            select: {
              class: { select: { name: true } },
              section: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  return links.map((link) => {
    const enrollment = link.student.enrollments[0];
    return {
      studentId: link.student.id,
      admissionNo: link.student.admissionNo,
      fullName: `${link.student.firstName} ${link.student.lastName}`.trim(),
      avatarUrl: link.student.photoUrl,
      className: enrollment?.class.name ?? '—',
      sectionName: enrollment?.section.name ?? '—',
      custody: link.custody,
      // Non-custodial guardians never get the live map, even if the flag drifts.
      canViewLocation: link.canViewLocation && link.custody !== 'NON_CUSTODIAL',
    };
  });
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function login(
  identifier: string,
  password: string,
  device: DeviceContext & { deviceId?: string },
): Promise<LoginResponse & { homeRoute: string }> {
  const normalised = identifier.trim().toLowerCase();

  const attemptKey = keys.loginAttempts(normalised);
  const attempts = Number((await redis.get(attemptKey)) ?? 0);

  if (attempts >= env.MAX_LOGIN_ATTEMPTS) {
    const ttl = await redis.ttl(attemptKey);
    throw AppError.accountLocked(Math.max(1, Math.ceil(ttl / 60)));
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: normalised }, { phone: identifier.trim() }],
      deletedAt: null,
    },
    select: {
      id: true,
      passwordHash: true,
      status: true,
      role: true,
      scope: true,
      tenantId: true,
      branchId: true,
      firstName: true,
      lastName: true,
      lockedUntil: true,
    },
  });

  // Uniform failure path: no distinction between "no such user" and "wrong
  // password", and the bcrypt comparison still runs to keep timing even.
  const passwordOk = user?.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');

  if (!user || !passwordOk) {
    const next = await redis.incr(attemptKey);
    if (next === 1) await redis.expire(attemptKey, env.LOCKOUT_MINUTES * 60);

    if (user) {
      await recordAudit({
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: `${user.firstName} ${user.lastName}`,
        actorRole: user.role,
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user.id,
        ipAddress: device.ipAddress ?? null,
        userAgent: device.userAgent ?? null,
      });
    }

    throw AppError.invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw AppError.accountLocked(minutes);
  }

  if (user.status !== 'ACTIVE') {
    throw AppError.accountInactive(
      user.status === 'PENDING_INVITE'
        ? 'Please complete your account setup using the invite link'
        : 'This account is not active. Contact your administrator.',
    );
  }

  // Success — clear the throttle and record the login.
  await redis.del(attemptKey);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      lastLoginIp: device.ipAddress ?? null,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  const tokens = await issueTokens(
    {
      userId: user.id,
      role: user.role,
      tenantId: user.tenantId,
      branchId: user.branchId,
      scope: user.scope,
    },
    device,
  );

  const authUser = await buildAuthUser(user.id);

  await recordAudit({
    tenantId: user.tenantId,
    actorId: user.id,
    actorName: authUser.fullName,
    actorRole: user.role,
    action: 'LOGIN',
    entityType: 'User',
    entityId: user.id,
    ipAddress: device.ipAddress ?? null,
    userAgent: device.userAgent ?? null,
  });

  log.info({ userId: user.id, role: user.role }, 'User signed in');

  return {
    user: authUser,
    tokens: { ...tokens, tokenType: 'Bearer' },
    homeRoute: homeRouteForRole(user.role),
  };
}

export async function getCurrentUser(userId: string): Promise<AuthUser> {
  return buildAuthUser(userId);
}

// ---------------------------------------------------------------------------
// Password management
// ---------------------------------------------------------------------------

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, passwordHash: true, tenantId: true, role: true, firstName: true, lastName: true },
  });

  if (!user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw AppError.invalidCredentials('Current password is incorrect');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });

  // Changing a password must invalidate every existing session.
  await revokeAllUserTokens(userId);
  await invalidateUserContext(userId);

  await recordAudit({
    tenantId: user.tenantId,
    actorId: userId,
    actorName: `${user.firstName} ${user.lastName}`,
    actorRole: user.role,
    action: 'PASSWORD_CHANGE',
    entityType: 'User',
    entityId: userId,
  });
}

/**
 * Begin a password reset. Always resolves successfully, whether or not the
 * identifier matched, so the endpoint cannot confirm which accounts exist.
 */
export async function requestPasswordReset(identifier: string): Promise<void> {
  const normalised = identifier.trim().toLowerCase();

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: normalised }, { phone: identifier.trim() }],
      deletedAt: null,
      status: 'ACTIVE',
    },
    select: { id: true, email: true, firstName: true, tenantId: true },
  });

  if (!user) {
    log.debug({ identifier: normalised }, 'Password reset requested for unknown identifier');
    return;
  }

  const token = randomToken();
  // Store only the hash, with a short TTL.
  await redis.setex(`pwreset:${hashToken(token)}`, 60 * 60, user.id);

  await notify({
    tenantId: user.tenantId,
    userIds: [user.id],
    title: 'Reset your password',
    body: `Hello ${user.firstName}, use this link to set a new password. It expires in one hour.<br><br><a href="${'${WEB_URL}'}/reset-password?token=${token}">Reset password</a>`,
    channels: ['EMAIL', 'IN_APP'],
    priority: 'HIGH',
    module: 'settings',
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const redisKey = `pwreset:${hashToken(token)}`;
  const userId = await redis.get(redisKey);

  if (!userId) throw AppError.tokenInvalid('This reset link is invalid or has expired');

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  // One-shot token.
  await redis.del(redisKey);
  await revokeAllUserTokens(userId);
  await invalidateUserContext(userId);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { tenantId: true, role: true, firstName: true, lastName: true },
  });

  await recordAudit({
    tenantId: user.tenantId,
    actorId: userId,
    actorName: `${user.firstName} ${user.lastName}`,
    actorRole: user.role,
    action: 'PASSWORD_RESET',
    entityType: 'User',
    entityId: userId,
  });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function listSessions(userId: string, currentSessionId: string) {
  const sessions = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      familyId: true,
      userAgent: true,
      ipAddress: true,
      deviceId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    distinct: ['familyId'],
  });

  return sessions.map((s) => ({
    sessionId: s.familyId,
    userAgent: s.userAgent,
    ipAddress: s.ipAddress,
    deviceId: s.deviceId,
    signedInAt: s.createdAt,
    isCurrent: s.familyId === currentSessionId,
  }));
}

export async function registerPushToken(
  userId: string,
  token: string,
  platform: string,
  deviceName?: string,
): Promise<void> {
  await prisma.pushToken.upsert({
    where: { token },
    create: { userId, token, platform, deviceName: deviceName ?? null, isActive: true },
    // Re-registering an existing token may mean it moved to another user.
    update: { userId, isActive: true, lastUsedAt: new Date(), deviceName: deviceName ?? null },
  });
}

export async function removePushToken(token: string): Promise<void> {
  await prisma.pushToken.updateMany({ where: { token }, data: { isActive: false } });
}

// ---------------------------------------------------------------------------
// Consent (DPDP / GDPR)
// ---------------------------------------------------------------------------

export async function recordConsent(
  userId: string,
  consentType: string,
  granted: boolean,
  version: string,
  ipAddress: string | null,
): Promise<void> {
  await prisma.consentRecord.create({
    data: {
      userId,
      consentType,
      granted,
      version,
      ipAddress,
      revokedAt: granted ? null : new Date(),
    },
  });

  // Withdrawing location consent must immediately close the live map for
  // every student this guardian is linked to.
  if (consentType === 'LOCATION_TRACKING') {
    const guardian = await prisma.guardian.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (guardian) {
      await prisma.studentGuardian.updateMany({
        where: { guardianId: guardian.id },
        data: {
          canViewLocation: granted,
          locationConsentAt: granted ? new Date() : null,
          locationConsentIp: granted ? ipAddress : null,
        },
      });
      await invalidateUserContext(userId);
    }
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { tenantId: true, role: true, firstName: true, lastName: true },
  });

  await recordAudit({
    tenantId: user.tenantId,
    actorId: userId,
    actorName: `${user.firstName} ${user.lastName}`,
    actorRole: user.role,
    action: granted ? 'CONSENT_GRANT' : 'CONSENT_REVOKE',
    entityType: 'ConsentRecord',
    after: { consentType, granted, version },
    ipAddress,
  });
}

/** The permission catalogue the web app uses to render its RBAC editor. */
export function roleCatalogue(): Array<{
  role: Role;
  label: string;
  description: string;
  scope: string;
  homeRoute: string;
  permissionCount: number;
}> {
  return Object.values(ROLE_DEFINITIONS).map((def) => ({
    role: def.role,
    label: def.label,
    description: def.description,
    scope: def.scope,
    homeRoute: def.homeRoute,
    permissionCount: def.permissions === '*' ? -1 : def.permissions.length,
  }));
}
