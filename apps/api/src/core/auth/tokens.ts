/**
 * JWT issuance and refresh-token rotation.
 *
 * PRD 9.2 requires refresh-token rotation. Implementation:
 *   * Each device gets a token *family* (`familyId`).
 *   * Refreshing issues a new token and marks the old one replaced.
 *   * Presenting an already-replaced token means it leaked — the entire family
 *     is revoked, forcing that device to re-authenticate.
 */

import jwt, { type SignOptions } from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { DataScope, JwtPayload, Role } from '@erp/shared';
import { env } from '../../config/env.js';
import { prisma } from '../db/prisma.js';
import { hashToken } from './password.js';
import { AppError } from '../errors/AppError.js';
import { moduleLogger } from '../logger.js';

const log = moduleLogger('auth:tokens');

export interface TokenSubject {
  userId: string;
  role: Role;
  tenantId: string;
  branchId: string | null;
  scope: DataScope;
  sessionId: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Convert `15m` / `7d` / `3600` into seconds. */
function ttlSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])?$/.exec(ttl.trim());
  if (!match) return 900;

  const value = Number(match[1]);
  const unit = match[2] ?? 's';
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (multipliers[unit] ?? 1);
}

export function signAccessToken(subject: TokenSubject): string {
  const payload = {
    sub: subject.userId,
    role: subject.role,
    tenantId: subject.tenantId,
    branchId: subject.branchId,
    scope: subject.scope,
    sid: subject.sessionId,
  };

  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'],
    issuer: 'edusphere-erp',
    audience: 'edusphere-clients',
  };

  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

export function verifyAccessToken(token: string): JwtPayload {
  // Throws TokenExpiredError / JsonWebTokenError, both mapped in errorHandler.
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: 'edusphere-erp',
    audience: 'edusphere-clients',
  }) as JwtPayload;
}

/**
 * Refresh tokens are opaque random strings, not JWTs — they must be revocable,
 * and only their hash is ever stored.
 */
function newRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

export interface DeviceContext {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
  deviceId?: string | undefined;
}

/** Issue a fresh access + refresh pair, starting a new token family. */
export async function issueTokens(
  subject: Omit<TokenSubject, 'sessionId'>,
  device: DeviceContext = {},
): Promise<IssuedTokens> {
  const familyId = crypto.randomUUID();
  return issueForFamily(subject, familyId, device);
}

async function issueForFamily(
  subject: Omit<TokenSubject, 'sessionId'>,
  familyId: string,
  device: DeviceContext,
  replacesHash?: string,
): Promise<IssuedTokens> {
  const refreshToken = newRefreshToken();
  const refreshTtl = ttlSeconds(env.JWT_REFRESH_TTL);

  await prisma.refreshToken.create({
    data: {
      userId: subject.userId,
      familyId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + refreshTtl * 1000),
      userAgent: device.userAgent ?? null,
      ipAddress: device.ipAddress ?? null,
      deviceId: device.deviceId ?? null,
    },
  });

  if (replacesHash) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: replacesHash },
      data: { revokedAt: new Date(), replacedByHash: hashToken(refreshToken) },
    });
  }

  const accessToken = signAccessToken({ ...subject, sessionId: familyId });

  return { accessToken, refreshToken, expiresIn: ttlSeconds(env.JWT_ACCESS_TTL) };
}

/**
 * Exchange a refresh token for a new pair.
 *
 * Reuse detection: a token that was already replaced is presumed stolen, so we
 * revoke every token in its family rather than just rejecting this request.
 */
export async function rotateRefreshToken(
  presentedToken: string,
  device: DeviceContext = {},
): Promise<{ tokens: IssuedTokens; subject: TokenSubject }> {
  const tokenHash = hashToken(presentedToken);

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          role: true,
          scope: true,
          tenantId: true,
          branchId: true,
          status: true,
          deletedAt: true,
        },
      },
    },
  });

  if (!stored) throw AppError.tokenInvalid('Refresh token not recognised');

  if (stored.revokedAt || stored.replacedByHash) {
    log.warn(
      { userId: stored.userId, familyId: stored.familyId },
      'Refresh token reuse detected — revoking family',
    );
    await revokeFamily(stored.familyId);
    throw AppError.tokenInvalid('Session revoked for security reasons. Please sign in again.');
  }

  if (stored.expiresAt < new Date()) {
    throw AppError.tokenExpired();
  }

  const user = stored.user;
  if (user.deletedAt || user.status !== 'ACTIVE') {
    await revokeFamily(stored.familyId);
    throw AppError.accountInactive();
  }

  const subject: TokenSubject = {
    userId: user.id,
    role: user.role,
    tenantId: user.tenantId,
    branchId: user.branchId,
    scope: user.scope,
    sessionId: stored.familyId,
  };

  const tokens = await issueForFamily(subject, stored.familyId, device, tokenHash);
  return { tokens, subject };
}

/** Sign out one device. */
export async function revokeRefreshToken(presentedToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(presentedToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Sign out every device in a token family. */
export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Sign out everywhere — used on password change and account suspension. */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Housekeeping: drop expired/revoked rows. Runs nightly. */
export async function pruneExpiredTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const { count } = await prisma.refreshToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
    },
  });
  return count;
}
