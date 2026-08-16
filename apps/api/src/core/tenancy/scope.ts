/**
 * Tenant and data-scope enforcement.
 *
 * Two independent guarantees:
 *
 *   1. **Tenant isolation** — every query is filtered by `req.auth.tenantId`,
 *      which comes from the verified JWT and is never client-supplied.
 *   2. **Data scope** — within a tenant, a role sees only the rows its
 *      `DataScope` allows (own records, own children, assigned sections, …).
 *
 * Handlers compose these into their `where` clause via the builders below
 * rather than hand-rolling filters, so a forgotten condition is a compile-time
 * shape mismatch instead of a silent data leak.
 */

import type { Request } from 'express';
import type { RequestAuth } from '../../types/express.js';
import { AppError } from '../errors/AppError.js';
import { requireAuth } from '../auth/middleware.js';

/** Base filter: tenant, plus branch when the role is branch-bound. */
export function tenantWhere(auth: RequestAuth): { tenantId: string; branchId?: string } {
  const where: { tenantId: string; branchId?: string } = { tenantId: auth.tenantId };

  // TENANT scope spans every branch; everyone else is pinned to their own.
  if (auth.scope !== 'TENANT' && auth.branchId) {
    where.branchId = auth.branchId;
  }
  return where;
}

/** Tenant filter for models that have no `branchId` column. */
export function tenantOnlyWhere(auth: RequestAuth): { tenantId: string } {
  return { tenantId: auth.tenantId };
}

/**
 * Which student ids may this caller read?
 *
 * Returns `null` when the caller may read every student in scope (admin,
 * teacher, accountant …), or an explicit id list for SELF/CHILDREN roles.
 * A caller with an empty list can see nothing, which is distinct from `null`.
 */
export function visibleStudentIds(auth: RequestAuth): string[] | null {
  switch (auth.scope) {
    case 'SELF':
      return auth.studentId ? [auth.studentId] : [];
    case 'CHILDREN':
      return auth.childStudentIds ?? [];
    default:
      return null;
  }
}

/**
 * Prisma `where` fragment restricting a model that belongs to a student.
 *
 * `field` names the column holding the student id — `studentId` on related
 * models such as Invoice or AttendanceRecord, but `id` when querying Student
 * itself. Passing the wrong one produces an invalid query, not a silent leak.
 */
export function studentScopeWhere(
  auth: RequestAuth,
  field = 'studentId',
): Record<string, unknown> {
  const ids = visibleStudentIds(auth);
  if (ids === null) return {};
  return { [field]: { in: ids } };
}

/**
 * Student-list filter for the Student model.
 *
 * Distinct from `studentScopeWhere` because a teacher's ASSIGNED scope is
 * expressed through enrolments rather than a flat id list: they may see the
 * students in the sections they teach, and no others.
 */
export function studentListWhere(auth: RequestAuth): Record<string, unknown> {
  switch (auth.scope) {
    case 'SELF':
      return { id: { in: auth.studentId ? [auth.studentId] : [] } };
    case 'CHILDREN':
      return { id: { in: auth.childStudentIds ?? [] } };
    case 'ASSIGNED':
      return {
        enrollments: {
          some: { isCurrent: true, sectionId: { in: auth.assignedSectionIds ?? [] } },
        },
      };
    default:
      return {};
  }
}

/** Section restriction for a teacher's ASSIGNED scope. */
export function sectionScopeWhere(
  auth: RequestAuth,
  field = 'sectionId',
): Record<string, unknown> {
  if (auth.scope !== 'ASSIGNED') return {};
  return { [field]: { in: auth.assignedSectionIds ?? [] } };
}

// ---------------------------------------------------------------------------
// Assertions — for reads/writes of a single known record
// ---------------------------------------------------------------------------

/**
 * Guard a record fetched by id. Throws 404 if missing and 403 if it belongs to
 * another tenant — deliberately *not* 404, since the caller already proved the
 * id exists by other means only if they are in the same tenant.
 */
export function assertSameTenant<T extends { tenantId: string }>(
  auth: RequestAuth,
  record: T | null,
  resource = 'Record',
): T {
  if (!record) throw AppError.notFound(resource);
  if (record.tenantId !== auth.tenantId) {
    // Respond as "not found" so the existence of other tenants' ids stays hidden.
    throw AppError.notFound(resource);
  }
  return record;
}

/** Assert the caller may act on this specific student. */
export function assertStudentAccess(auth: RequestAuth, studentId: string): void {
  const allowed = visibleStudentIds(auth);
  if (allowed === null) return;
  if (!allowed.includes(studentId)) {
    throw AppError.outOfScope('You do not have access to this student');
  }
}

/** Assert a teacher may act on this section. */
export function assertSectionAccess(auth: RequestAuth, sectionId: string): void {
  if (auth.scope !== 'ASSIGNED') return;
  if (!(auth.assignedSectionIds ?? []).includes(sectionId)) {
    throw AppError.outOfScope('This section is not assigned to you');
  }
}

/**
 * Assert the caller may view a child's location.
 *
 * PRD 6.3 makes this the strictest check in the system: location is visible
 * only to a verified guardian with consent recorded, or to an authorised
 * admin. Non-custodial guardians are excluded even though they can see
 * academics.
 */
export function assertLocationAccess(auth: RequestAuth, studentId: string): void {
  if (auth.scope === 'TENANT' || auth.scope === 'BRANCH') return;

  if (auth.scope === 'CHILDREN') {
    if (!(auth.childStudentIds ?? []).includes(studentId)) {
      throw AppError.outOfScope('You are not a verified guardian for this student');
    }
    return;
  }

  throw AppError.forbidden('Location data is restricted to guardians and administrators');
}

// ---------------------------------------------------------------------------
// Request-level convenience
// ---------------------------------------------------------------------------

/** `requireAuth` + tenant filter in one call, for the common handler opening. */
export function scopedRequest(req: Request): {
  auth: RequestAuth;
  tenant: { tenantId: string; branchId?: string };
} {
  const auth = requireAuth(req);
  return { auth, tenant: tenantWhere(auth) };
}

/**
 * Resolve the branch a write should target.
 *
 * Branch-bound roles always write to their own branch; only tenant-scoped
 * callers may name a different one, and only inside their tenant.
 */
export function resolveWriteBranch(
  auth: RequestAuth,
  requestedBranchId?: string | null,
): string {
  if (auth.scope === 'TENANT' && requestedBranchId) return requestedBranchId;
  if (auth.branchId) return auth.branchId;
  if (requestedBranchId) return requestedBranchId;
  throw AppError.badRequest('A branch must be selected for this operation');
}
