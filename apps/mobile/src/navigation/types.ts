/**
 * Navigation contracts.
 *
 * Each role gets its own param list rather than one shared union, so a screen
 * can only be pushed from a tree that actually contains it — a driver build
 * cannot navigate to `Fees`, and TypeScript says so at the call site rather
 * than the app crashing at runtime.
 */

import type { NavigatorScreenParams } from '@react-navigation/native';

// ---------------------------------------------------------------------------
// Parent
// ---------------------------------------------------------------------------

export type ParentTabParamList = {
  Home: undefined;
  Tracking: undefined;
  Fees: undefined;
  Messages: undefined;
  More: undefined;
};

export type ParentStackParamList = {
  Tabs: NavigatorScreenParams<ParentTabParamList>;
  Attendance: undefined;
  Results: undefined;
  Homework: undefined;
  AssignmentDetail: { assignmentId: string };
  InvoiceDetail: { invoiceId: string };
  TripHistory: undefined;
  Announcements: undefined;
  Notifications: undefined;
  ChatThread: { conversationId: string; title: string };
  Library: undefined;
  Timetable: undefined;
  Settings: undefined;
  ChangePassword: undefined;
  Sessions: undefined;
  Privacy: undefined;
};

// ---------------------------------------------------------------------------
// Student
// ---------------------------------------------------------------------------

export type StudentTabParamList = {
  Home: undefined;
  Timetable: undefined;
  Homework: undefined;
  Results: undefined;
  More: undefined;
};

export type StudentStackParamList = {
  Tabs: NavigatorScreenParams<StudentTabParamList>;
  AssignmentDetail: { assignmentId: string };
  Attendance: undefined;
  Library: undefined;
  Fees: undefined;
  InvoiceDetail: { invoiceId: string };
  Calendar: undefined;
  Announcements: undefined;
  Notifications: undefined;
  Settings: undefined;
  ChangePassword: undefined;
  Sessions: undefined;
  Privacy: undefined;
};

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export type DriverTabParamList = {
  Trip: undefined;
  Manifest: undefined;
  Alerts: undefined;
  More: undefined;
};

export type DriverStackParamList = {
  Tabs: NavigatorScreenParams<DriverTabParamList>;
  Notifications: undefined;
  Settings: undefined;
  ChangePassword: undefined;
  Sessions: undefined;
  Privacy: undefined;
};

/**
 * Routes a push notification's `actionUrl` can deep-link to.
 *
 * The API writes web paths (`/parent/tracking`, `/parent/fees`) into
 * `actionUrl` because the same notification serves both surfaces. The mobile
 * app maps them here rather than teaching the server about two URL schemes.
 */
export const DEEP_LINK_MAP: Record<string, { tab?: string; screen?: string }> = {
  '/parent/tracking': { tab: 'Tracking' },
  '/parent/fees': { tab: 'Fees' },
  '/parent/attendance': { screen: 'Attendance' },
  '/parent/results': { screen: 'Results' },
  '/parent/homework': { screen: 'Homework' },
  '/parent/messages': { tab: 'Messages' },
  '/student/timetable': { tab: 'Timetable' },
  '/student/homework': { tab: 'Homework' },
  '/student/results': { tab: 'Results' },
  '/driver/trip': { tab: 'Trip' },
};
