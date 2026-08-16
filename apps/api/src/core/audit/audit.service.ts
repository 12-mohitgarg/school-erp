/**
 * Append-only audit trail (PRD gap: "Audit log & data-change history").
 *
 * Captures actor, entity, before/after, IP and timestamp for every write.
 * Writes are fire-and-forget: an audit failure must never roll back or block
 * the business operation it is recording, but it is always logged.
 */

import type { Request } from 'express';
import type { ModuleKey } from '@erp/shared';
import { prisma } from '../db/prisma.js';
import { moduleLogger } from '../logger.js';

const log = moduleLogger('audit');

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'RESTORE'
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'PASSWORD_CHANGE'
  | 'PASSWORD_RESET'
  | 'PERMISSION_CHANGE'
  | 'APPROVE'
  | 'REJECT'
  | 'PUBLISH'
  | 'EXPORT'
  | 'IMPORT'
  | 'PAYMENT'
  | 'REFUND'
  | 'LOCATION_VIEW'
  | 'SOS_TRIGGER'
  | 'SOS_ACKNOWLEDGE'
  | 'CONSENT_GRANT'
  | 'CONSENT_REVOKE';

export interface AuditInput {
  tenantId: string;
  actorId?: string | null;
  actorName?: string;
  actorRole?: string | null;
  action: AuditAction;
  module?: ModuleKey | null;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Keys never written to the audit trail. The log is exported for compliance
 * review, so it must not become a secondary store of secrets.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
  'tokenHash',
  'authToken',
  'otpHash',
  'twoFactorSecret',
  'credentials',
  'gatewaySignature',
  'aadhaarNumber',
  'bankAccountNo',
]);

/** Deep-clone a payload, replacing sensitive values with a marker. */
function sanitise(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  // Bound recursion so a cyclic or pathologically nested object cannot hang us.
  if (depth > 6) return '[Truncated]';

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((v) => sanitise(v, depth + 1));
  }

  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k) ? '[Redacted]' : sanitise(v, depth + 1);
    }
    return out;
  }

  if (typeof value === 'bigint') return value.toString();
  return value;
}

/**
 * Record an audit entry. Never throws — callers should not need a try/catch
 * around a bookkeeping call.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorId: input.actorId ?? null,
        actorName: input.actorName ?? 'System',
        actorRole: (input.actorRole as never) ?? null,
        action: input.action,
        module: input.module ?? null,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        before: (sanitise(input.before) as never) ?? undefined,
        after: (sanitise(input.after) as never) ?? undefined,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        requestId: input.requestId ?? null,
      },
    });
  } catch (err) {
    log.error({ err, entityType: input.entityType, action: input.action }, 'Audit write failed');
  }
}

/**
 * Audit an action using the request for actor and network context — the form
 * used by nearly every controller.
 */
export async function auditFromRequest(
  req: Request,
  input: Omit<AuditInput, 'tenantId' | 'actorId' | 'actorName' | 'actorRole' | 'ipAddress' | 'userAgent' | 'requestId'>,
): Promise<void> {
  const auth = req.auth;
  if (!auth) return;

  await recordAudit({
    ...input,
    tenantId: auth.tenantId,
    actorId: auth.userId,
    actorName: auth.fullName,
    actorRole: auth.role,
    ipAddress: clientIp(req),
    userAgent: req.headers['user-agent'] ?? null,
    requestId: req.requestId,
  });
}

/** Best-effort client IP, honouring a trusted proxy's X-Forwarded-For. */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? null;
  }
  return req.ip ?? req.socket.remoteAddress ?? null;
}

/**
 * Diff two records down to the fields that actually changed, so the audit
 * trail stores a meaningful delta rather than two full row snapshots.
 */
export function diffRecords<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T> } | null {
  const changedBefore: Partial<T> = {};
  const changedAfter: Partial<T> = {};
  let changed = false;

  for (const [key, newValue] of Object.entries(after) as Array<[keyof T, unknown]>) {
    if (newValue === undefined) continue;

    const oldValue = before[key];
    // Compare by serialised form so Dates and Decimals compare by value.
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changedBefore[key] = oldValue;
      changedAfter[key] = newValue as T[keyof T];
      changed = true;
    }
  }

  return changed ? { before: changedBefore, after: changedAfter } : null;
}

/**
 * Log a location view (PRD 6.3). Written to the dedicated access log *and*
 * the audit trail, because auditors ask for both views.
 */
export async function recordLocationView(
  req: Request,
  target: { studentId?: string; vehicleId?: string; purpose: string },
): Promise<void> {
  const auth = req.auth;
  if (!auth) return;

  try {
    await prisma.locationAccessLog.create({
      data: {
        viewerId: auth.userId,
        studentId: target.studentId ?? null,
        vehicleId: target.vehicleId ?? null,
        purpose: target.purpose,
        ipAddress: clientIp(req),
      },
    });
  } catch (err) {
    log.error({ err }, 'Location access log write failed');
  }

  await auditFromRequest(req, {
    action: 'LOCATION_VIEW',
    module: 'tracking',
    entityType: target.studentId ? 'Student' : 'Vehicle',
    entityId: target.studentId ?? target.vehicleId ?? null,
    after: { purpose: target.purpose },
  });
}
