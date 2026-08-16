/** Transport-level contracts shared by every client. */

import type { Role, Permission, DataScope, ModuleKey } from './rbac.js';
import type {
  AlertType,
  AttendanceSource,
  AttendanceStatus,
  GeofenceEventType,
  NotificationChannel,
  NotificationPriority,
  SosStatus,
} from './constants.js';

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/** Every successful API response uses this shape. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PaginationMeta & Record<string, unknown>;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    /** Field-level messages for 422 validation failures. */
    details?: Record<string, string[]>;
    /** Correlates a client report with the server log line. */
    requestId?: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface ListQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  avatarUrl: string | null;
  role: Role;
  permissions: Permission[] | ['*'];
  scope: DataScope;
  tenantId: string;
  tenantName: string;
  branchId: string | null;
  branchName: string | null;
  locale: string;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
  /**
   * Platform operator: may create schools and open any school's panel.
   * Drives the school switcher and the Schools nav section.
   */
  isPlatformAdmin: boolean;
  /** Set while a platform admin is working inside a school other than their own. */
  impersonatingTenant?: boolean;
  /** Populated for STUDENT logins. */
  studentId?: string;
  /** Populated for TEACHER / HR / ACCOUNTANT / LIBRARIAN / DRIVER logins. */
  employeeId?: string;
  /** Populated for PARENT logins — the students this guardian may view. */
  children?: LinkedChild[];
}

export interface LinkedChild {
  studentId: string;
  admissionNo: string;
  fullName: string;
  avatarUrl: string | null;
  className: string;
  sectionName: string;
  custody: string;
  /** False for non-custodial guardians — hides the live map. */
  canViewLocation: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface LoginResponse {
  user: AuthUser;
  tokens: AuthTokens;
}

/** Decoded JWT payload. */
export interface JwtPayload {
  sub: string;
  role: Role;
  /**
   * The school this token acts in.
   *
   * Normally identical to the user's home tenant. A platform admin who has
   * opened another school's panel carries that school's id here instead, which
   * is what makes every existing tenant-scoped query resolve to the right
   * school without any handler knowing about impersonation.
   */
  tenantId: string;
  branchId: string | null;
  scope: DataScope;
  /** Refresh-token family id, used to detect token reuse. */
  sid: string;
  /** Present only when `tenantId` differs from the user's home tenant. */
  pa?: true;
  iat: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// Platform (multi-school)
// ---------------------------------------------------------------------------

/** One school as the platform operator sees it. */
export interface SchoolSummary {
  id: string;
  name: string;
  code: string;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  primaryColor: string;
  isActive: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  subscriptionTier: string;
  subscriptionEndsAt: string | null;
  locationRetentionDays: number;
  createdAt: string;
  counts: {
    branches: number;
    students: number;
    staff: number;
    users: number;
    vehicles: number;
  };
  admins: Array<{ id: string; fullName: string; email: string | null; lastLoginAt: string | null }>;
}

// ---------------------------------------------------------------------------
// Live GPS & safety
// ---------------------------------------------------------------------------

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface LocationPing extends GeoPoint {
  /** Ground speed in km/h. */
  speed: number;
  /** Degrees clockwise from true north. */
  heading: number;
  /** Horizontal accuracy in metres. */
  accuracy: number;
  timestamp: string;
}

export interface LiveVehicleState extends LocationPing {
  vehicleId: string;
  registrationNo: string;
  routeId: string | null;
  routeName: string | null;
  tripId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  occupancy: number;
  isMoving: boolean;
  /** Seconds since the last ping — drives the "device offline" badge. */
  staleSeconds: number;
}

export interface StopEta {
  stopId: string;
  stopName: string;
  sequence: number;
  location: GeoPoint;
  /** ISO timestamp of predicted arrival. */
  etaAt: string | null;
  etaMinutes: number | null;
  distanceMeters: number | null;
  reached: boolean;
  reachedAt: string | null;
}

export interface TripSnapshot {
  tripId: string;
  status: string;
  direction: 'PICKUP' | 'DROP';
  startedAt: string | null;
  endedAt: string | null;
  vehicle: LiveVehicleState | null;
  stops: StopEta[];
  /** Encoded polyline of the planned route. */
  routePolyline: string | null;
  /** Actual path travelled so far. */
  travelledPath: GeoPoint[];
}

export interface GeofenceEventPayload {
  eventId: string;
  studentId: string | null;
  vehicleId: string | null;
  geofenceId: string;
  geofenceName: string;
  type: GeofenceEventType;
  location: GeoPoint;
  occurredAt: string;
}

export interface SosPayload {
  alertId: string;
  raisedByUserId: string;
  raisedByName: string;
  raisedByRole: Role;
  vehicleId: string | null;
  studentId: string | null;
  tripId: string | null;
  location: GeoPoint;
  status: SosStatus;
  message: string | null;
  triggeredAt: string;
}

export interface SafetyAlertPayload {
  alertId: string;
  type: AlertType;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  vehicleId: string | null;
  tripId: string | null;
  message: string;
  location: GeoPoint | null;
  occurredAt: string;
}

// ---------------------------------------------------------------------------
// Realtime channel contract
// ---------------------------------------------------------------------------

/**
 * WebSocket event names. Rooms are namespaced as `tenant:{id}`,
 * `vehicle:{id}`, `student:{id}` and `user:{id}` so the server can fan out
 * without leaking data across tenants.
 */
export const WS_EVENTS = {
  // Client -> server
  SUBSCRIBE_VEHICLE: 'subscribe:vehicle',
  SUBSCRIBE_STUDENT: 'subscribe:student',
  /**
   * Watch every vehicle in the school at once — the admin safety dashboard.
   *
   * Separate from SUBSCRIBE_VEHICLE because the authorisation is different:
   * fleet-wide positions go only to staff with tracking access, never to a
   * guardian, who may see the one bus their child is on and nothing else.
   */
  SUBSCRIBE_FLEET: 'subscribe:fleet',
  UNSUBSCRIBE: 'unsubscribe',
  DRIVER_LOCATION: 'driver:location',
  DRIVER_LOCATION_BATCH: 'driver:location:batch',

  // Server -> client
  LOCATION_UPDATE: 'location:update',
  TRIP_UPDATE: 'trip:update',
  ETA_UPDATE: 'eta:update',
  GEOFENCE_EVENT: 'geofence:event',
  SOS_ALERT: 'sos:alert',
  SOS_UPDATE: 'sos:update',
  SAFETY_ALERT: 'safety:alert',
  NOTIFICATION: 'notification:new',
  CHAT_MESSAGE: 'chat:message',
  ATTENDANCE_UPDATE: 'attendance:update',
  ERROR: 'error',
} as const;

export type WsEvent = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotificationPayload {
  id: string;
  title: string;
  body: string;
  channel: NotificationChannel;
  priority: NotificationPriority;
  module: ModuleKey | null;
  /** Deep link into the web/mobile app. */
  actionUrl: string | null;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export interface AttendanceMark {
  studentId: string;
  status: AttendanceStatus;
  source: AttendanceSource;
  remarks?: string;
  /** Minutes late, used by the grace-time rule engine. */
  lateByMinutes?: number;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorName: string;
  actorRole: Role | null;
  action: string;
  module: ModuleKey | null;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

export interface StatCard {
  key: string;
  label: string;
  value: number | string;
  /** Percentage change vs the comparison period. */
  delta?: number;
  trend?: 'up' | 'down' | 'flat';
  format?: 'number' | 'currency' | 'percent';
  hint?: string;
}

export interface TimeSeriesPoint {
  date: string;
  value: number;
  label?: string;
}

export interface DashboardSummary {
  stats: StatCard[];
  series: Record<string, TimeSeriesPoint[]>;
  alerts: SafetyAlertPayload[];
  updatedAt: string;
}
