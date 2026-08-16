/**
 * Tenant isolation and data scope.
 *
 * These builders are what stand between one school's data and another's, and
 * between a parent and somebody else's child. They are pure functions, so they
 * are cheap to test exhaustively — and the cost of one of them being subtly
 * wrong is a cross-school data leak, which is the worst failure this product
 * has.
 */

import { describe, expect, it } from 'vitest';
import type { RequestAuth } from '../../types/express.js';
import {
  assertLocationAccess,
  assertSameTenant,
  assertStudentAccess,
  resolveWriteBranch,
  sectionScopeWhere,
  studentListWhere,
  studentScopeWhere,
  tenantWhere,
  visibleStudentIds,
} from './scope.js';

function auth(overrides: Partial<RequestAuth> = {}): RequestAuth {
  return {
    userId: 'user-1',
    role: 'ADMIN',
    permissions: ['*'],
    scope: 'BRANCH',
    tenantId: 'tenant-a',
    homeTenantId: 'tenant-a',
    branchId: 'branch-1',
    isPlatformAdmin: false,
    sessionId: 'session-1',
    email: 'a@example.com',
    fullName: 'Test User',
    ...overrides,
  };
}

describe('tenantWhere', () => {
  it('always filters by tenant', () => {
    expect(tenantWhere(auth()).tenantId).toBe('tenant-a');
  });

  it('pins a branch-scoped role to its own branch', () => {
    expect(tenantWhere(auth({ scope: 'BRANCH' }))).toEqual({
      tenantId: 'tenant-a',
      branchId: 'branch-1',
    });
  });

  it('lets a tenant-scoped role span every branch', () => {
    const where = tenantWhere(auth({ scope: 'TENANT' }));

    expect(where.tenantId).toBe('tenant-a');
    expect(where.branchId).toBeUndefined();
  });

  it('omits the branch filter when the user has no branch', () => {
    // A platform admin working inside another school has no branch there.
    expect(tenantWhere(auth({ scope: 'BRANCH', branchId: null })).branchId).toBeUndefined();
  });
});

describe('visibleStudentIds', () => {
  it('gives a student only themselves', () => {
    expect(visibleStudentIds(auth({ scope: 'SELF', studentId: 's-1' }))).toEqual(['s-1']);
  });

  it('gives a parent exactly their linked children', () => {
    expect(
      visibleStudentIds(auth({ scope: 'CHILDREN', childStudentIds: ['s-1', 's-2'] })),
    ).toEqual(['s-1', 's-2']);
  });

  it('returns an empty list, not null, for a parent with no links', () => {
    // Empty means "can see nothing"; null means "can see everything". Confusing
    // the two would hand an unlinked guardian the whole school.
    expect(visibleStudentIds(auth({ scope: 'CHILDREN', childStudentIds: [] }))).toEqual([]);
    expect(visibleStudentIds(auth({ scope: 'SELF' }))).toEqual([]);
  });

  it('returns null for staff, meaning unrestricted within the tenant', () => {
    expect(visibleStudentIds(auth({ scope: 'BRANCH' }))).toBeNull();
    expect(visibleStudentIds(auth({ scope: 'TENANT' }))).toBeNull();
  });
});

describe('studentScopeWhere', () => {
  it('adds no restriction for staff', () => {
    expect(studentScopeWhere(auth({ scope: 'BRANCH' }))).toEqual({});
  });

  it('restricts a parent to their children', () => {
    expect(studentScopeWhere(auth({ scope: 'CHILDREN', childStudentIds: ['s-1'] }))).toEqual({
      studentId: { in: ['s-1'] },
    });
  });

  it('produces an impossible filter for an unlinked guardian', () => {
    // `in: []` matches no rows, which is the correct fail-closed outcome.
    expect(studentScopeWhere(auth({ scope: 'CHILDREN', childStudentIds: [] }))).toEqual({
      studentId: { in: [] },
    });
  });

  it('honours a custom column name', () => {
    expect(studentScopeWhere(auth({ scope: 'SELF', studentId: 's-9' }), 'id')).toEqual({
      id: { in: ['s-9'] },
    });
  });
});

describe('studentListWhere', () => {
  it('expresses a teacher’s reach through their assigned sections', () => {
    expect(
      studentListWhere(auth({ scope: 'ASSIGNED', assignedSectionIds: ['sec-1', 'sec-2'] })),
    ).toEqual({
      enrollments: { some: { isCurrent: true, sectionId: { in: ['sec-1', 'sec-2'] } } },
    });
  });

  it('filters a teacher with no allocation down to nothing', () => {
    expect(studentListWhere(auth({ scope: 'ASSIGNED', assignedSectionIds: [] }))).toEqual({
      enrollments: { some: { isCurrent: true, sectionId: { in: [] } } },
    });
  });
});

describe('sectionScopeWhere', () => {
  it('restricts only the ASSIGNED scope', () => {
    expect(sectionScopeWhere(auth({ scope: 'BRANCH' }))).toEqual({});
    expect(sectionScopeWhere(auth({ scope: 'ASSIGNED', assignedSectionIds: ['sec-1'] }))).toEqual({
      sectionId: { in: ['sec-1'] },
    });
  });
});

describe('assertSameTenant', () => {
  it('passes a record from the caller’s own tenant', () => {
    const record = { tenantId: 'tenant-a', id: 'x' };
    expect(assertSameTenant(auth(), record)).toBe(record);
  });

  it('reports another tenant’s record as not found, not forbidden', () => {
    // 403 would confirm the id exists in some other school. 404 leaks nothing.
    expect(() => assertSameTenant(auth(), { tenantId: 'tenant-b' }, 'Student')).toThrowError(
      /not found/i,
    );
  });

  it('rejects a missing record', () => {
    expect(() => assertSameTenant(auth(), null, 'Invoice')).toThrowError(/Invoice/);
  });
});

describe('assertStudentAccess', () => {
  it('lets staff act on any student', () => {
    expect(() => assertStudentAccess(auth({ scope: 'BRANCH' }), 'anyone')).not.toThrow();
  });

  it('blocks a parent from another family’s child', () => {
    const parent = auth({ scope: 'CHILDREN', childStudentIds: ['s-1'] });

    expect(() => assertStudentAccess(parent, 's-1')).not.toThrow();
    expect(() => assertStudentAccess(parent, 's-2')).toThrow();
  });
});

describe('assertLocationAccess', () => {
  it('allows school staff', () => {
    expect(() => assertLocationAccess(auth({ scope: 'TENANT' }), 's-1')).not.toThrow();
    expect(() => assertLocationAccess(auth({ scope: 'BRANCH' }), 's-1')).not.toThrow();
  });

  it('allows a verified guardian for their own child only', () => {
    const parent = auth({ scope: 'CHILDREN', childStudentIds: ['s-1'] });

    expect(() => assertLocationAccess(parent, 's-1')).not.toThrow();
    expect(() => assertLocationAccess(parent, 's-2')).toThrowError(/verified guardian/i);
  });

  it('refuses a student their own location feed', () => {
    // PRD 6.3 limits live location to guardians and administrators; SELF scope
    // is not on that list even for the child themselves.
    expect(() => assertLocationAccess(auth({ scope: 'SELF', studentId: 's-1' }), 's-1')).toThrow();
  });

  it('refuses a teacher, whose ASSIGNED scope is academic, not locational', () => {
    expect(() => assertLocationAccess(auth({ scope: 'ASSIGNED' }), 's-1')).toThrow();
  });
});

describe('resolveWriteBranch', () => {
  it('lets a tenant-scoped caller target a named branch', () => {
    expect(resolveWriteBranch(auth({ scope: 'TENANT' }), 'branch-9')).toBe('branch-9');
  });

  it('ignores a requested branch for a branch-bound caller', () => {
    // Otherwise a branch admin could write into a branch they cannot read.
    expect(resolveWriteBranch(auth({ scope: 'BRANCH' }), 'branch-9')).toBe('branch-1');
  });

  it('throws when no branch can be resolved at all', () => {
    expect(() => resolveWriteBranch(auth({ scope: 'TENANT', branchId: null }))).toThrowError(
      /branch must be selected/i,
    );
  });
});
