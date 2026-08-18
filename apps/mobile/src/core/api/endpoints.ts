/**
 * Every server call the three apps make, in one place.
 *
 * Grouped by module so the mobile surface of the API is auditable at a glance —
 * the same reason `apps/api/src/modules/index.ts` keeps route registration in
 * one file. If a screen needs something that is not here, it belongs here
 * first, not inline in a component.
 */

import type { AuthTokens, AuthUser, LoginResponse } from '@erp/shared';
import { request, requestPaged, type Paged } from './client';
import type {
  AnnouncementRow,
  AssignmentRow,
  AssignmentSubmissionRow,
  BoardingEvent,
  CalendarEventRow,
  ContactRow,
  ConversationRow,
  DashboardPayload,
  InvoiceDetail,
  LoanRow,
  MessageRow,
  MyTrip,
  NotificationPreferences,
  NotificationRow,
  ReportCardRow,
  SafetyAlertRow,
  SessionRow,
  SosResult,
  StudentAttendance,
  StudentFeeSummary,
  StudentLiveView,
  StudentProfile,
  Timetable,
  TripHistoryEntry,
  TripManifest,
} from './types';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const authApi = {
  login: (identifier: string, password: string, deviceId: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { identifier, password, deviceId },
      skipAuth: true,
    }),

  me: () => request<AuthUser>('/auth/me'),

  logout: (refreshToken: string | null) =>
    request<void>('/auth/logout', { method: 'POST', body: { refreshToken } }),

  forgotPassword: (identifier: string) =>
    request<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: { identifier },
      skipAuth: true,
    }),

  changePassword: (currentPassword: string, newPassword: string, confirmPassword: string) =>
    request<{ message: string }>('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword, confirmPassword },
    }),

  sessions: () => request<SessionRow[]>('/auth/sessions'),

  revokeSession: (sessionId: string) =>
    request<void>('/auth/sessions/revoke', { method: 'POST', body: { sessionId } }),

  registerPushToken: (token: string, platform: 'ios' | 'android', deviceName?: string) =>
    request<{ registered: boolean }>('/auth/push-tokens', {
      method: 'POST',
      body: { token, platform, deviceName },
    }),

  removePushToken: (token: string) =>
    request<void>('/auth/push-tokens', { method: 'DELETE', body: { token } }),

  /**
   * PRD §6.3 — location tracking requires explicit, recorded consent, and the
   * record has to survive a reinstall, so it lives server-side rather than in
   * a local flag.
   */
  recordConsent: (
    consentType: 'LOCATION_TRACKING' | 'MARKETING_COMMS' | 'PHOTO_USAGE' | 'DATA_PROCESSING',
    granted: boolean,
    version = '1.0',
  ) =>
    request<{ consentType: string; granted: boolean }>('/auth/consent', {
      method: 'POST',
      body: { consentType, granted, version },
    }),

  refreshTokens: (refreshToken: string, deviceId: string) =>
    request<{ tokens: AuthTokens; user: AuthUser }>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken, deviceId },
      skipAuth: true,
    }),
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const dashboardApi = {
  get: () => request<DashboardPayload>('/dashboard'),
};

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

export const studentApi = {
  profile: (studentId: string) => request<StudentProfile>(`/students/${studentId}`),
};

// ---------------------------------------------------------------------------
// Live GPS & safety
// ---------------------------------------------------------------------------

export const trackingApi = {
  /** The Parent App's primary screen. Every call is written to the access log. */
  studentLive: (studentId: string) =>
    request<StudentLiveView>(`/tracking/student/${studentId}/live`),

  /** PRD §6.1 — 30 days by default, capped by the school's retention window. */
  studentHistory: (studentId: string, days = 30) =>
    request<TripHistoryEntry[]>(`/tracking/student/${studentId}/history`, { query: { days } }),

  /**
   * ⚠️ School-wide safety alerts.
   *
   * `GET /tracking/alerts` filters on `tenantId` only — it is **not** narrowed
   * by data scope, so a PARENT token (which holds `tracking:view`) would be
   * served every alert for every bus in the school, not just the one carrying
   * their child. That is wider than PRD §6.3 allows, so none of these apps
   * calls it for a guardian; the Parent and Driver apps use the per-user
   * notification inbox instead, which is correctly scoped.
   *
   * Kept here for a future staff-facing surface, and flagged so it is not
   * wired up by accident.
   */
  alerts: (page = 1, limit = 25) =>
    requestPaged<SafetyAlertRow>('/tracking/alerts', { query: { page, limit } }),

  raiseSos: (input: {
    latitude: number;
    longitude: number;
    message?: string;
    category?: 'MEDICAL' | 'ACCIDENT' | 'SECURITY' | 'BREAKDOWN' | 'OTHER';
    vehicleId?: string;
    tripId?: string;
    studentId?: string;
  }) => request<SosResult>('/tracking/sos', { method: 'POST', body: input }),

  /** Single position report from the driver app. */
  pushLocation: (input: {
    latitude: number;
    longitude: number;
    speed: number;
    heading: number;
    accuracy?: number;
    altitude?: number;
    recordedAt?: string;
  }) => request<{ accepted: boolean }>('/tracking/location/update', { method: 'POST', body: input }),

  /**
   * Offline flush. Rural routes lose signal (PRD gap analysis: "offline mode
   * for Driver & Teacher apps"), so queued pings go up as one batch and the
   * server replays them in chronological order to keep geofence transitions
   * correct.
   */
  pushLocationBatch: (
    pings: Array<{
      latitude: number;
      longitude: number;
      speed: number;
      heading: number;
      accuracy?: number;
      recordedAt: string;
    }>,
  ) =>
    request<{ accepted: number }>('/tracking/location/batch', {
      method: 'POST',
      body: { pings },
      timeoutMs: 40_000,
    }),
};

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const attendanceApi = {
  forStudent: (studentId: string, range?: { from?: string; to?: string }) =>
    request<StudentAttendance>(`/attendance/student/${studentId}`, {
      query: { from: range?.from, to: range?.to },
    }),
};

// ---------------------------------------------------------------------------
// Examination
// ---------------------------------------------------------------------------

export const examinationApi = {
  reportCards: (studentId: string) =>
    request<ReportCardRow[]>(`/examination/report-cards/student/${studentId}`),

  assignments: (params: {
    page?: number;
    limit?: number;
    classId?: string;
    sectionId?: string;
    subjectId?: string;
  } = {}) => requestPaged<AssignmentRow>('/examination/assignments', { query: params }),

  submitAssignment: (assignmentId: string, body: { content?: string; attachmentUrls: string[] }) =>
    request<AssignmentSubmissionRow>(`/examination/assignments/${assignmentId}/submit`, {
      method: 'POST',
      body,
    }),
};

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

export const feesApi = {
  studentSummary: (studentId: string) =>
    request<StudentFeeSummary>(`/fees/student/${studentId}/summary`),

  invoice: (invoiceId: string) => request<InvoiceDetail>(`/fees/invoices/${invoiceId}`),
};

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export const libraryApi = {
  /**
   * No `studentId` filter is passed: a student's token carries SELF scope and a
   * guardian's carries CHILDREN, and `studentScopeWhere` narrows the query
   * server-side. Passing an id here would be a hint, never a control.
   */
  myLoans: (page = 1, limit = 50) =>
    requestPaged<LoanRow>('/library/loans', { query: { page, limit } }),

  loansForStudent: (studentId: string, page = 1, limit = 50) =>
    requestPaged<LoanRow>('/library/loans', { query: { page, limit, studentId } }),
};

// ---------------------------------------------------------------------------
// Academic
// ---------------------------------------------------------------------------

export const academicApi = {
  timetable: (sectionId: string) =>
    request<Timetable>('/academic/timetable', { query: { sectionId } }),

  calendar: (from?: string, to?: string) =>
    request<CalendarEventRow[]>('/academic/calendar', { query: { from, to } }),
};

// ---------------------------------------------------------------------------
// Communication
// ---------------------------------------------------------------------------

export const communicationApi = {
  announcements: (page = 1, limit = 20) =>
    requestPaged<AnnouncementRow>('/communication/announcements', { query: { page, limit } }),

  markAnnouncementRead: (id: string) =>
    request<unknown>(`/communication/announcements/${id}/read`, { method: 'POST' }),

  notifications: (page = 1, limit = 30, unreadOnly = false) =>
    requestPaged<NotificationRow>('/communication/notifications', {
      query: { page, limit, unread: unreadOnly ? 'true' : undefined },
    }),

  markNotificationsRead: (ids?: string[]) =>
    request<void>('/communication/notifications/read', {
      method: 'POST',
      body: ids ? { ids } : {},
    }),

  preferences: () => request<NotificationPreferences>('/communication/preferences'),

  updatePreferences: (prefs: Partial<NotificationPreferences>) =>
    request<NotificationPreferences>('/communication/preferences', { method: 'PUT', body: prefs }),

  contacts: () => request<ContactRow[]>('/communication/contacts'),

  conversations: () => request<ConversationRow[]>('/communication/conversations'),

  startConversation: (participantUserIds: string[], studentId?: string) =>
    request<{ id: string }>('/communication/conversations', {
      method: 'POST',
      body: { participantUserIds, studentId, type: 'DIRECT' },
    }),

  messages: (conversationId: string, page = 1, limit = 40) =>
    requestPaged<MessageRow>(`/communication/conversations/${conversationId}/messages`, {
      query: { page, limit },
    }),

  sendMessage: (conversationId: string, body: string, attachmentUrls: string[] = []) =>
    request<MessageRow>(`/communication/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: { body, messageType: 'TEXT', attachmentUrls },
    }),

  /** Joins the socket room so replies arrive without a refetch. */
  subscribeConversation: (conversationId: string) =>
    request<unknown>(`/communication/conversations/${conversationId}/subscribe`, {
      method: 'POST',
    }),
};

// ---------------------------------------------------------------------------
// Transport (driver)
// ---------------------------------------------------------------------------

export const transportApi = {
  myTrip: () => request<MyTrip | null>('/transport/my-trip'),

  /**
   * No `vehicleId`: the server takes it from the route's assignment, so a
   * driver cannot start a trip against a bus they were not given.
   */
  startTrip: (body: {
    routeId: string;
    direction: 'PICKUP' | 'DROP';
    startOdometerKm?: number;
  }) => request<MyTrip>('/transport/trips/start', { method: 'POST', body }),

  endTrip: (tripId: string, endOdometerKm?: number) =>
    request<unknown>(`/transport/trips/${tripId}/end`, {
      method: 'POST',
      body: { endOdometerKm },
    }),

  manifest: (tripId: string) => request<TripManifest>(`/transport/trips/${tripId}/manifest`),

  recordBoarding: (
    tripId: string,
    body: {
      studentId: string;
      event: BoardingEvent;
      stopId?: string;
      latitude?: number;
      longitude?: number;
      method?: 'MANUAL' | 'RFID' | 'QR' | 'FACE';
    },
  ) => request<unknown>(`/transport/trips/${tripId}/boarding`, { method: 'POST', body }),

  routes: () => request<Array<{ id: string; name: string; vehicleId: string | null }>>('/transport/routes'),
};

export type { Paged };
