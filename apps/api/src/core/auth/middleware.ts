/**
 * Authentication and authorisation middleware.
 *
 * Order matters and is enforced by construction: `authenticate` populates
 * `req.auth`, and every guard below throws if it is missing, so a route can
 * never be permission-checked without first being authenticated.
 */

import type { Request, RequestHandler } from 'express';
import {
  hasAnyPermission,
  hasPermission,
  type JwtPayload,
  type Permission,
  type Role,
} from '@erp/shared';
import type { RequestAuth } from '../../types/express.js';
import { AppError } from '../errors/AppError.js';
import { verifyAccessToken } from './tokens.js';
import { loadUserContext } from './context.js';

/** Read the bearer token from the Authorization header or an httpOnly cookie. */
function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice(7).trim() || null;
  }
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.['access_token'];
  return cookieToken ?? null;
}

/**
 * Reconcile the tenant in the token with the tenant on the account.
 *
 * Three cases:
 *   * They match — the ordinary path.
 *   * They differ and the token is flagged `pa`, and the user really is a
 *     platform admin — they have opened another school's panel, so the request
 *     runs against that school. Branch scoping is dropped, since their own
 *     branch belongs to a different school entirely.
 *   * Anything else — the account was moved or re-keyed, or the token is
 *     claiming a school it has no right to. Reject it.
 */
function applyActingTenant(
  context: Omit<RequestAuth, 'sessionId'>,
  payload: JwtPayload,
): Omit<RequestAuth, 'sessionId'> {
  if (context.tenantId === payload.tenantId) return context;

  if (payload.pa && context.isPlatformAdmin) {
    return { ...context, tenantId: payload.tenantId, branchId: null };
  }

  throw AppError.tokenInvalid('Token no longer valid for this account');
}

/** Require a valid access token; populates `req.auth`. */
export const authenticate: RequestHandler = (req, _res, next) => {
  void (async () => {
    try {
      const token = extractToken(req);
      if (!token) throw AppError.unauthenticated();

      const payload = verifyAccessToken(token);
      const context = await loadUserContext(payload.sub);

      req.auth = { ...applyActingTenant(context, payload), sessionId: payload.sid };
      next();
    } catch (err) {
      next(err);
    }
  })();
};

/**
 * Populate `req.auth` when a token is present, but allow the request through
 * when it is not. For endpoints with both public and personalised behaviour.
 */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  void (async () => {
    const token = extractToken(req);
    if (!token) return next();

    try {
      const payload = verifyAccessToken(token);
      const context = await loadUserContext(payload.sub);
      req.auth = { ...applyActingTenant(context, payload), sessionId: payload.sid };
    } catch {
      // An invalid token on an optional route is simply ignored.
    }
    next();
  })();
};

/** Assert `req.auth` exists, narrowing the type for callers. */
export function requireAuth(req: Request): NonNullable<Request['auth']> {
  if (!req.auth) throw AppError.unauthenticated();
  return req.auth;
}

/** Require *all* of the listed permissions. */
export function requirePermission(...required: Permission[]): RequestHandler {
  return (req, _res, next) => {
    try {
      const auth = requireAuth(req);
      if (!hasPermission(auth.permissions, required)) {
        throw AppError.insufficientPermissions(required);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Require *at least one* of the listed permissions. */
export function requireAnyPermission(...required: Permission[]): RequestHandler {
  return (req, _res, next) => {
    try {
      const auth = requireAuth(req);
      if (!hasAnyPermission(auth.permissions, required)) {
        throw AppError.insufficientPermissions(required);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Restrict a route to specific roles. Prefer `requirePermission` — this is for
 * the few endpoints that are genuinely role-shaped, such as the driver's
 * trip-start call or the super-admin tenant provisioning screen.
 */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    try {
      const auth = requireAuth(req);
      if (!roles.includes(auth.role)) {
        throw AppError.forbidden(
          `This action is restricted to: ${roles.join(', ')}`,
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Super-admin-only routes (cross-tenant diagnostics inside one school). */
export const requireSuperAdmin: RequestHandler = requireRole('SUPER_ADMIN');

/**
 * Platform-operator routes: creating schools, listing every school, opening
 * another school's panel.
 *
 * Checked against the flag on the account rather than the role, so a school's
 * own Super Admin — who is unrestricted *within* their school — still cannot
 * see or touch anybody else's.
 */
export const requirePlatformAdmin: RequestHandler = (req, _res, next) => {
  try {
    const auth = requireAuth(req);
    if (!auth.isPlatformAdmin) {
      throw AppError.forbidden('This action is restricted to platform administrators');
    }
    next();
  } catch (err) {
    next(err);
  }
};

/** Routes that manage the institution itself. */
export const requireAdmin: RequestHandler = requireRole('SUPER_ADMIN', 'ADMIN');
