/**
 * Centralised RBAC definitions.
 *
 * Source of truth for both the API (enforcement) and the web app (navigation +
 * conditional rendering). Derived from the PRD "Panel -> Module Responsibility
 * Matrix" and the RBAC workflow: role -> permission -> module -> data scope -> action.
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  ADMINISTRATION: 'ADMINISTRATION',
  TEACHER: 'TEACHER',
  STUDENT: 'STUDENT',
  PARENT: 'PARENT',
  ACCOUNTANT: 'ACCOUNTANT',
  LIBRARIAN: 'LIBRARIAN',
  DRIVER: 'DRIVER',
  HR: 'HR',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES = Object.values(ROLES) as Role[];

/** Human-readable labels used in the UI. */
export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'School Admin',
  ADMINISTRATION: 'Administration',
  TEACHER: 'Teacher',
  STUDENT: 'Student',
  PARENT: 'Parent / Guardian',
  ACCOUNTANT: 'Accountant',
  LIBRARIAN: 'Librarian',
  DRIVER: 'Bus Driver',
  HR: 'HR Manager',
};

/** Which surface each role primarily uses (PRD: "Web vs Application" chart). */
export const ROLE_SURFACE: Record<Role, 'web' | 'mobile' | 'both'> = {
  SUPER_ADMIN: 'web',
  ADMIN: 'web',
  ADMINISTRATION: 'web',
  TEACHER: 'web',
  ACCOUNTANT: 'web',
  LIBRARIAN: 'web',
  HR: 'web',
  STUDENT: 'both',
  PARENT: 'mobile',
  DRIVER: 'mobile',
};

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export const MODULES = {
  ACADEMIC: 'academic',
  STUDENT: 'student',
  ATTENDANCE: 'attendance',
  EXAMINATION: 'examination',
  FEES: 'fees',
  HR: 'hr',
  LIBRARY: 'library',
  TRANSPORT: 'transport',
  INVENTORY: 'inventory',
  COMMUNICATION: 'communication',
  REPORTS: 'reports',
  TRACKING: 'tracking',
  SETTINGS: 'settings',
} as const;

export type ModuleKey = (typeof MODULES)[keyof typeof MODULES];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  academic: 'Academic Management',
  student: 'Student Management',
  attendance: 'Attendance Management',
  examination: 'Examination Management',
  fees: 'Fees Management',
  hr: 'HR Management',
  library: 'Library Management',
  transport: 'Transport Management',
  inventory: 'Inventory Management',
  communication: 'Communication',
  reports: 'Reports & Analytics',
  tracking: 'Live GPS & Safety',
  settings: 'System Settings',
};

// ---------------------------------------------------------------------------
// Actions & permissions
// ---------------------------------------------------------------------------

export const ACTIONS = {
  VIEW: 'view',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  APPROVE: 'approve',
  EXPORT: 'export',
  /**
   * Self-service write by the subject of the record — a student submitting
   * their own homework, for instance.
   *
   * Kept separate from `create` deliberately: overloading `create` meant a
   * student who could submit an assignment could also *create* exams, terms
   * and assignments, because those routes share the module.
   */
  SUBMIT: 'submit',
  /**
   * Send to an audience rather than an individual. Separate from `create` for
   * the same reason: a parent needs `communication:create` to reply in a chat
   * thread, but must not be able to publish a school-wide announcement.
   */
  BROADCAST: 'broadcast',
} as const;

export type Action = (typeof ACTIONS)[keyof typeof ACTIONS];

/** A permission is always `module:action`, e.g. `attendance:create`. */
export type Permission = `${ModuleKey}:${Action}`;

export const WILDCARD = '*' as const;

export function permission(module: ModuleKey, action: Action): Permission {
  return `${module}:${action}`;
}

/** Every permission the system knows about. */
export const ALL_PERMISSIONS: Permission[] = Object.values(MODULES).flatMap((m) =>
  Object.values(ACTIONS).map((a) => permission(m, a)),
);

// ---------------------------------------------------------------------------
// Data scope
// ---------------------------------------------------------------------------

/**
 * Limits *which rows* a role may touch inside a module it can access.
 * Enforced server-side; the client uses it only for display hints.
 */
export const DATA_SCOPES = {
  /** Entire tenant, across every branch. */
  TENANT: 'TENANT',
  /** Only the branch(es) the user is assigned to. */
  BRANCH: 'BRANCH',
  /** Only classes/subjects/routes explicitly assigned to the user. */
  ASSIGNED: 'ASSIGNED',
  /** Only the user's own records. */
  SELF: 'SELF',
  /** Only records of students linked to this guardian. */
  CHILDREN: 'CHILDREN',
} as const;

export type DataScope = (typeof DATA_SCOPES)[keyof typeof DATA_SCOPES];

// ---------------------------------------------------------------------------
// Role definitions
// ---------------------------------------------------------------------------

export interface RoleDefinition {
  role: Role;
  label: string;
  description: string;
  /** `'*'` grants every permission. */
  permissions: Permission[] | typeof WILDCARD;
  scope: DataScope;
  /** Landing route after login on the web app. */
  homeRoute: string;
}

const crud = (m: ModuleKey): Permission[] => [
  permission(m, 'view'),
  permission(m, 'create'),
  permission(m, 'update'),
  permission(m, 'delete'),
];

const readOnly = (m: ModuleKey): Permission[] => [permission(m, 'view')];

const manage = (m: ModuleKey): Permission[] => [
  ...crud(m),
  permission(m, 'approve'),
  permission(m, 'export'),
  permission(m, 'broadcast'),
];

export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  SUPER_ADMIN: {
    role: ROLES.SUPER_ADMIN,
    label: ROLE_LABELS.SUPER_ADMIN,
    description:
      'System-wide control: RBAC, settings, integrations, security, audit and backup. Unrestricted access to every module.',
    permissions: WILDCARD,
    scope: DATA_SCOPES.TENANT,
    homeRoute: '/',
  },

  ADMIN: {
    role: ROLES.ADMIN,
    label: ROLE_LABELS.ADMIN,
    description:
      'Institution-wide configuration and operations. Full authority over academic year, fee structures and institution policy.',
    permissions: [
      ...manage(MODULES.ACADEMIC),
      ...manage(MODULES.STUDENT),
      ...manage(MODULES.ATTENDANCE),
      ...manage(MODULES.EXAMINATION),
      ...manage(MODULES.FEES),
      ...manage(MODULES.HR),
      ...manage(MODULES.LIBRARY),
      ...manage(MODULES.TRANSPORT),
      ...manage(MODULES.INVENTORY),
      ...manage(MODULES.COMMUNICATION),
      ...manage(MODULES.REPORTS),
      ...manage(MODULES.TRACKING),
      permission(MODULES.SETTINGS, 'view'),
      permission(MODULES.SETTINGS, 'update'),
    ],
    scope: DATA_SCOPES.BRANCH,
    homeRoute: '/',
  },

  ADMINISTRATION: {
    role: ROLES.ADMINISTRATION,
    description:
      'Day-to-day operations: admissions, enrolment, class allocation, document verification, front office, transport allocation and safety follow-up.',
    label: ROLE_LABELS.ADMINISTRATION,
    permissions: [
      ...crud(MODULES.STUDENT),
      ...crud(MODULES.ACADEMIC),
      ...crud(MODULES.ATTENDANCE),
      ...readOnly(MODULES.EXAMINATION),
      ...readOnly(MODULES.FEES),
      ...crud(MODULES.TRANSPORT),
      ...crud(MODULES.COMMUNICATION),
      ...readOnly(MODULES.HR),
      ...readOnly(MODULES.LIBRARY),
      ...crud(MODULES.INVENTORY),
      permission(MODULES.REPORTS, 'view'),
      permission(MODULES.REPORTS, 'export'),
      // Reviews GPS/safety reports for follow-up, but does not configure geofences.
      permission(MODULES.TRACKING, 'view'),
      permission(MODULES.TRACKING, 'export'),
    ],
    scope: DATA_SCOPES.BRANCH,
    homeRoute: '/',
  },

  TEACHER: {
    role: ROLES.TEACHER,
    label: ROLE_LABELS.TEACHER,
    description:
      'Classroom workspace: assigned classes and subjects, lesson plans, attendance, exams, assignments and parent communication.',
    permissions: [
      permission(MODULES.ACADEMIC, 'view'),
      permission(MODULES.ACADEMIC, 'update'),
      permission(MODULES.STUDENT, 'view'),
      ...crud(MODULES.ATTENDANCE),
      ...crud(MODULES.EXAMINATION),
      permission(MODULES.COMMUNICATION, 'view'),
      permission(MODULES.COMMUNICATION, 'create'),
      // Teachers may post to their own classes, not the whole institution;
      // the audience is narrowed server-side by their ASSIGNED scope.
      permission(MODULES.COMMUNICATION, 'broadcast'),
      permission(MODULES.REPORTS, 'view'),
      permission(MODULES.LIBRARY, 'view'),
    ],
    scope: DATA_SCOPES.ASSIGNED,
    homeRoute: '/',
  },

  STUDENT: {
    role: ROLES.STUDENT,
    label: ROLE_LABELS.STUDENT,
    description:
      'Self-service portal: academic content, timetable, assignment submission, results, attendance and library history.',
    permissions: [
      permission(MODULES.ACADEMIC, 'view'),
      permission(MODULES.STUDENT, 'view'),
      permission(MODULES.ATTENDANCE, 'view'),
      permission(MODULES.EXAMINATION, 'view'),
      // Submitting their own homework only. NOT `examination:create`, which
      // would also authorise creating exams, terms and assignments.
      permission(MODULES.EXAMINATION, 'submit'),
      permission(MODULES.FEES, 'view'),
      permission(MODULES.LIBRARY, 'view'),
      permission(MODULES.COMMUNICATION, 'view'),
      permission(MODULES.TRANSPORT, 'view'),
    ],
    scope: DATA_SCOPES.SELF,
    homeRoute: '/',
  },

  PARENT: {
    role: ROLES.PARENT,
    label: ROLE_LABELS.PARENT,
    description:
      "Family trust layer: child's live location, attendance, results, homework, fee dues, announcements and teacher chat.",
    permissions: [
      permission(MODULES.STUDENT, 'view'),
      permission(MODULES.ATTENDANCE, 'view'),
      permission(MODULES.EXAMINATION, 'view'),
      permission(MODULES.ACADEMIC, 'view'),
      // View only. Paying online goes through a gateway checkout route, not
      // `fees:create` — that would also authorise recording arbitrary
      // payments, issuing refunds and granting concessions.
      permission(MODULES.FEES, 'view'),
      permission(MODULES.COMMUNICATION, 'view'),
      // Replying in a parent-teacher thread. NOT `broadcast`, which would let
      // a parent publish a school-wide announcement.
      permission(MODULES.COMMUNICATION, 'create'),
      permission(MODULES.TRANSPORT, 'view'),
      permission(MODULES.TRACKING, 'view'),
      permission(MODULES.LIBRARY, 'view'),
    ],
    scope: DATA_SCOPES.CHILDREN,
    homeRoute: '/',
  },

  ACCOUNTANT: {
    role: ROLES.ACCOUNTANT,
    label: ROLE_LABELS.ACCOUNTANT,
    description:
      'Finance and billing: fee structures, invoices, payments, refunds, concessions, ledgers and financial reports.',
    permissions: [
      ...manage(MODULES.FEES),
      permission(MODULES.STUDENT, 'view'),
      permission(MODULES.TRANSPORT, 'view'),
      permission(MODULES.REPORTS, 'view'),
      permission(MODULES.REPORTS, 'export'),
      permission(MODULES.COMMUNICATION, 'view'),
      permission(MODULES.COMMUNICATION, 'create'),
      permission(MODULES.INVENTORY, 'view'),
    ],
    scope: DATA_SCOPES.BRANCH,
    homeRoute: '/',
  },

  LIBRARIAN: {
    role: ROLES.LIBRARIAN,
    label: ROLE_LABELS.LIBRARIAN,
    description:
      'Library lifecycle: catalogue, stock, issue/return/renew, reservations, fines and usage reports.',
    permissions: [
      ...manage(MODULES.LIBRARY),
      permission(MODULES.STUDENT, 'view'),
      permission(MODULES.HR, 'view'),
      permission(MODULES.REPORTS, 'view'),
      permission(MODULES.REPORTS, 'export'),
      permission(MODULES.COMMUNICATION, 'create'),
    ],
    scope: DATA_SCOPES.BRANCH,
    homeRoute: '/',
  },

  DRIVER: {
    role: ROLES.DRIVER,
    label: ROLE_LABELS.DRIVER,
    description:
      'Transport execution: assigned route and stops, boarding/de-boarding attendance, live GPS broadcast and SOS.',
    permissions: [
      permission(MODULES.TRANSPORT, 'view'),
      permission(MODULES.TRANSPORT, 'update'),
      permission(MODULES.TRACKING, 'view'),
      permission(MODULES.TRACKING, 'create'),
      permission(MODULES.ATTENDANCE, 'create'),
      permission(MODULES.ATTENDANCE, 'view'),
      permission(MODULES.STUDENT, 'view'),
    ],
    scope: DATA_SCOPES.ASSIGNED,
    homeRoute: '/',
  },

  HR: {
    role: ROLES.HR,
    label: ROLE_LABELS.HR,
    description:
      'Employee lifecycle: profiles, departments, attendance, leave approval, payroll, payslips and appraisal.',
    permissions: [
      ...manage(MODULES.HR),
      permission(MODULES.REPORTS, 'view'),
      permission(MODULES.REPORTS, 'export'),
      permission(MODULES.COMMUNICATION, 'view'),
      permission(MODULES.COMMUNICATION, 'create'),
      permission(MODULES.ATTENDANCE, 'view'),
    ],
    scope: DATA_SCOPES.BRANCH,
    homeRoute: '/',
  },
};

// ---------------------------------------------------------------------------
// Evaluation helpers
// ---------------------------------------------------------------------------

/** Resolve the effective permission list for a role. */
export function permissionsForRole(role: Role): Permission[] {
  const def = ROLE_DEFINITIONS[role];
  return def.permissions === WILDCARD ? [...ALL_PERMISSIONS] : def.permissions;
}

/**
 * Does this permission set satisfy `required`?
 *
 * `granted` may contain the wildcard `*` (super admin) or module wildcards such
 * as `fees:*`, both of which short-circuit to true.
 */
export function hasPermission(
  granted: readonly string[],
  required: Permission | Permission[],
): boolean {
  if (granted.includes(WILDCARD)) return true;
  const list = Array.isArray(required) ? required : [required];
  return list.every((req) => {
    if (granted.includes(req)) return true;
    const [mod] = req.split(':');
    return granted.includes(`${mod}:${WILDCARD}`);
  });
}

/** True when the permission set satisfies *at least one* of `required`. */
export function hasAnyPermission(
  granted: readonly string[],
  required: Permission[],
): boolean {
  if (granted.includes(WILDCARD)) return true;
  return required.some((req) => hasPermission(granted, req));
}

/** Modules this permission set can open at all (i.e. has `view` on). */
export function accessibleModules(granted: readonly string[]): ModuleKey[] {
  return (Object.values(MODULES) as ModuleKey[]).filter((m) =>
    hasPermission(granted, permission(m, 'view')),
  );
}

export function scopeForRole(role: Role): DataScope {
  return ROLE_DEFINITIONS[role].scope;
}

export function homeRouteForRole(role: Role): string {
  return ROLE_DEFINITIONS[role].homeRoute;
}

