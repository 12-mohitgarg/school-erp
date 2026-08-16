import type { Request, Response } from 'express';
import { asyncHandler, ok, created, noContent } from '../../core/http/respond.js';
import { requireAuth } from '../../core/auth/middleware.js';
import { AppError } from '../../core/errors/AppError.js';
import { clientIp, auditFromRequest } from '../../core/audit/audit.service.js';
import { rotateRefreshToken, revokeRefreshToken, revokeFamily } from '../../core/auth/tokens.js';
import { isProduction } from '../../config/env.js';
import * as authService from './auth.service.js';

/** Device fingerprint used to scope a refresh-token family. */
function deviceContext(req: Request) {
  return {
    userAgent: req.headers['user-agent'],
    ipAddress: clientIp(req) ?? undefined,
    deviceId: (req.body as { deviceId?: string })?.deviceId,
  };
}

/**
 * Refresh tokens are also set as an httpOnly cookie so the web app never has
 * to store them in JavaScript-readable storage. Mobile clients ignore the
 * cookie and use the body value instead.
 */
function setRefreshCookie(res: Response, token: string): void {
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie('refresh_token', { path: '/' });
}

export const login = asyncHandler(async (req, res) => {
  const { identifier, password } = req.body as { identifier: string; password: string };

  const result = await authService.login(identifier, password, deviceContext(req));

  setRefreshCookie(res, result.tokens.refreshToken);
  return ok(res, result);
});

export const refresh = asyncHandler(async (req, res) => {
  const presented =
    (req.body as { refreshToken?: string })?.refreshToken ??
    (req.cookies as Record<string, string> | undefined)?.['refresh_token'];

  if (!presented) throw AppError.unauthenticated('No refresh token supplied');

  const { tokens, subject } = await rotateRefreshToken(presented, deviceContext(req));

  setRefreshCookie(res, tokens.refreshToken);

  // The user is returned alongside the tokens so a page reload restores the
  // session in ONE round trip. Fetching the profile separately doubled the
  // time-to-first-paint, which against a hosted database is very visible.
  const user = await authService.getCurrentUser(subject.userId, subject.tenantId);

  return ok(res, { tokens: { ...tokens, tokenType: 'Bearer' as const }, user });
});

export const logout = asyncHandler(async (req, res) => {
  const presented =
    (req.body as { refreshToken?: string })?.refreshToken ??
    (req.cookies as Record<string, string> | undefined)?.['refresh_token'];

  if (presented) await revokeRefreshToken(presented);

  if (req.auth) {
    await auditFromRequest(req, { action: 'LOGOUT', entityType: 'User', entityId: req.auth.userId });
  }

  clearRefreshCookie(res);
  return noContent(res);
});

export const me = asyncHandler(async (req, res) => {
  const auth = requireAuth(req);
  return ok(res, await authService.getCurrentUser(auth.userId, auth.tenantId));
});

export const changePassword = asyncHandler(async (req, res) => {
  const auth = requireAuth(req);
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };

  await authService.changePassword(auth.userId, currentPassword, newPassword);
  clearRefreshCookie(res);

  return ok(res, { message: 'Password updated. Please sign in again.' });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { identifier } = req.body as { identifier: string };
  await authService.requestPasswordReset(identifier);

  // Always the same response, regardless of whether the account exists.
  return ok(res, {
    message: 'If an account matches, a reset link has been sent.',
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body as { token: string; newPassword: string };
  await authService.resetPassword(token, newPassword);
  return ok(res, { message: 'Password reset. You can now sign in.' });
});

export const listSessions = asyncHandler(async (req, res) => {
  const auth = requireAuth(req);
  return ok(res, await authService.listSessions(auth.userId, auth.sessionId));
});

export const revokeSession = asyncHandler(async (req, res) => {
  requireAuth(req);
  const { sessionId } = req.body as { sessionId: string };
  await revokeFamily(sessionId);
  return noContent(res);
});

export const registerPushToken = asyncHandler(async (req, res) => {
  const auth = requireAuth(req);
  const { token, platform, deviceName } = req.body as {
    token: string;
    platform: string;
    deviceName?: string;
  };

  await authService.registerPushToken(auth.userId, token, platform, deviceName);
  return created(res, { registered: true });
});

export const removePushToken = asyncHandler(async (req, res) => {
  requireAuth(req);
  const { token } = req.body as { token: string };
  await authService.removePushToken(token);
  return noContent(res);
});

export const recordConsent = asyncHandler(async (req, res) => {
  const auth = requireAuth(req);
  const { consentType, granted, version } = req.body as {
    consentType: string;
    granted: boolean;
    version: string;
  };

  await authService.recordConsent(auth.userId, consentType, granted, version, clientIp(req));
  return ok(res, { consentType, granted });
});

export const roleCatalogue = asyncHandler(async (_req, res) => {
  return ok(res, authService.roleCatalogue());
});
