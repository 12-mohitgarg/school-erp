/**
 * Resolves the full request context for an authenticated user: effective
 * permissions plus the identity links that bound their data scope.
 *
 * This is on the hot path for every request, so the result is cached in the
 * in-process store and invalidated whenever the user's role, grants or links
 * change.
 */

import { permissionsForRole, type Permission, type Role, type DataScope } from '@erp/shared';
import type { RequestAuth } from '../../types/express.js';
import { prisma } from '../db/prisma.js';
import { cacheGet, cacheSet, keys, store } from '../cache/store.js';
import { AppError } from '../errors/AppError.js';

/** Cached slice of the context — everything except the per-request session id. */
type CachedContext = Omit<RequestAuth, 'sessionId'>;

const CONTEXT_TTL_SECONDS = 300;

/**
 * Effective permissions = role defaults (or a custom role's list),
 * plus per-user grants, minus per-user denials.
 * Denials always win, so revoking access is never overridden by a grant.
 */
function resolvePermissions(
  role: Role,
  customPermissions: string[] | null,
  extra: string[],
  denied: string[],
): string[] {
  const base: string[] = customPermissions ?? (permissionsForRole(role) as Permission[]);

  // A wildcard base (super admin) still honours explicit denials.
  const granted = new Set<string>([...base, ...extra]);
  for (const d of denied) granted.delete(d);

  return [...granted];
}

/**
 * Load and cache the user's context. Throws if the account is no longer
 * usable, so a suspended user's live token stops working within the cache TTL.
 */
export async function loadUserContext(userId: string): Promise<CachedContext> {
  const cacheKey = keys.userPermissions(userId);
  const hit = await cacheGet<CachedContext>(cacheKey);
  if (hit) return hit;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      scope: true,
      tenantId: true,
      branchId: true,
      status: true,
      deletedAt: true,
      isPlatformAdmin: true,
      extraPermissions: true,
      deniedPermissions: true,
      customRole: { select: { permissions: true, scope: true } },
      student: { select: { id: true } },
      employee: { select: { id: true } },
      guardian: {
        select: {
          id: true,
          studentLinks: {
            select: { studentId: true, canViewLocation: true, custody: true },
          },
        },
      },
    },
  });

  if (!user || user.deletedAt) throw AppError.unauthenticated('Account no longer exists');
  if (user.status !== 'ACTIVE') throw AppError.accountInactive();

  const permissions = resolvePermissions(
    user.role,
    user.customRole?.permissions ?? null,
    user.extraPermissions,
    user.deniedPermissions,
  );

  const context: CachedContext = {
    userId: user.id,
    role: user.role,
    permissions,
    scope: (user.customRole?.scope ?? user.scope) as DataScope,
    tenantId: user.tenantId,
    homeTenantId: user.tenantId,
    branchId: user.branchId,
    isPlatformAdmin: user.isPlatformAdmin,
    email: user.email,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
  };

  if (user.student) context.studentId = user.student.id;
  if (user.employee) context.employeeId = user.employee.id;

  if (user.guardian) {
    context.guardianId = user.guardian.id;
    context.childStudentIds = user.guardian.studentLinks.map((l) => l.studentId);
  }

  // A teacher's ASSIGNED scope is defined by the sections they own or teach.
  if (user.employee && user.role === 'TEACHER') {
    context.assignedSectionIds = await loadTeacherSections(user.employee.id);
  }

  await cacheSet(cacheKey, context, CONTEXT_TTL_SECONDS);
  return context;
}

/** Sections a teacher can act on: homeroom sections + subject allocations. */
async function loadTeacherSections(employeeId: string): Promise<string[]> {
  const [homeroom, subjectAllocations] = await Promise.all([
    prisma.section.findMany({
      where: { classTeacherId: employeeId },
      select: { id: true },
    }),
    prisma.classSubject.findMany({
      where: { teacherId: employeeId, sectionId: { not: null } },
      select: { sectionId: true },
    }),
  ]);

  const ids = new Set<string>(homeroom.map((s) => s.id));
  for (const cs of subjectAllocations) {
    if (cs.sectionId) ids.add(cs.sectionId);
  }
  return [...ids];
}

/**
 * Drop a user's cached context. Call after any change to their role,
 * permissions, guardian links or teaching allocations.
 */
export async function invalidateUserContext(userId: string): Promise<void> {
  await store.del(keys.userPermissions(userId));
}

/** Bulk invalidation, e.g. after editing a custom role that many users hold. */
export async function invalidateManyContexts(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const pipeline = store.pipeline();
  for (const id of userIds) pipeline.del(keys.userPermissions(id));
  await pipeline.exec();
}
