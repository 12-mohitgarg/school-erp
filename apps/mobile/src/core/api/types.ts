/**
 * Response shapes for the endpoints these three apps consume.
 *
 * The API serves Prisma rows directly, so each interface here mirrors the
 * `select` / `include` clause of the handler that produces it — the file
 * comments name the handler so the two can be checked against each other.
 *
 * Two conventions worth stating once:
 *
 *  * Anything the server can send as `null` is typed `| null`, not optional. A
 *    field that is absent and a field that is present-but-null mean different
 *    things when rendering, and collapsing them is how "—" ends up where a
 *    real zero belonged.
 *  * Decimal columns arrive as **strings** — Prisma serialises them that way so
 *    money never round-trips through a float. They are parsed at the point of
 *    display and nowhere earlier.
 */

import type {
  AttendanceSource,
  AttendanceStatus,
  GeoPoint,
  InvoiceStatus,
  LiveVehicleState,
  LoanStatus,
  NotificationPriority,
  PaymentMode,
  Role,
  StopEta,
  TripStatus,
} from '@erp/shared';

// ---------------------------------------------------------------------------
// Dashboard — dashboard.routes.ts
// ---------------------------------------------------------------------------

export interface DashboardStat {
  key: string;
  label: string;
  value: number | string;
  delta?: number;
  trend?: 'up' | 'down' | 'flat';
  format?: 'number' | 'currency' | 'percent';
  hint?: string;
}

export interface DriverActiveTrip {
  id: string;
  direction: 'PICKUP' | 'DROP';
  startedAt: string | null;
  studentsBoarded: number;
  studentsAlighted: number;
  route: { name: string; _count: { stops: number } };
  vehicle: { registrationNo: string };
}

export interface DashboardPayload {
  stats: DashboardStat[];
  /** Driver dashboard only. */
  activeTrip?: DriverActiveTrip | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Tracking — tracking.service.ts
// ---------------------------------------------------------------------------

/** `getStudentLiveView` returns one of these two shapes, discriminated on `tracked`. */
export interface StudentLiveUntracked {
  tracked: false;
  reason: string;
}

export interface StudentLiveTracked {
  tracked: true;
  route: { id: string; name: string };
  myStop: { id: string; name: string; latitude: number; longitude: number } | null;
  vehicle: LiveVehicleState | null;
  trip: { tripId: string; direction: 'PICKUP' | 'DROP'; startedAt: string | null } | null;
  stops: StopEta[];
  /** Google-encoded polyline of the planned route. */
  routePolyline: string | null;
  travelledPath: GeoPoint[];
}

export type StudentLiveView = StudentLiveTracked | StudentLiveUntracked;

/**
 * Narrow the live view to its tracked branch.
 *
 * A guard function rather than an inline `view?.tracked ? view : null`: with
 * the value arriving as `StudentLiveView | undefined` from React Query, the
 * inline form does not narrow, and every field access downstream then has to
 * be cast — which is exactly how a genuine `tracked: false` response ends up
 * being read as if it had a vehicle.
 */
export function isTracked(view: StudentLiveView | undefined): view is StudentLiveTracked {
  return view?.tracked === true;
}

/** `getStudentTripHistory` — one row per trip, BOARDED/ALIGHTED collapsed. */
export interface TripHistoryEntry {
  tripId: string;
  date: string;
  direction: string;
  boardedAt: string | null;
  alightedAt: string | null;
  routeName: string;
  vehicleNo: string;
}

export interface SafetyAlertRow {
  id: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  details: unknown;
  latitude: number | null;
  longitude: number | null;
  occurredAt: string;
  acknowledgedAt: string | null;
  vehicle: { registrationNo: string } | null;
}

export interface SosResult {
  alertId: string;
  notified?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Attendance — attendance.service.ts `getStudentAttendance`
// ---------------------------------------------------------------------------

export interface AttendanceRecordRow {
  status: AttendanceStatus;
  source: AttendanceSource;
  lateByMinutes: number | null;
  remarks: string | null;
  session: {
    date: string;
    periodNumber: number | null;
    subject: { name: string } | null;
  };
}

export interface StudentAttendance {
  records: AttendanceRecordRow[];
  summary: {
    total: number;
    present: number;
    absent: number;
    late: number;
    halfDay: number;
    excused: number;
    /** LATE counts as attending. */
    attendancePercent: number;
  };
}

// ---------------------------------------------------------------------------
// Examination — examination.routes.ts
// ---------------------------------------------------------------------------

/** One subject's line inside a report card's `subjectResults` JSON column. */
export interface SubjectResult {
  subjectId?: string;
  subjectName: string;
  maxMarks: number;
  obtainedMarks: number;
  grade?: string | null;
  gradePoint?: number | null;
  remarks?: string | null;
}

export interface ReportCardRow {
  id: string;
  studentId: string;
  totalMarks: string | null;
  obtainedMarks: string | null;
  percentage: string | null;
  gpa: string | null;
  grade: string | null;
  rank: number | null;
  remarks: string | null;
  attendancePercentage: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  createdAt: string;
  subjectResults: SubjectResult[] | null;
  examTerm: { name: string; academicYear: { name: string } };
}

export interface AssignmentRow {
  id: string;
  title: string;
  description: string;
  instructions: string | null;
  maxMarks: string;
  assignedOn: string;
  dueAt: string;
  allowLateSubmission: boolean;
  latePenaltyPercent: number;
  status: string;
  attachmentUrls: string[];
  subject: { name: string; colorHex: string };
  class: { name: string };
  section: { name: string } | null;
  teacher: { firstName: string; lastName: string };
  _count: { submissions: number };
}

export interface AssignmentSubmissionRow {
  id: string;
  assignmentId: string;
  studentId: string;
  content: string | null;
  attachmentUrls: string[];
  status: 'PENDING' | 'SUBMITTED' | 'LATE' | 'GRADED' | 'RETURNED';
  submittedAt: string | null;
  marksObtained: string | null;
  feedback: string | null;
}

// ---------------------------------------------------------------------------
// Fees — fees.service.ts `getStudentFeeSummary`
// ---------------------------------------------------------------------------

export interface InvoiceLineRow {
  id: string;
  description: string;
  amount: string;
  feeHead: { name: string } | null;
}

export interface InvoiceRow {
  id: string;
  invoiceNo: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  totalAmount: string;
  paidAmount: string;
  balanceAmount: string;
}

/** `GET /fees/invoices/:id` adds the line items and the student. */
export interface InvoiceDetail extends InvoiceRow {
  taxAmount: string | null;
  discountAmount: string | null;
  notes: string | null;
  lines: InvoiceLineRow[];
  payments: PaymentRow[];
  student: { firstName: string; lastName: string; admissionNo: string };
}

export interface PaymentRow {
  id: string;
  receiptNo: string;
  amount: string;
  mode: PaymentMode;
  paidAt: string | null;
}

export interface StudentFeeSummary {
  invoices: InvoiceRow[];
  recentPayments: PaymentRow[];
  summary: {
    totalBilled: number;
    totalPaid: number;
    outstanding: number;
    overdueCount: number;
    overdueAmount: number;
  };
}

// ---------------------------------------------------------------------------
// Library — library.routes.ts `GET /loans`
// ---------------------------------------------------------------------------

export interface LoanRow {
  id: string;
  issuedAt: string;
  dueAt: string;
  returnedAt: string | null;
  status: LoanStatus;
  fineAmount: string | null;
  finePaid: boolean;
  renewalCount: number;
  bookCopy: {
    accessionNo: string;
    book: { title: string; author: string };
  };
}

// ---------------------------------------------------------------------------
// Academic — academic.service.ts
// ---------------------------------------------------------------------------

export interface TimetableSlotRow {
  id: string;
  dayOfWeek: number;
  periodNumber: number;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  subject: { id: string; name: string; code: string; colorHex: string };
  teacher: { id: string; firstName: string; lastName: string } | null;
  room: { id: string; name: string } | null;
  section: { id: string; name: string; class: { name: string } };
}

/** `getTimetable` returns both the flat list and a 1–7 day-keyed grid. */
export interface Timetable {
  slots: TimetableSlotRow[];
  grid: Record<string, TimetableSlotRow[]>;
}

export interface CalendarEventRow {
  id: string;
  title: string;
  description: string | null;
  type: string;
  startDate: string;
  endDate: string;
  isAllDay: boolean;
  colorHex: string | null;
}

// ---------------------------------------------------------------------------
// Communication — communication.routes.ts
// ---------------------------------------------------------------------------

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  category: string;
  priority: NotificationPriority;
  audienceType: string;
  isPinned: boolean;
  publishAt: string | null;
  expiresAt: string | null;
  attachmentUrls: string[];
  createdAt: string;
  author: { firstName: string; lastName: string; role: Role; avatarUrl: string | null } | null;
}

export interface NotificationRow {
  id: string;
  title: string;
  body: string;
  channel: string;
  priority: NotificationPriority;
  module: string | null;
  actionUrl: string | null;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface ConversationParticipant {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
  avatarUrl: string | null;
}

export interface ConversationRow {
  id: string;
  type: 'DIRECT' | 'GROUP' | 'SUPPORT';
  title: string | null;
  studentId: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  isLocked: boolean;
  unreadCount: number;
  isMuted: boolean;
  participants: ConversationParticipant[];
}

export interface MessageRow {
  id: string;
  conversationId: string;
  body: string;
  messageType: 'TEXT' | 'IMAGE' | 'FILE';
  attachmentUrls: string[];
  createdAt: string;
  sender: ConversationParticipant;
}

/** `GET /contacts` — already narrowed server-side to who this user may message. */
export interface ContactRow {
  userId: string;
  name: string;
  role: string;
  detail: string;
}

export interface NotificationPreferences {
  inAppEnabled: boolean;
  pushEnabled: boolean;
  smsEnabled: boolean;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

// ---------------------------------------------------------------------------
// Transport — transport.routes.ts
// ---------------------------------------------------------------------------

export interface RouteStopRow {
  id: string;
  name: string;
  sequence: number;
  latitude: number;
  longitude: number;
  pickupTime: string | null;
  dropTime: string | null;
  haltSeconds: number | null;
}

/** `GET /transport/my-trip` — null when the driver has no trip running. */
export interface MyTrip {
  id: string;
  tripDate: string;
  direction: 'PICKUP' | 'DROP';
  status: TripStatus;
  startedAt: string | null;
  endedAt: string | null;
  studentsBoarded: number;
  studentsAlighted: number;
  startOdometerKm: string | null;
  route: { id: string; name: string; polyline: string | null; stops: RouteStopRow[] };
  vehicle: { id: string; registrationNo: string; capacity: number };
}

export interface ManifestStudent {
  studentId: string;
  admissionNo: string;
  fullName: string;
  photoUrl: string | null;
  className: string | null;
  sectionName: string | null;
  stop: { id: string; name: string; sequence: number } | null;
  status: 'PENDING' | 'BOARDED' | 'ALIGHTED' | 'ABSENT';
}

export interface TripManifest {
  tripId: string;
  direction: 'PICKUP' | 'DROP';
  students: ManifestStudent[];
}

export type BoardingEvent = 'BOARDED' | 'ALIGHTED' | 'ABSENT';

// ---------------------------------------------------------------------------
// Students — student.service.ts `getStudentProfile`
// ---------------------------------------------------------------------------

export interface EnrollmentRow {
  id: string;
  rollNumber: string | null;
  isCurrent: boolean;
  enrolledOn: string;
  academicYear: { id: string; name: string };
  class: { id: string; name: string };
  section: { id: string; name: string };
}

export interface StudentProfile {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  photoUrl: string | null;
  bloodGroup: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  branch: { id: string; name: string } | null;
  enrollments: EnrollmentRow[];
  transportAllocations: Array<{
    id: string;
    route: { id: string; name: string };
    pickupStop: { id: string; name: string } | null;
    monthlyFare: string | null;
  }>;
  attendance?: { total: number; present: number; percentage: number };
  fees?: { billed: number; paid: number; outstanding: number };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface SessionRow {
  id: string;
  deviceId: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  lastUsedAt: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}
