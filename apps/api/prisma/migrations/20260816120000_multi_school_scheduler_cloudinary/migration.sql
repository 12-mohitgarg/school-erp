-- Multi-school platform, scheduler observability and Cloudinary asset tracking.
--
-- Written by hand rather than generated, because the live database also carries
-- the PostGIS generated columns applied by prisma/sql/apply.mjs, which Prisma
-- reads as drift and would otherwise want to reset. Every statement below is
-- idempotent so it is safe to re-run.

-- --------------------------------------------------------------------------
-- Tenants: per-school retention policy and platform-operator controls
-- --------------------------------------------------------------------------
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "locationRetentionDays" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "onboardingNotes"       TEXT,
  ADD COLUMN IF NOT EXISTS "suspendedAt"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendedReason"       TEXT;

-- --------------------------------------------------------------------------
-- Users: platform-operator flag (may create schools and open any panel)
-- --------------------------------------------------------------------------
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "users_isPlatformAdmin_idx"
  ON "users" ("isPlatformAdmin")
  WHERE "isPlatformAdmin" = true;

-- --------------------------------------------------------------------------
-- Documents: Cloudinary public id + resource type, and who uploaded
-- --------------------------------------------------------------------------
ALTER TABLE "student_documents"
  ADD COLUMN IF NOT EXISTS "filePublicId"     TEXT,
  ADD COLUMN IF NOT EXISTS "fileResourceType" TEXT NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS "uploadedById"     UUID;

ALTER TABLE "employee_documents"
  ADD COLUMN IF NOT EXISTS "filePublicId"     TEXT,
  ADD COLUMN IF NOT EXISTS "fileResourceType" TEXT NOT NULL DEFAULT 'image';

-- --------------------------------------------------------------------------
-- Scheduler observability
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "job_runs" (
  "id"            UUID         NOT NULL,
  "job"           TEXT         NOT NULL,
  "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"    TIMESTAMP(3),
  "durationMs"    INTEGER,
  "status"        TEXT         NOT NULL DEFAULT 'RUNNING',
  "affected"      INTEGER      NOT NULL DEFAULT 0,
  "summary"       TEXT,
  "error"         TEXT,
  "triggeredById" UUID,
  "manual"        BOOLEAN      NOT NULL DEFAULT false,

  CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "job_runs_job_startedAt_idx"  ON "job_runs" ("job", "startedAt");
CREATE INDEX IF NOT EXISTS "job_runs_startedAt_idx"      ON "job_runs" ("startedAt");

-- --------------------------------------------------------------------------
-- Refresh tokens: remember which school a platform admin has open
-- --------------------------------------------------------------------------
ALTER TABLE "refresh_tokens"
  ADD COLUMN IF NOT EXISTS "actingTenantId" UUID;
