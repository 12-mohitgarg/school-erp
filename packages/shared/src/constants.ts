/** Domain enums and tunables shared by the API, web app and mobile apps. */

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const ATTENDANCE_STATUS = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  LATE: 'LATE',
  HALF_DAY: 'HALF_DAY',
  EXCUSED: 'EXCUSED',
  HOLIDAY: 'HOLIDAY',
} as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUS)[keyof typeof ATTENDANCE_STATUS];

/** PRD 5.3: attendance may originate from any of these sources. */
export const ATTENDANCE_SOURCE = {
  TEACHER: 'TEACHER',
  ADMIN: 'ADMIN',
  BIOMETRIC: 'BIOMETRIC',
  RFID: 'RFID',
  GPS_GATE: 'GPS_GATE',
  BUS_BOARDING: 'BUS_BOARDING',
  SELF: 'SELF',
} as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCE)[keyof typeof ATTENDANCE_SOURCE];

// ---------------------------------------------------------------------------
// Fees & payments
// ---------------------------------------------------------------------------

export const INVOICE_STATUS = {
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

export const PAYMENT_MODE = {
  UPI: 'UPI',
  CARD: 'CARD',
  NETBANKING: 'NETBANKING',
  WALLET: 'WALLET',
  CASH: 'CASH',
  CHEQUE: 'CHEQUE',
  BANK_TRANSFER: 'BANK_TRANSFER',
} as const;
export type PaymentMode = (typeof PAYMENT_MODE)[keyof typeof PAYMENT_MODE];

export const PAYMENT_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const PAYMENT_GATEWAY = {
  RAZORPAY: 'RAZORPAY',
  STRIPE: 'STRIPE',
  PAYU: 'PAYU',
  OFFLINE: 'OFFLINE',
} as const;
export type PaymentGateway = (typeof PAYMENT_GATEWAY)[keyof typeof PAYMENT_GATEWAY];

/** Indian GST slabs — education services are commonly exempt, hence 0 first. */
export const GST_RATES = [0, 5, 12, 18, 28] as const;

// ---------------------------------------------------------------------------
// Examination
// ---------------------------------------------------------------------------

export const GRADING_SYSTEM = {
  PERCENTAGE: 'PERCENTAGE',
  GPA: 'GPA',
  CCE: 'CCE',
  LETTER: 'LETTER',
} as const;
export type GradingSystem = (typeof GRADING_SYSTEM)[keyof typeof GRADING_SYSTEM];

export const EXAM_STATUS = {
  SCHEDULED: 'SCHEDULED',
  ONGOING: 'ONGOING',
  EVALUATION: 'EVALUATION',
  PUBLISHED: 'PUBLISHED',
  CANCELLED: 'CANCELLED',
} as const;
export type ExamStatus = (typeof EXAM_STATUS)[keyof typeof EXAM_STATUS];

// ---------------------------------------------------------------------------
// Live GPS & safety
// ---------------------------------------------------------------------------

/** PRD 6.1: devices report every 10-15 seconds. */
export const GPS_PING_INTERVAL_SECONDS = 12;
/** PRD 6.3: default location retention window. */
export const DEFAULT_LOCATION_RETENTION_DAYS = 30;
/** PRD gap analysis: alert when a vehicle exceeds a safe speed limit. */
export const DEFAULT_SPEED_LIMIT_KMPH = 40;
/** Metres a vehicle may stray from its route polyline before a deviation alert. */
export const DEFAULT_ROUTE_DEVIATION_METERS = 150;

export const GEOFENCE_TYPE = {
  SCHOOL: 'SCHOOL',
  HOME: 'HOME',
  BUS_STOP: 'BUS_STOP',
  RESTRICTED: 'RESTRICTED',
} as const;
export type GeofenceType = (typeof GEOFENCE_TYPE)[keyof typeof GEOFENCE_TYPE];

export const GEOFENCE_EVENT_TYPE = {
  ENTRY: 'ENTRY',
  EXIT: 'EXIT',
} as const;
export type GeofenceEventType =
  (typeof GEOFENCE_EVENT_TYPE)[keyof typeof GEOFENCE_EVENT_TYPE];

export const TRIP_STATUS = {
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type TripStatus = (typeof TRIP_STATUS)[keyof typeof TRIP_STATUS];

export const SOS_STATUS = {
  ACTIVE: 'ACTIVE',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED: 'RESOLVED',
  FALSE_ALARM: 'FALSE_ALARM',
} as const;
export type SosStatus = (typeof SOS_STATUS)[keyof typeof SOS_STATUS];

export const ALERT_TYPE = {
  ROUTE_DEVIATION: 'ROUTE_DEVIATION',
  OVERSPEED: 'OVERSPEED',
  GEOFENCE_ENTRY: 'GEOFENCE_ENTRY',
  GEOFENCE_EXIT: 'GEOFENCE_EXIT',
  SOS: 'SOS',
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',
  HARSH_BRAKING: 'HARSH_BRAKING',
} as const;
export type AlertType = (typeof ALERT_TYPE)[keyof typeof ALERT_TYPE];

// ---------------------------------------------------------------------------
// Communication
// ---------------------------------------------------------------------------

export const NOTIFICATION_CHANNEL = {
  IN_APP: 'IN_APP',
  PUSH: 'PUSH',
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  WHATSAPP: 'WHATSAPP',
} as const;
export type NotificationChannel =
  (typeof NOTIFICATION_CHANNEL)[keyof typeof NOTIFICATION_CHANNEL];

export const NOTIFICATION_PRIORITY = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  /** Bypasses quiet hours and channel preferences (PRD: SOS override). */
  EMERGENCY: 'EMERGENCY',
} as const;
export type NotificationPriority =
  (typeof NOTIFICATION_PRIORITY)[keyof typeof NOTIFICATION_PRIORITY];

export const AUDIENCE_TYPE = {
  INSTITUTION: 'INSTITUTION',
  BRANCH: 'BRANCH',
  CLASS: 'CLASS',
  SECTION: 'SECTION',
  ROLE: 'ROLE',
  INDIVIDUAL: 'INDIVIDUAL',
} as const;
export type AudienceType = (typeof AUDIENCE_TYPE)[keyof typeof AUDIENCE_TYPE];

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------

export const LEAVE_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type LeaveStatus = (typeof LEAVE_STATUS)[keyof typeof LEAVE_STATUS];

export const EMPLOYMENT_TYPE = {
  FULL_TIME: 'FULL_TIME',
  PART_TIME: 'PART_TIME',
  CONTRACT: 'CONTRACT',
  VISITING: 'VISITING',
  INTERN: 'INTERN',
} as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPE)[keyof typeof EMPLOYMENT_TYPE];

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export const LOAN_STATUS = {
  ISSUED: 'ISSUED',
  RETURNED: 'RETURNED',
  OVERDUE: 'OVERDUE',
  LOST: 'LOST',
  RESERVED: 'RESERVED',
} as const;
export type LoanStatus = (typeof LOAN_STATUS)[keyof typeof LOAN_STATUS];

export const DEFAULT_LOAN_DAYS = 14;
export const DEFAULT_FINE_PER_DAY = 2;
export const DEFAULT_MAX_BOOKS_PER_STUDENT = 3;

// ---------------------------------------------------------------------------
// Students & guardians
// ---------------------------------------------------------------------------

export const STUDENT_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  GRADUATED: 'GRADUATED',
  TRANSFERRED: 'TRANSFERRED',
  SUSPENDED: 'SUSPENDED',
  ALUMNI: 'ALUMNI',
} as const;
export type StudentStatus = (typeof STUDENT_STATUS)[keyof typeof STUDENT_STATUS];

export const ADMISSION_STATUS = {
  ENQUIRY: 'ENQUIRY',
  APPLIED: 'APPLIED',
  DOCUMENTS_PENDING: 'DOCUMENTS_PENDING',
  VERIFIED: 'VERIFIED',
  APPROVED: 'APPROVED',
  ENROLLED: 'ENROLLED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
} as const;
export type AdmissionStatus = (typeof ADMISSION_STATUS)[keyof typeof ADMISSION_STATUS];

/** PRD gap: primary vs secondary guardian, with restricted non-custodial access. */
export const GUARDIAN_RELATION = {
  FATHER: 'FATHER',
  MOTHER: 'MOTHER',
  GUARDIAN: 'GUARDIAN',
  GRANDPARENT: 'GRANDPARENT',
  SIBLING: 'SIBLING',
  OTHER: 'OTHER',
} as const;
export type GuardianRelation = (typeof GUARDIAN_RELATION)[keyof typeof GUARDIAN_RELATION];

export const CUSTODY_TYPE = {
  PRIMARY: 'PRIMARY',
  SECONDARY: 'SECONDARY',
  /** Restricted-access mode: no location visibility, read-only academics. */
  NON_CUSTODIAL: 'NON_CUSTODIAL',
} as const;
export type CustodyType = (typeof CUSTODY_TYPE)[keyof typeof CUSTODY_TYPE];

// ---------------------------------------------------------------------------
// Platform tunables
// ---------------------------------------------------------------------------

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 25,
  MAX_LIMIT: 200,
} as const;

export const TOKEN_TTL = {
  /** Short-lived access token. */
  ACCESS: '15m',
  /** Rotated on every refresh (PRD 9.2). */
  REFRESH: '7d',
  /** Guardian invite / password reset links. */
  INVITE: '48h',
} as const;

export const UPLOAD_LIMITS = {
  MAX_FILE_BYTES: 25 * 1024 * 1024,
  ALLOWED_DOCUMENT_TYPES: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
} as const;

/** PRD gap: WCAG 2.1 AA + multi-language UI with RTL support. */
export const SUPPORTED_LOCALES = ['en', 'hi', 'mr', 'ta', 'te', 'bn', 'ur', 'ar'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const RTL_LOCALES: Locale[] = ['ur', 'ar'];
