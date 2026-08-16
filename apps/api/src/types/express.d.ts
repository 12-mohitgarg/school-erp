import type { Role, DataScope } from '@erp/shared';

/**
 * Request context attached by the auth + tenancy middleware. Every downstream
 * handler reads scoping information from here rather than from the body or
 * query string, so a client can never widen its own access.
 */
export interface RequestAuth {
  userId: string;
  role: Role;
  /** Resolved permissions: role defaults + grants - denials. `['*']` for super admin. */
  permissions: string[];
  scope: DataScope;
  tenantId: string;
  branchId: string | null;
  /** Refresh-token family id, for session revocation. */
  sessionId: string;
  email: string | null;
  fullName: string;
  /** Domain identity, populated per role. */
  studentId?: string;
  employeeId?: string;
  guardianId?: string;
  /** Student ids this guardian may read (PARENT scope). */
  childStudentIds?: string[];
  /** Section ids this teacher is assigned to (ASSIGNED scope). */
  assignedSectionIds?: string[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: RequestAuth;
      /** Correlation id echoed in responses and logs. */
      requestId: string;
    }
  }
}

export {};
