-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'ADMINISTRATION', 'TEACHER', 'STUDENT', 'PARENT', 'ACCOUNTANT', 'LIBRARIAN', 'DRIVER', 'HR');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_INVITE', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "DataScope" AS ENUM ('TENANT', 'BRANCH', 'ASSIGNED', 'SELF', 'CHILDREN');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED', 'SUSPENDED', 'ALUMNI');

-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('ENQUIRY', 'APPLIED', 'DOCUMENTS_PENDING', 'VERIFIED', 'APPROVED', 'ENROLLED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "GuardianRelation" AS ENUM ('FATHER', 'MOTHER', 'GUARDIAN', 'GRANDPARENT', 'SIBLING', 'OTHER');

-- CreateEnum
CREATE TYPE "CustodyType" AS ENUM ('PRIMARY', 'SECONDARY', 'NON_CUSTODIAL');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'EXCUSED', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('TEACHER', 'ADMIN', 'BIOMETRIC', 'RFID', 'GPS_GATE', 'BUS_BOARDING', 'SELF');

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('SCHEDULED', 'ONGOING', 'EVALUATION', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GradingSystem" AS ENUM ('PERCENTAGE', 'GPA', 'CCE', 'LETTER');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'SUBMITTED', 'LATE', 'GRADED', 'RESUBMIT');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('UPI', 'CARD', 'NETBANKING', 'WALLET', 'CASH', 'CHEQUE', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('RAZORPAY', 'STRIPE', 'PAYU', 'OFFLINE');

-- CreateEnum
CREATE TYPE "ConcessionType" AS ENUM ('SCHOLARSHIP', 'SIBLING', 'STAFF_WARD', 'MERIT', 'NEED_BASED', 'RTE', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'VISITING', 'INTERN');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED', 'RETIRED');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'PROCESSING', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalaryComponentType" AS ENUM ('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ISSUED', 'RETURNED', 'OVERDUE', 'LOST', 'RESERVED');

-- CreateEnum
CREATE TYPE "BookCopyStatus" AS ENUM ('AVAILABLE', 'ISSUED', 'RESERVED', 'DAMAGED', 'LOST', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'INACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "TripDirection" AS ENUM ('PICKUP', 'DROP');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BoardingEvent" AS ENUM ('BOARDED', 'ALIGHTED', 'ABSENT');

-- CreateEnum
CREATE TYPE "GeofenceType" AS ENUM ('SCHOOL', 'HOME', 'BUS_STOP', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "GeofenceShape" AS ENUM ('CIRCLE', 'POLYGON');

-- CreateEnum
CREATE TYPE "GeofenceEventType" AS ENUM ('ENTRY', 'EXIT');

-- CreateEnum
CREATE TYPE "SosStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('ROUTE_DEVIATION', 'OVERSPEED', 'GEOFENCE_ENTRY', 'GEOFENCE_EXIT', 'SOS', 'DEVICE_OFFLINE', 'HARSH_BRAKING');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'PUSH', 'SMS', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "AudienceType" AS ENUM ('INSTITUTION', 'BRANCH', 'CLASS', 'SECTION', 'ROLE', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE', 'ISSUE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('IN_USE', 'IN_STORE', 'UNDER_REPAIR', 'DISPOSED');

-- CreateEnum
CREATE TYPE "IntegrationCategory" AS ENUM ('SMS', 'EMAIL', 'PAYMENT', 'MAPS', 'BIOMETRIC', 'STORAGE', 'PUSH', 'WHATSAPP');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT,
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#4F46E5',
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "postalCode" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "gstin" TEXT,
    "panNumber" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "subscriptionTier" TEXT NOT NULL DEFAULT 'STANDARD',
    "subscriptionEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "principalName" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isHeadOffice" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL,
    "scope" "DataScope" NOT NULL DEFAULT 'SELF',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "extraPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deniedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customRoleId" UUID,
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_roles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "baseRole" "Role" NOT NULL,
    "scope" "DataScope" NOT NULL DEFAULT 'BRANCH',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "deviceId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedByHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "deviceName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actorId" UUID,
    "actorName" TEXT NOT NULL,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "module" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "category" "IntegrationCategory" NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isSandbox" BOOLEAN NOT NULL DEFAULT true,
    "credentials" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastHealthStatus" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "consentType" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "version" TEXT NOT NULL,
    "ipAddress" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_access_logs" (
    "id" UUID NOT NULL,
    "viewerId" UUID NOT NULL,
    "studentId" UUID,
    "vehicleId" UUID,
    "purpose" TEXT NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_years" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "stream" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 40,
    "classTeacherId" UUID,
    "roomId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isElective" BOOLEAN NOT NULL DEFAULT false,
    "hasPractical" BOOLEAN NOT NULL DEFAULT false,
    "credits" INTEGER NOT NULL DEFAULT 1,
    "colorHex" TEXT NOT NULL DEFAULT '#6366F1',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_subjects" (
    "id" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "sectionId" UUID,
    "subjectId" UUID NOT NULL,
    "teacherId" UUID,
    "weeklyPeriods" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "roomType" TEXT NOT NULL DEFAULT 'CLASSROOM',
    "capacity" INTEGER NOT NULL DEFAULT 40,
    "floor" TEXT,
    "building" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetable_slots" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "teacherId" UUID,
    "roomId" UUID,
    "dayOfWeek" INTEGER NOT NULL,
    "periodNumber" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isBreak" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timetable_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "substitutions" (
    "id" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "originalTeacherId" UUID NOT NULL,
    "substituteTeacherId" UUID NOT NULL,
    "reason" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "substitutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_plans" (
    "id" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "classId" UUID,
    "title" TEXT NOT NULL,
    "unit" TEXT,
    "description" TEXT,
    "objectives" TEXT,
    "resources" JSONB NOT NULL DEFAULT '[]',
    "plannedDate" DATE NOT NULL,
    "completedAt" TIMESTAMP(3),
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_materials" (
    "id" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "materialType" TEXT NOT NULL DEFAULT 'NOTE',
    "fileUrl" TEXT,
    "externalUrl" TEXT,
    "fileSizeBytes" INTEGER,
    "mimeType" TEXT,
    "classId" UUID,
    "sectionId" UUID,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "academicYearId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "eventType" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isAllDay" BOOLEAN NOT NULL DEFAULT true,
    "location" TEXT,
    "colorHex" TEXT NOT NULL DEFAULT '#4F46E5',
    "audienceType" "AudienceType" NOT NULL DEFAULT 'INSTITUTION',
    "audienceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rsvpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_rsvps" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "response" TEXT NOT NULL,
    "guestCount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_rsvps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "userId" UUID,
    "admissionNo" TEXT NOT NULL,
    "rollNumber" TEXT,
    "nationalId" TEXT,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "bloodGroup" TEXT,
    "nationality" TEXT DEFAULT 'Indian',
    "religion" TEXT,
    "category" TEXT,
    "motherTongue" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "photoUrl" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "homeLatitude" DOUBLE PRECISION,
    "homeLongitude" DOUBLE PRECISION,
    "admissionDate" DATE NOT NULL,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "exitDate" DATE,
    "exitReason" TEXT,
    "rfidTag" TEXT,
    "biometricId" TEXT,
    "medicalNotes" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "rollNumber" TEXT,
    "enrolledOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "altPhone" TEXT,
    "photoUrl" TEXT,
    "occupation" TEXT,
    "organization" TEXT,
    "annualIncome" DECIMAL(14,2),
    "qualification" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "idProofType" TEXT,
    "idProofNumber" TEXT,
    "inviteToken" TEXT,
    "inviteSentAt" TIMESTAMP(3),
    "inviteAcceptedAt" TIMESTAMP(3),
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_guardians" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "relation" "GuardianRelation" NOT NULL,
    "custody" "CustodyType" NOT NULL DEFAULT 'PRIMARY',
    "isPrimaryContact" BOOLEAN NOT NULL DEFAULT false,
    "canViewLocation" BOOLEAN NOT NULL DEFAULT true,
    "canPickup" BOOLEAN NOT NULL DEFAULT true,
    "canReceiveInvoices" BOOLEAN NOT NULL DEFAULT true,
    "canApproveLeave" BOOLEAN NOT NULL DEFAULT true,
    "locationConsentAt" TIMESTAMP(3),
    "locationConsentIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_documents" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "documentType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSizeBytes" INTEGER,
    "mimeType" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMP(3),
    "remarks" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_applications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "applicationNo" TEXT NOT NULL,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'ENQUIRY',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "guardianName" TEXT NOT NULL,
    "guardianPhone" TEXT NOT NULL,
    "guardianEmail" TEXT,
    "appliedForClassId" UUID,
    "previousSchool" TEXT,
    "source" TEXT,
    "enrolledStudentId" UUID,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admission_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "behaviour_records" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "recordedById" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "occurredOn" DATE NOT NULL,
    "actionTaken" TEXT,
    "parentNotified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "behaviour_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "fromClassId" UUID NOT NULL,
    "toClassId" UUID,
    "result" TEXT NOT NULL,
    "remarks" TEXT,
    "processedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_certificates" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "certificateNo" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "conductRemark" TEXT NOT NULL DEFAULT 'Satisfactory',
    "lastClassName" TEXT NOT NULL,
    "academicSummary" JSONB,
    "fileUrl" TEXT,
    "issuedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_risk_scores" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "riskType" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "factors" JSONB NOT NULL DEFAULT '{}',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_risk_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "subjectId" UUID,
    "date" DATE NOT NULL,
    "periodNumber" INTEGER NOT NULL DEFAULT 0,
    "takenById" UUID,
    "takenAt" TIMESTAMP(3),
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "totalStudents" INTEGER NOT NULL DEFAULT 0,
    "presentCount" INTEGER NOT NULL DEFAULT 0,
    "absentCount" INTEGER NOT NULL DEFAULT 0,
    "lateCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "source" "AttendanceSource" NOT NULL DEFAULT 'TEACHER',
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "lateByMinutes" INTEGER,
    "remarks" TEXT,
    "parentNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_rules" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID,
    "name" TEXT NOT NULL,
    "schoolStartTime" TEXT NOT NULL DEFAULT '08:00',
    "schoolEndTime" TEXT NOT NULL DEFAULT '14:30',
    "graceMinutes" INTEGER NOT NULL DEFAULT 10,
    "halfDayAfterMinutes" INTEGER NOT NULL DEFAULT 120,
    "absenceAlertThreshold" INTEGER NOT NULL DEFAULT 3,
    "minAttendancePercent" INTEGER NOT NULL DEFAULT 75,
    "notifyParentOnAbsence" BOOLEAN NOT NULL DEFAULT true,
    "notifyParentOnLate" BOOLEAN NOT NULL DEFAULT false,
    "lockAfterHours" INTEGER NOT NULL DEFAULT 24,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_terms" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "weightPercent" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "examTermId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "gradingSystem" "GradingSystem" NOT NULL DEFAULT 'PERCENTAGE',
    "status" "ExamStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "resultPublishedAt" TIMESTAMP(3),
    "publishedById" UUID,
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_schedules" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "roomId" UUID,
    "examDate" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "maxMarks" DECIMAL(6,2) NOT NULL,
    "passingMarks" DECIMAL(6,2) NOT NULL,
    "theoryMarks" DECIMAL(6,2),
    "practicalMarks" DECIMAL(6,2),
    "questionPaperUrl" TEXT,
    "invigilatorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_allocations" (
    "id" UUID NOT NULL,
    "examScheduleId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "roomId" UUID,
    "seatNumber" TEXT NOT NULL,
    "rowNumber" INTEGER,
    "colNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seat_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mark_entries" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "examScheduleId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "marksObtained" DECIMAL(6,2),
    "theoryMarks" DECIMAL(6,2),
    "practicalMarks" DECIMAL(6,2),
    "percentage" DECIMAL(5,2),
    "grade" TEXT,
    "gradePoints" DECIMAL(4,2),
    "isAbsent" BOOLEAN NOT NULL DEFAULT false,
    "isPassed" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "evaluatedById" UUID,
    "evaluatedAt" TIMESTAMP(3),
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mark_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_cards" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "examTermId" UUID NOT NULL,
    "totalMarks" DECIMAL(8,2) NOT NULL,
    "obtainedMarks" DECIMAL(8,2) NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "gpa" DECIMAL(4,2),
    "overallGrade" TEXT,
    "rank" INTEGER,
    "rankOutOf" INTEGER,
    "attendancePercent" DECIMAL(5,2),
    "teacherRemarks" TEXT,
    "principalRemarks" TEXT,
    "subjectBreakdown" JSONB,
    "pdfUrl" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "questionType" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT 'MEDIUM',
    "text" TEXT NOT NULL,
    "options" JSONB,
    "correctAnswer" TEXT,
    "explanation" TEXT,
    "marks" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "topic" TEXT,
    "classLevel" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "imageUrl" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "sectionId" UUID,
    "subjectId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "instructions" TEXT,
    "attachmentUrls" JSONB NOT NULL DEFAULT '[]',
    "maxMarks" DECIMAL(6,2) NOT NULL DEFAULT 10,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'DRAFT',
    "assignedOn" DATE NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "lateUntil" TIMESTAMP(3),
    "allowLateSubmission" BOOLEAN NOT NULL DEFAULT true,
    "latePenaltyPercent" INTEGER NOT NULL DEFAULT 10,
    "rubric" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submissions" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "content" TEXT,
    "attachmentUrls" JSONB NOT NULL DEFAULT '[]',
    "submittedAt" TIMESTAMP(3),
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "marksObtained" DECIMAL(6,2),
    "rubricScores" JSONB,
    "feedback" TEXT,
    "gradedById" UUID,
    "gradedAt" TIMESTAMP(3),
    "plagiarismScore" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_heads" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'TUITION',
    "frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "isRefundable" BOOLEAN NOT NULL DEFAULT false,
    "isTaxable" BOOLEAN NOT NULL DEFAULT false,
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "hsnSacCode" TEXT,
    "ledgerCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_heads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structures" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "classId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structure_items" (
    "id" UUID NOT NULL,
    "feeStructureId" UUID NOT NULL,
    "feeHeadId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "dueDate" DATE,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_structure_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_installments" (
    "id" UUID NOT NULL,
    "feeStructureId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "dueDate" DATE NOT NULL,
    "lateFeeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lateFeeGraceDays" INTEGER NOT NULL DEFAULT 7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "installmentId" UUID,
    "invoiceNo" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lateFeeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balanceAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "placeOfSupply" TEXT,
    "notes" TEXT,
    "pdfUrl" TEXT,
    "lastReminderAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "feeHeadId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitAmount" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "hsnSacCode" TEXT,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID,
    "studentId" UUID NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "gateway" "PaymentGateway" NOT NULL DEFAULT 'OFFLINE',
    "gatewayOrderId" TEXT,
    "gatewayPaymentId" TEXT,
    "gatewaySignature" TEXT,
    "gatewayResponse" JSONB,
    "failureReason" TEXT,
    "chequeNumber" TEXT,
    "bankName" TEXT,
    "transactionRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "collectedById" UUID,
    "remarks" TEXT,
    "receiptUrl" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "settlementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "invoiceId" UUID,
    "refundNo" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "gatewayRefundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concessions" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "type" "ConcessionType" NOT NULL,
    "name" TEXT NOT NULL,
    "percentage" DECIMAL(5,2),
    "flatAmount" DECIMAL(14,2),
    "feeHeadIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "reason" TEXT,
    "documentUrl" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "concessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "entryDate" DATE NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" UUID,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "narration" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "headEmployeeId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "designations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "isTeaching" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "userId" UUID,
    "employeeCode" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "gender" "Gender" NOT NULL,
    "bloodGroup" TEXT,
    "photoUrl" TEXT,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "altPhone" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "departmentId" UUID,
    "designationId" UUID,
    "reportsToId" UUID,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "joiningDate" DATE NOT NULL,
    "confirmationDate" DATE,
    "exitDate" DATE,
    "exitReason" TEXT,
    "qualification" TEXT,
    "experienceYears" INTEGER DEFAULT 0,
    "specialization" TEXT,
    "subjectExpertise" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "panNumber" TEXT,
    "aadhaarNumber" TEXT,
    "pfNumber" TEXT,
    "esiNumber" TEXT,
    "bankAccountNo" TEXT,
    "bankIfsc" TEXT,
    "bankName" TEXT,
    "rfidTag" TEXT,
    "biometricId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "documentType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_attendance" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "source" "AttendanceSource" NOT NULL DEFAULT 'BIOMETRIC',
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "workedHours" DECIMAL(5,2),
    "overtimeHours" DECIMAL(5,2),
    "lateByMinutes" INTEGER,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "annualQuota" INTEGER NOT NULL DEFAULT 12,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "carryForward" BOOLEAN NOT NULL DEFAULT false,
    "maxCarryForward" INTEGER NOT NULL DEFAULT 0,
    "requiresDocument" BOOLEAN NOT NULL DEFAULT false,
    "minNoticeDays" INTEGER NOT NULL DEFAULT 1,
    "colorHex" TEXT NOT NULL DEFAULT '#0EA5E9',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "leaveTypeId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "entitled" DECIMAL(5,1) NOT NULL,
    "used" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "carriedForward" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "balance" DECIMAL(5,1) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "leaveTypeId" UUID NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "totalDays" DECIMAL(4,1) NOT NULL,
    "isHalfDay" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "documentUrl" TEXT,
    "contactDuringLeave" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approverId" UUID,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "substitutionArranged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_components" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "SalaryComponentType" NOT NULL,
    "isPercentage" BOOLEAN NOT NULL DEFAULT false,
    "percentageValue" DECIMAL(5,2),
    "basisComponentCode" TEXT,
    "defaultAmount" DECIMAL(14,2),
    "isTaxable" BOOLEAN NOT NULL DEFAULT true,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_structures" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "basicSalary" DECIMAL(14,2) NOT NULL,
    "grossSalary" DECIMAL(14,2) NOT NULL,
    "components" JSONB NOT NULL DEFAULT '[]',
    "ctcAnnual" DECIMAL(14,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "totalEmployees" INTEGER NOT NULL DEFAULT 0,
    "totalGross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "processedById" UUID,
    "processedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL,
    "payrollRunId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "workingDays" DECIMAL(4,1) NOT NULL,
    "presentDays" DECIMAL(4,1) NOT NULL,
    "paidLeaveDays" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "lopDays" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "basicSalary" DECIMAL(14,2) NOT NULL,
    "grossEarnings" DECIMAL(14,2) NOT NULL,
    "totalDeductions" DECIMAL(14,2) NOT NULL,
    "netPay" DECIMAL(14,2) NOT NULL,
    "earnings" JSONB NOT NULL DEFAULT '[]',
    "deductions" JSONB NOT NULL DEFAULT '[]',
    "incomeTax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pfEmployee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pfEmployer" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "esi" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "professionalTax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pdfUrl" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appraisals" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "cycleName" TEXT NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "criteria" JSONB NOT NULL DEFAULT '[]',
    "selfRating" DECIMAL(4,2),
    "reviewerRating" DECIMAL(4,2),
    "finalRating" DECIMAL(4,2),
    "strengths" TEXT,
    "improvements" TEXT,
    "goals" TEXT,
    "reviewerComments" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "incrementPercent" DECIMAL(5,2),
    "promotionTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appraisals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_categories" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "classificationCode" TEXT,
    "parentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "categoryId" UUID,
    "isbn" TEXT,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "author" TEXT NOT NULL,
    "coAuthors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publisher" TEXT,
    "edition" TEXT,
    "publishYear" INTEGER,
    "language" TEXT NOT NULL DEFAULT 'English',
    "pages" INTEGER,
    "description" TEXT,
    "coverUrl" TEXT,
    "rackLocation" TEXT,
    "price" DECIMAL(10,2),
    "totalCopies" INTEGER NOT NULL DEFAULT 0,
    "availableCopies" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_copies" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "accessionNo" TEXT NOT NULL,
    "barcode" TEXT,
    "status" "BookCopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "condition" TEXT NOT NULL DEFAULT 'GOOD',
    "acquiredOn" DATE,
    "price" DECIMAL(10,2),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "book_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_loans" (
    "id" UUID NOT NULL,
    "bookCopyId" UUID NOT NULL,
    "studentId" UUID,
    "employeeId" UUID,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATE NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "status" "LoanStatus" NOT NULL DEFAULT 'ISSUED',
    "renewalCount" INTEGER NOT NULL DEFAULT 0,
    "fineAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "finePaid" BOOLEAN NOT NULL DEFAULT false,
    "finePaidAt" TIMESTAMP(3),
    "replacementCharge" DECIMAL(10,2),
    "issuedById" UUID,
    "receivedById" UUID,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "book_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_reservations" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "studentId" UUID,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notifiedAt" TIMESTAMP(3),
    "queuePosition" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "book_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "registrationNo" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL DEFAULT 'BUS',
    "make" TEXT,
    "model" TEXT,
    "manufactureYear" INTEGER,
    "capacity" INTEGER NOT NULL DEFAULT 40,
    "color" TEXT,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "insuranceNo" TEXT,
    "insuranceExpiry" DATE,
    "fitnessExpiry" DATE,
    "permitExpiry" DATE,
    "pollutionExpiry" DATE,
    "lastServiceDate" DATE,
    "nextServiceDueKm" INTEGER,
    "odometerKm" INTEGER NOT NULL DEFAULT 0,
    "hasGpsDevice" BOOLEAN NOT NULL DEFAULT true,
    "hasCamera" BOOLEAN NOT NULL DEFAULT false,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_maintenance" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "maintenanceType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "odometerKm" INTEGER,
    "cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vendorName" TEXT,
    "nextDueDate" DATE,
    "invoiceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_devices" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "deviceImei" TEXT NOT NULL,
    "simNumber" TEXT,
    "vendor" TEXT,
    "model" TEXT,
    "firmwareVersion" TEXT,
    "authToken" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastPingAt" TIMESTAMP(3),
    "batteryLevel" INTEGER,
    "signalStrength" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracking_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_profiles" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "licenseType" TEXT,
    "licenseExpiry" DATE NOT NULL,
    "badgeNumber" TEXT,
    "policeVerifiedAt" TIMESTAMP(3),
    "policeVerificationUrl" TEXT,
    "medicalCheckAt" TIMESTAMP(3),
    "experienceYears" INTEGER NOT NULL DEFAULT 0,
    "bloodGroup" TEXT,
    "emergencyContact" TEXT,
    "safetyScore" INTEGER NOT NULL DEFAULT 100,
    "totalTrips" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_routes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "vehicleId" UUID,
    "driverId" UUID,
    "attendantId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startStopName" TEXT NOT NULL,
    "endStopName" TEXT NOT NULL,
    "distanceKm" DECIMAL(6,2),
    "estimatedMinutes" INTEGER,
    "pickupStartTime" TEXT,
    "dropStartTime" TEXT,
    "polyline" TEXT,
    "monthlyFare" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "id" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "landmark" TEXT,
    "pickupTime" TEXT,
    "dropTime" TEXT,
    "haltMinutes" INTEGER NOT NULL DEFAULT 2,
    "radiusMeters" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_allocations" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "pickupStopId" UUID NOT NULL,
    "dropStopId" UUID,
    "academicYearId" UUID,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "monthlyFare" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "tripDate" DATE NOT NULL,
    "direction" "TripDirection" NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledStartAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "startOdometerKm" INTEGER,
    "endOdometerKm" INTEGER,
    "distanceKm" DECIMAL(8,2),
    "studentsBoarded" INTEGER NOT NULL DEFAULT 0,
    "studentsAlighted" INTEGER NOT NULL DEFAULT 0,
    "maxSpeedKmph" DECIMAL(5,1),
    "avgSpeedKmph" DECIMAL(5,1),
    "alertCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_student_events" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "stopId" UUID,
    "event" "BoardingEvent" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "method" TEXT NOT NULL DEFAULT 'MANUAL',
    "recordedById" UUID,
    "guardianNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "trip_student_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_stop_arrivals" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "stopId" UUID NOT NULL,
    "etaAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "departedAt" TIMESTAMP(3),
    "delayMinutes" INTEGER,

    CONSTRAINT "trip_stop_arrivals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_pings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "tripId" UUID,
    "deviceImei" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speedKmph" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "heading" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accuracyMeters" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "ignitionOn" BOOLEAN,
    "batteryLevel" INTEGER,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_pings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofences" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID,
    "name" TEXT NOT NULL,
    "type" "GeofenceType" NOT NULL,
    "shape" "GeofenceShape" NOT NULL DEFAULT 'CIRCLE',
    "centerLatitude" DOUBLE PRECISION,
    "centerLongitude" DOUBLE PRECISION,
    "radiusMeters" INTEGER,
    "polygon" JSONB,
    "studentId" UUID,
    "notifyOnEntry" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnExit" BOOLEAN NOT NULL DEFAULT true,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofence_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "geofenceId" UUID NOT NULL,
    "studentId" UUID,
    "vehicleId" UUID,
    "tripId" UUID,
    "type" "GeofenceEventType" NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speedKmph" DOUBLE PRECISION,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "geofence_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sos_alerts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "raisedByUserId" UUID NOT NULL,
    "vehicleId" UUID,
    "tripId" UUID,
    "studentId" UUID,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "address" TEXT,
    "status" "SosStatus" NOT NULL DEFAULT 'ACTIVE',
    "message" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedById" UUID,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "notifiedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sos_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_alerts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "vehicleId" UUID,
    "tripId" UUID,
    "driverId" UUID,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" UUID,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "safety_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "attachmentUrls" JSONB NOT NULL DEFAULT '[]',
    "imageUrl" TEXT,
    "audienceType" "AudienceType" NOT NULL DEFAULT 'INSTITUTION',
    "audienceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channels" "NotificationChannel"[] DEFAULT ARRAY['IN_APP']::"NotificationChannel"[],
    "publishAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_reads" (
    "id" UUID NOT NULL,
    "announcementId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "providerTemplateId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "module" TEXT,
    "actionUrl" TEXT,
    "data" JSONB,
    "imageUrl" TEXT,
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT,
    "providerMessageId" TEXT,
    "providerResponse" JSONB,
    "errorMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "costAmount" DECIMAL(10,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" TEXT,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DIRECT',
    "title" TEXT,
    "studentId" UUID,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_members" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3),
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'TEXT',
    "attachmentUrls" JSONB NOT NULL DEFAULT '[]',
    "replyToId" UUID,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "moderatedAt" TIMESTAMP(3),
    "moderationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reads" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "gstin" TEXT,
    "panNumber" TEXT,
    "bankAccountNo" TEXT,
    "bankIfsc" TEXT,
    "rating" INTEGER NOT NULL DEFAULT 3,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "vendorId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'PCS',
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER NOT NULL DEFAULT 10,
    "reorderQuantity" INTEGER NOT NULL DEFAULT 50,
    "unitCost" DECIMAL(12,2),
    "sellingPrice" DECIMAL(12,2),
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "hsnCode" TEXT,
    "storageLocation" TEXT,
    "barcode" TEXT,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2),
    "totalValue" DECIMAL(14,2),
    "referenceType" TEXT,
    "referenceId" TEXT,
    "issuedToUserId" UUID,
    "remarks" TEXT,
    "movedById" UUID,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "poNumber" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "orderDate" DATE NOT NULL,
    "expectedDate" DATE,
    "receivedDate" DATE,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "requestedById" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "attachmentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "assetTag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "serialNumber" TEXT,
    "make" TEXT,
    "model" TEXT,
    "purchaseDate" DATE,
    "purchaseCost" DECIMAL(14,2),
    "warrantyUntil" DATE,
    "usefulLifeYears" INTEGER,
    "salvageValue" DECIMAL(14,2),
    "currentBookValue" DECIMAL(14,2),
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_STORE',
    "location" TEXT,
    "assignedToId" UUID,
    "assignedAt" TIMESTAMP(3),
    "qrCodeUrl" TEXT,
    "imageUrl" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_reports" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "columns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scheduleCron" TEXT,
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exportFormat" TEXT NOT NULL DEFAULT 'PDF',
    "lastRunAt" TIMESTAMP(3),
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- CreateIndex
CREATE INDEX "tenants_code_idx" ON "tenants"("code");

-- CreateIndex
CREATE INDEX "branches_tenantId_idx" ON "branches"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenantId_code_key" ON "branches"("tenantId", "code");

-- CreateIndex
CREATE INDEX "users_tenantId_role_idx" ON "users"("tenantId", "role");

-- CreateIndex
CREATE INDEX "users_tenantId_branchId_idx" ON "users"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_phone_key" ON "users"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "custom_roles_tenantId_name_key" ON "custom_roles"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");

-- CreateIndex
CREATE INDEX "push_tokens_userId_idx" ON "push_tokens"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_entityType_entityId_idx" ON "audit_logs"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_actorId_idx" ON "audit_logs"("tenantId", "actorId");

-- CreateIndex
CREATE INDEX "audit_logs_module_idx" ON "audit_logs"("module");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_tenantId_category_provider_key" ON "integrations"("tenantId", "category", "provider");

-- CreateIndex
CREATE INDEX "consent_records_userId_consentType_idx" ON "consent_records"("userId", "consentType");

-- CreateIndex
CREATE INDEX "location_access_logs_viewerId_createdAt_idx" ON "location_access_logs"("viewerId", "createdAt");

-- CreateIndex
CREATE INDEX "location_access_logs_studentId_createdAt_idx" ON "location_access_logs"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "academic_years_tenantId_isCurrent_idx" ON "academic_years"("tenantId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_tenantId_name_key" ON "academic_years"("tenantId", "name");

-- CreateIndex
CREATE INDEX "classes_tenantId_branchId_idx" ON "classes"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "classes_tenantId_branchId_code_key" ON "classes"("tenantId", "branchId", "code");

-- CreateIndex
CREATE INDEX "sections_classTeacherId_idx" ON "sections"("classTeacherId");

-- CreateIndex
CREATE UNIQUE INDEX "sections_classId_name_key" ON "sections"("classId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_tenantId_code_key" ON "subjects"("tenantId", "code");

-- CreateIndex
CREATE INDEX "class_subjects_teacherId_idx" ON "class_subjects"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "class_subjects_classId_sectionId_subjectId_key" ON "class_subjects"("classId", "sectionId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_tenantId_branchId_code_key" ON "rooms"("tenantId", "branchId", "code");

-- CreateIndex
CREATE INDEX "timetable_slots_teacherId_dayOfWeek_idx" ON "timetable_slots"("teacherId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "timetable_slots_tenantId_academicYearId_idx" ON "timetable_slots"("tenantId", "academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_slots_sectionId_dayOfWeek_periodNumber_academicYe_key" ON "timetable_slots"("sectionId", "dayOfWeek", "periodNumber", "academicYearId");

-- CreateIndex
CREATE INDEX "substitutions_substituteTeacherId_date_idx" ON "substitutions"("substituteTeacherId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "substitutions_slotId_date_key" ON "substitutions"("slotId", "date");

-- CreateIndex
CREATE INDEX "lesson_plans_teacherId_plannedDate_idx" ON "lesson_plans"("teacherId", "plannedDate");

-- CreateIndex
CREATE INDEX "lesson_plans_subjectId_idx" ON "lesson_plans"("subjectId");

-- CreateIndex
CREATE INDEX "learning_materials_subjectId_isPublished_idx" ON "learning_materials"("subjectId", "isPublished");

-- CreateIndex
CREATE INDEX "calendar_events_tenantId_startDate_idx" ON "calendar_events"("tenantId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "event_rsvps_eventId_userId_key" ON "event_rsvps"("eventId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "students_userId_key" ON "students"("userId");

-- CreateIndex
CREATE INDEX "students_tenantId_branchId_status_idx" ON "students"("tenantId", "branchId", "status");

-- CreateIndex
CREATE INDEX "students_rfidTag_idx" ON "students"("rfidTag");

-- CreateIndex
CREATE INDEX "students_firstName_lastName_idx" ON "students"("firstName", "lastName");

-- CreateIndex
CREATE UNIQUE INDEX "students_tenantId_admissionNo_key" ON "students"("tenantId", "admissionNo");

-- CreateIndex
CREATE INDEX "enrollments_sectionId_isCurrent_idx" ON "enrollments"("sectionId", "isCurrent");

-- CreateIndex
CREATE INDEX "enrollments_classId_academicYearId_idx" ON "enrollments"("classId", "academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_studentId_academicYearId_key" ON "enrollments"("studentId", "academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_userId_key" ON "guardians"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_inviteToken_key" ON "guardians"("inviteToken");

-- CreateIndex
CREATE INDEX "guardians_tenantId_phone_idx" ON "guardians"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "student_guardians_guardianId_idx" ON "student_guardians"("guardianId");

-- CreateIndex
CREATE UNIQUE INDEX "student_guardians_studentId_guardianId_key" ON "student_guardians"("studentId", "guardianId");

-- CreateIndex
CREATE INDEX "student_documents_studentId_documentType_idx" ON "student_documents"("studentId", "documentType");

-- CreateIndex
CREATE INDEX "admission_applications_tenantId_status_idx" ON "admission_applications"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "admission_applications_tenantId_applicationNo_key" ON "admission_applications"("tenantId", "applicationNo");

-- CreateIndex
CREATE INDEX "behaviour_records_studentId_occurredOn_idx" ON "behaviour_records"("studentId", "occurredOn");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_studentId_academicYearId_key" ON "promotions"("studentId", "academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_certificates_certificateNo_key" ON "transfer_certificates"("certificateNo");

-- CreateIndex
CREATE INDEX "student_risk_scores_riskType_score_idx" ON "student_risk_scores"("riskType", "score");

-- CreateIndex
CREATE UNIQUE INDEX "student_risk_scores_studentId_riskType_key" ON "student_risk_scores"("studentId", "riskType");

-- CreateIndex
CREATE INDEX "attendance_sessions_tenantId_date_idx" ON "attendance_sessions"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_sectionId_date_periodNumber_key" ON "attendance_sessions"("sectionId", "date", "periodNumber");

-- CreateIndex
CREATE INDEX "attendance_records_studentId_createdAt_idx" ON "attendance_records"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "attendance_records_status_idx" ON "attendance_records"("status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_sessionId_studentId_key" ON "attendance_records"("sessionId", "studentId");

-- CreateIndex
CREATE INDEX "attendance_rules_tenantId_idx" ON "attendance_rules"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "exam_terms_academicYearId_name_key" ON "exam_terms"("academicYearId", "name");

-- CreateIndex
CREATE INDEX "exams_tenantId_status_idx" ON "exams"("tenantId", "status");

-- CreateIndex
CREATE INDEX "exams_examTermId_idx" ON "exams"("examTermId");

-- CreateIndex
CREATE INDEX "exam_schedules_examDate_idx" ON "exam_schedules"("examDate");

-- CreateIndex
CREATE UNIQUE INDEX "exam_schedules_examId_subjectId_key" ON "exam_schedules"("examId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "seat_allocations_examScheduleId_studentId_key" ON "seat_allocations"("examScheduleId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "seat_allocations_examScheduleId_roomId_seatNumber_key" ON "seat_allocations"("examScheduleId", "roomId", "seatNumber");

-- CreateIndex
CREATE INDEX "mark_entries_studentId_examId_idx" ON "mark_entries"("studentId", "examId");

-- CreateIndex
CREATE UNIQUE INDEX "mark_entries_examScheduleId_studentId_key" ON "mark_entries"("examScheduleId", "studentId");

-- CreateIndex
CREATE INDEX "report_cards_examTermId_rank_idx" ON "report_cards"("examTermId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "report_cards_studentId_examTermId_key" ON "report_cards"("studentId", "examTermId");

-- CreateIndex
CREATE INDEX "questions_subjectId_difficulty_idx" ON "questions"("subjectId", "difficulty");

-- CreateIndex
CREATE INDEX "questions_tenantId_idx" ON "questions"("tenantId");

-- CreateIndex
CREATE INDEX "assignments_tenantId_status_idx" ON "assignments"("tenantId", "status");

-- CreateIndex
CREATE INDEX "assignments_classId_sectionId_dueAt_idx" ON "assignments"("classId", "sectionId", "dueAt");

-- CreateIndex
CREATE INDEX "assignment_submissions_studentId_status_idx" ON "assignment_submissions"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submissions_assignmentId_studentId_key" ON "assignment_submissions"("assignmentId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "fee_heads_tenantId_code_key" ON "fee_heads"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structures_tenantId_academicYearId_name_key" ON "fee_structures"("tenantId", "academicYearId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structure_items_feeStructureId_feeHeadId_key" ON "fee_structure_items"("feeStructureId", "feeHeadId");

-- CreateIndex
CREATE UNIQUE INDEX "fee_installments_feeStructureId_sequence_key" ON "fee_installments"("feeStructureId", "sequence");

-- CreateIndex
CREATE INDEX "invoices_studentId_status_idx" ON "invoices"("studentId", "status");

-- CreateIndex
CREATE INDEX "invoices_tenantId_status_dueDate_idx" ON "invoices"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenantId_invoiceNo_key" ON "invoices"("tenantId", "invoiceNo");

-- CreateIndex
CREATE INDEX "invoice_lines_invoiceId_idx" ON "invoice_lines"("invoiceId");

-- CreateIndex
CREATE INDEX "payments_studentId_status_idx" ON "payments"("studentId", "status");

-- CreateIndex
CREATE INDEX "payments_tenantId_paidAt_idx" ON "payments"("tenantId", "paidAt");

-- CreateIndex
CREATE INDEX "payments_gatewayPaymentId_idx" ON "payments"("gatewayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenantId_receiptNo_key" ON "payments"("tenantId", "receiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_refundNo_key" ON "refunds"("refundNo");

-- CreateIndex
CREATE INDEX "concessions_studentId_status_idx" ON "concessions"("studentId", "status");

-- CreateIndex
CREATE INDEX "ledger_entries_tenantId_entryDate_idx" ON "ledger_entries"("tenantId", "entryDate");

-- CreateIndex
CREATE INDEX "ledger_entries_tenantId_accountCode_idx" ON "ledger_entries"("tenantId", "accountCode");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenantId_code_key" ON "departments"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "designations_tenantId_code_key" ON "designations"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_userId_key" ON "employees"("userId");

-- CreateIndex
CREATE INDEX "employees_tenantId_branchId_status_idx" ON "employees"("tenantId", "branchId", "status");

-- CreateIndex
CREATE INDEX "employees_departmentId_idx" ON "employees"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenantId_employeeCode_key" ON "employees"("tenantId", "employeeCode");

-- CreateIndex
CREATE INDEX "employee_documents_employeeId_idx" ON "employee_documents"("employeeId");

-- CreateIndex
CREATE INDEX "employee_attendance_date_idx" ON "employee_attendance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "employee_attendance_employeeId_date_key" ON "employee_attendance"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_tenantId_code_key" ON "leave_types"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_employeeId_leaveTypeId_year_key" ON "leave_balances"("employeeId", "leaveTypeId", "year");

-- CreateIndex
CREATE INDEX "leave_requests_employeeId_status_idx" ON "leave_requests"("employeeId", "status");

-- CreateIndex
CREATE INDEX "leave_requests_status_fromDate_idx" ON "leave_requests"("status", "fromDate");

-- CreateIndex
CREATE UNIQUE INDEX "salary_components_tenantId_code_key" ON "salary_components"("tenantId", "code");

-- CreateIndex
CREATE INDEX "salary_structures_employeeId_isActive_idx" ON "salary_structures"("employeeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_tenantId_branchId_month_year_key" ON "payroll_runs"("tenantId", "branchId", "month", "year");

-- CreateIndex
CREATE INDEX "payslips_employeeId_year_month_idx" ON "payslips"("employeeId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_payrollRunId_employeeId_key" ON "payslips"("payrollRunId", "employeeId");

-- CreateIndex
CREATE INDEX "appraisals_employeeId_cycleName_idx" ON "appraisals"("employeeId", "cycleName");

-- CreateIndex
CREATE UNIQUE INDEX "book_categories_tenantId_code_key" ON "book_categories"("tenantId", "code");

-- CreateIndex
CREATE INDEX "books_tenantId_title_idx" ON "books"("tenantId", "title");

-- CreateIndex
CREATE INDEX "books_isbn_idx" ON "books"("isbn");

-- CreateIndex
CREATE INDEX "book_copies_bookId_status_idx" ON "book_copies"("bookId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "book_copies_accessionNo_key" ON "book_copies"("accessionNo");

-- CreateIndex
CREATE INDEX "book_loans_studentId_status_idx" ON "book_loans"("studentId", "status");

-- CreateIndex
CREATE INDEX "book_loans_employeeId_status_idx" ON "book_loans"("employeeId", "status");

-- CreateIndex
CREATE INDEX "book_loans_status_dueDate_idx" ON "book_loans"("status", "dueDate");

-- CreateIndex
CREATE INDEX "book_reservations_bookId_status_idx" ON "book_reservations"("bookId", "status");

-- CreateIndex
CREATE INDEX "vehicles_tenantId_branchId_status_idx" ON "vehicles"("tenantId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_tenantId_registrationNo_key" ON "vehicles"("tenantId", "registrationNo");

-- CreateIndex
CREATE INDEX "vehicle_maintenance_vehicleId_serviceDate_idx" ON "vehicle_maintenance"("vehicleId", "serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_devices_vehicleId_key" ON "tracking_devices"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_devices_deviceImei_key" ON "tracking_devices"("deviceImei");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_devices_authToken_key" ON "tracking_devices"("authToken");

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_employeeId_key" ON "driver_profiles"("employeeId");

-- CreateIndex
CREATE INDEX "transport_routes_tenantId_branchId_isActive_idx" ON "transport_routes"("tenantId", "branchId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "transport_routes_tenantId_code_key" ON "transport_routes"("tenantId", "code");

-- CreateIndex
CREATE INDEX "route_stops_routeId_idx" ON "route_stops"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_routeId_sequence_key" ON "route_stops"("routeId", "sequence");

-- CreateIndex
CREATE INDEX "transport_allocations_routeId_isActive_idx" ON "transport_allocations"("routeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "transport_allocations_studentId_academicYearId_key" ON "transport_allocations"("studentId", "academicYearId");

-- CreateIndex
CREATE INDEX "trips_tenantId_tripDate_status_idx" ON "trips"("tenantId", "tripDate", "status");

-- CreateIndex
CREATE INDEX "trips_vehicleId_tripDate_idx" ON "trips"("vehicleId", "tripDate");

-- CreateIndex
CREATE UNIQUE INDEX "trips_routeId_tripDate_direction_key" ON "trips"("routeId", "tripDate", "direction");

-- CreateIndex
CREATE INDEX "trip_student_events_studentId_occurredAt_idx" ON "trip_student_events"("studentId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "trip_student_events_tripId_studentId_event_key" ON "trip_student_events"("tripId", "studentId", "event");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stop_arrivals_tripId_stopId_key" ON "trip_stop_arrivals"("tripId", "stopId");

-- CreateIndex
CREATE INDEX "location_pings_vehicleId_recordedAt_idx" ON "location_pings"("vehicleId", "recordedAt");

-- CreateIndex
CREATE INDEX "location_pings_tripId_recordedAt_idx" ON "location_pings"("tripId", "recordedAt");

-- CreateIndex
CREATE INDEX "location_pings_tenantId_recordedAt_idx" ON "location_pings"("tenantId", "recordedAt");

-- CreateIndex
CREATE INDEX "geofences_tenantId_type_isActive_idx" ON "geofences"("tenantId", "type", "isActive");

-- CreateIndex
CREATE INDEX "geofence_events_studentId_occurredAt_idx" ON "geofence_events"("studentId", "occurredAt");

-- CreateIndex
CREATE INDEX "geofence_events_tenantId_occurredAt_idx" ON "geofence_events"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "geofence_events_geofenceId_occurredAt_idx" ON "geofence_events"("geofenceId", "occurredAt");

-- CreateIndex
CREATE INDEX "sos_alerts_tenantId_status_triggeredAt_idx" ON "sos_alerts"("tenantId", "status", "triggeredAt");

-- CreateIndex
CREATE INDEX "safety_alerts_tenantId_type_occurredAt_idx" ON "safety_alerts"("tenantId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "safety_alerts_vehicleId_occurredAt_idx" ON "safety_alerts"("vehicleId", "occurredAt");

-- CreateIndex
CREATE INDEX "announcements_tenantId_isPublished_publishAt_idx" ON "announcements"("tenantId", "isPublished", "publishAt");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_reads_announcementId_userId_key" ON "announcement_reads"("announcementId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_tenantId_key_channel_locale_key" ON "notification_templates"("tenantId", "key", "channel", "locale");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_createdAt_idx" ON "notifications"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_nextRetryAt_idx" ON "notification_deliveries"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_notificationId_idx" ON "notification_deliveries"("notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_category_key" ON "notification_preferences"("userId", "category");

-- CreateIndex
CREATE INDEX "conversations_tenantId_lastMessageAt_idx" ON "conversations"("tenantId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversation_members_userId_idx" ON "conversation_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_members_conversationId_userId_key" ON "conversation_members"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "message_reads_messageId_userId_key" ON "message_reads"("messageId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_tenantId_code_key" ON "vendors"("tenantId", "code");

-- CreateIndex
CREATE INDEX "inventory_items_tenantId_branchId_category_idx" ON "inventory_items"("tenantId", "branchId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_tenantId_code_key" ON "inventory_items"("tenantId", "code");

-- CreateIndex
CREATE INDEX "stock_movements_itemId_movedAt_idx" ON "stock_movements"("itemId", "movedAt");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_status_idx" ON "purchase_orders"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenantId_poNumber_key" ON "purchase_orders"("tenantId", "poNumber");

-- CreateIndex
CREATE INDEX "purchase_order_lines_purchaseOrderId_idx" ON "purchase_order_lines"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "assets_tenantId_branchId_status_idx" ON "assets"("tenantId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "assets_tenantId_assetTag_key" ON "assets"("tenantId", "assetTag");

-- CreateIndex
CREATE INDEX "saved_reports_tenantId_module_idx" ON "saved_reports"("tenantId", "module");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "custom_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_access_logs" ADD CONSTRAINT "location_access_logs_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_access_logs" ADD CONSTRAINT "location_access_logs_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_classTeacherId_fkey" FOREIGN KEY ("classTeacherId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "timetable_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_originalTeacherId_fkey" FOREIGN KEY ("originalTeacherId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_substituteTeacherId_fkey" FOREIGN KEY ("substituteTeacherId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_plans" ADD CONSTRAINT "lesson_plans_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_plans" ADD CONSTRAINT "lesson_plans_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_materials" ADD CONSTRAINT "learning_materials_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_materials" ADD CONSTRAINT "learning_materials_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behaviour_records" ADD CONSTRAINT "behaviour_records_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behaviour_records" ADD CONSTRAINT "behaviour_records_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_certificates" ADD CONSTRAINT "transfer_certificates_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_risk_scores" ADD CONSTRAINT "student_risk_scores_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_takenById_fkey" FOREIGN KEY ("takenById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "attendance_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_terms" ADD CONSTRAINT "exam_terms_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_examTermId_fkey" FOREIGN KEY ("examTermId") REFERENCES "exam_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_schedules" ADD CONSTRAINT "exam_schedules_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_schedules" ADD CONSTRAINT "exam_schedules_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_schedules" ADD CONSTRAINT "exam_schedules_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_allocations" ADD CONSTRAINT "seat_allocations_examScheduleId_fkey" FOREIGN KEY ("examScheduleId") REFERENCES "exam_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mark_entries" ADD CONSTRAINT "mark_entries_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mark_entries" ADD CONSTRAINT "mark_entries_examScheduleId_fkey" FOREIGN KEY ("examScheduleId") REFERENCES "exam_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mark_entries" ADD CONSTRAINT "mark_entries_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mark_entries" ADD CONSTRAINT "mark_entries_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_examTermId_fkey" FOREIGN KEY ("examTermId") REFERENCES "exam_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_heads" ADD CONSTRAINT "fee_heads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_feeStructureId_fkey" FOREIGN KEY ("feeStructureId") REFERENCES "fee_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_feeHeadId_fkey" FOREIGN KEY ("feeHeadId") REFERENCES "fee_heads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_feeStructureId_fkey" FOREIGN KEY ("feeStructureId") REFERENCES "fee_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "fee_installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_feeHeadId_fkey" FOREIGN KEY ("feeHeadId") REFERENCES "fee_heads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concessions" ADD CONSTRAINT "concessions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "designations" ADD CONSTRAINT "designations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "designations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_reportsToId_fkey" FOREIGN KEY ("reportsToId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_attendance" ADD CONSTRAINT "employee_attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisals" ADD CONSTRAINT "appraisals_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisals" ADD CONSTRAINT "appraisals_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_categories" ADD CONSTRAINT "book_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "book_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_loans" ADD CONSTRAINT "book_loans_bookCopyId_fkey" FOREIGN KEY ("bookCopyId") REFERENCES "book_copies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_loans" ADD CONSTRAINT "book_loans_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_loans" ADD CONSTRAINT "book_loans_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_reservations" ADD CONSTRAINT "book_reservations_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_reservations" ADD CONSTRAINT "book_reservations_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_maintenance" ADD CONSTRAINT "vehicle_maintenance_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_devices" ADD CONSTRAINT "tracking_devices_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "transport_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_allocations" ADD CONSTRAINT "transport_allocations_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_allocations" ADD CONSTRAINT "transport_allocations_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "transport_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_allocations" ADD CONSTRAINT "transport_allocations_pickupStopId_fkey" FOREIGN KEY ("pickupStopId") REFERENCES "route_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "transport_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_student_events" ADD CONSTRAINT "trip_student_events_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_student_events" ADD CONSTRAINT "trip_student_events_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_student_events" ADD CONSTRAINT "trip_student_events_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "route_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stop_arrivals" ADD CONSTRAINT "trip_stop_arrivals_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stop_arrivals" ADD CONSTRAINT "trip_stop_arrivals_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "route_stops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_pings" ADD CONSTRAINT "location_pings_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_pings" ADD CONSTRAINT "location_pings_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_geofenceId_fkey" FOREIGN KEY ("geofenceId") REFERENCES "geofences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sos_alerts" ADD CONSTRAINT "sos_alerts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sos_alerts" ADD CONSTRAINT "sos_alerts_raisedByUserId_fkey" FOREIGN KEY ("raisedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sos_alerts" ADD CONSTRAINT "sos_alerts_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sos_alerts" ADD CONSTRAINT "sos_alerts_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sos_alerts" ADD CONSTRAINT "sos_alerts_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_alerts" ADD CONSTRAINT "safety_alerts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_alerts" ADD CONSTRAINT "safety_alerts_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_alerts" ADD CONSTRAINT "safety_alerts_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reads" ADD CONSTRAINT "message_reads_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
