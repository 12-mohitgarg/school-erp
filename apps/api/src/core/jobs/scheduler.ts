/**
 * Background jobs.
 *
 * Every job here exists because a specific PRD clause requires work to happen
 * without anyone clicking anything. `relatesTo` on each definition names that
 * clause, and it is surfaced in Settings › Scheduler — so the schedule can be
 * audited against the spec rather than taken on trust.
 *
 * Design rules, all of which the admin screen depends on:
 *   * Each task is idempotent, so a missed or duplicated run is harmless.
 *   * Each run writes a `JobRun` row — start, duration, rows affected, error.
 *     Scheduled work nobody can see is scheduled work nobody trusts.
 *   * A run never overlaps itself; a slow tick is skipped, not queued.
 *   * A job that throws is caught and recorded. One broken job must not take
 *     the timer, or the other ten, down with it.
 */

import { formatCurrency } from '@erp/shared';
import { prisma } from '../db/prisma.js';
import { moduleLogger } from '../logger.js';
import { env } from '../../config/env.js';
import { pruneExpiredTokens } from '../auth/tokens.js';
import { activeTripsGauge } from '../observability/metrics.js';
import { notify, guardianUserIds } from '../notifications/notification.service.js';

const log = moduleLogger('jobs');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Library fine per overdue day when a school has not configured its own. */
const DEFAULT_FINE_PER_DAY = 2;

// ---------------------------------------------------------------------------
// Registry types
// ---------------------------------------------------------------------------

/** What a job reports back, so the run row says something useful. */
export interface JobResult {
  affected: number;
  summary?: string;
}

export interface JobDefinition {
  /** Stable key — it appears in the manual-run URL, so it must not change. */
  name: string;
  label: string;
  /** The PRD clause or operational need this job satisfies. */
  relatesTo: string;
  description: string;
  intervalMs: number;
  /** May an administrator trigger this from the Scheduler screen? */
  manualRunnable: boolean;
  run: () => Promise<JobResult>;
}

// ---------------------------------------------------------------------------
// Safety & privacy
// ---------------------------------------------------------------------------

/**
 * PRD 6.3: purge location history past the retention window.
 *
 * Retention is *per school*. The PRD calls it configurable, and one global
 * setting would silently impose one institution's policy on every other, so
 * each tenant's own `locationRetentionDays` decides its cutoff.
 *
 * `location_access_logs` are deliberately not purged here: that table is the
 * compliance record of who *looked* at a child's location, and it has to
 * outlive the positions it describes.
 */
async function purgeLocationHistory(): Promise<JobResult> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, locationRetentionDays: true },
  });

  let total = 0;
  const detail: string[] = [];

  for (const tenant of tenants) {
    const days = tenant.locationRetentionDays > 0 ? tenant.locationRetentionDays : 30;
    const cutoff = new Date(Date.now() - days * DAY);

    const [pings, events] = await Promise.all([
      prisma.locationPing.deleteMany({
        where: { tenantId: tenant.id, recordedAt: { lt: cutoff } },
      }),
      prisma.geofenceEvent.deleteMany({
        where: { tenantId: tenant.id, occurredAt: { lt: cutoff } },
      }),
    ]);

    const count = pings.count + events.count;
    if (count > 0) {
      total += count;
      detail.push(`${tenant.name} ${count} (${days}d)`);
    }
  }

  return {
    affected: total,
    summary: detail.length > 0 ? detail.join(' · ') : 'Nothing past retention',
  };
}

/**
 * Raise a DEVICE_OFFLINE alert for vehicles on an active trip that have
 * stopped reporting — a silent tracker is a safety gap, not a non-event.
 */
async function detectOfflineDevices(): Promise<JobResult> {
  const cutoff = new Date(Date.now() - env.DEVICE_OFFLINE_SECONDS * 1000);

  const staleTrips = await prisma.trip.findMany({
    where: {
      status: 'IN_PROGRESS',
      locationPings: { none: { recordedAt: { gte: cutoff } } },
    },
    select: { id: true, tenantId: true, vehicleId: true, driverId: true },
    take: 200,
  });

  let raised = 0;

  for (const trip of staleTrips) {
    // Avoid re-alerting every tick for the same ongoing outage.
    const recent = await prisma.safetyAlert.findFirst({
      where: {
        tripId: trip.id,
        type: 'DEVICE_OFFLINE',
        occurredAt: { gte: new Date(Date.now() - 15 * MINUTE) },
      },
      select: { id: true },
    });
    if (recent) continue;

    await prisma.safetyAlert.create({
      data: {
        tenantId: trip.tenantId,
        type: 'DEVICE_OFFLINE',
        severity: 'WARNING',
        vehicleId: trip.vehicleId,
        tripId: trip.id,
        driverId: trip.driverId,
        message: `No GPS signal for over ${env.DEVICE_OFFLINE_SECONDS} seconds`,
      },
    });
    raised++;
  }

  if (raised > 0) log.warn({ count: raised }, 'Offline tracking devices detected');

  return {
    affected: raised,
    summary: raised > 0 ? `${raised} devices offline` : 'All active trips reporting',
  };
}

/**
 * Close trips left running overnight.
 *
 * A driver who closes the app without ending the trip leaves it IN_PROGRESS
 * indefinitely, which poisons every "active trips" count, pins the vehicle on
 * the live map, and makes the offline-device job alert forever.
 */
async function closeStaleTrips(): Promise<JobResult> {
  const cutoff = new Date(Date.now() - 12 * HOUR);

  const stale = await prisma.trip.findMany({
    where: { status: 'IN_PROGRESS', startedAt: { lt: cutoff } },
    select: { id: true },
    take: 200,
  });

  if (stale.length === 0) return { affected: 0, summary: 'No stale trips' };

  const { count } = await prisma.trip.updateMany({
    where: { id: { in: stale.map((t) => t.id) } },
    data: {
      status: 'COMPLETED',
      endedAt: new Date(),
      notes: 'Auto-closed: trip left open by the driver app',
    },
  });

  return { affected: count, summary: `${count} trips auto-closed` };
}

/** Keep the Prometheus gauge in step with reality. */
async function refreshTripGauge(): Promise<JobResult> {
  const count = await prisma.trip.count({ where: { status: 'IN_PROGRESS' } });
  activeTripsGauge.set(count);
  return { affected: count, summary: `${count} trips in progress` };
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

/** Flag invoices whose due date has passed so dashboards and reminders agree. */
async function markOverdueInvoices(): Promise<JobResult> {
  const { count } = await prisma.invoice.updateMany({
    where: {
      status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
      dueDate: { lt: new Date() },
    },
    data: { status: 'OVERDUE' },
  });

  return { affected: count, summary: count > 0 ? `${count} invoices marked overdue` : 'None due' };
}

/**
 * PRD 5.5: "Invoice generation and automated due reminders (SMS/Email/Push)."
 *
 * Reminders follow a fixed ladder — three days before the due date, and then
 * weekly once overdue. The ladder is what stops this being either a single
 * ignorable message or a daily nag. `lastReminderAt` is the idempotency guard,
 * so a restart mid-run cannot double-send.
 */
async function sendFeeReminders(): Promise<JobResult> {
  const now = new Date();
  const inThreeDays = new Date(now.getTime() + 3 * DAY);
  const aWeekAgo = new Date(now.getTime() - 7 * DAY);

  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
      cancelledAt: null,
      OR: [
        // Approaching or newly due, never reminded.
        { dueDate: { lte: inThreeDays }, lastReminderAt: null },
        // Overdue, and last reminded over a week ago.
        { status: 'OVERDUE', lastReminderAt: { lt: aWeekAgo } },
      ],
    },
    take: 200,
    orderBy: { dueDate: 'asc' },
    select: {
      id: true,
      tenantId: true,
      invoiceNo: true,
      dueDate: true,
      balanceAmount: true,
      status: true,
      studentId: true,
      student: { select: { firstName: true, lastName: true } },
    },
  });

  if (invoices.length === 0) return { affected: 0, summary: 'No reminders due' };

  let sent = 0;

  for (const invoice of invoices) {
    const outstanding = Number(invoice.balanceAmount);
    // A zero balance means it was paid between the flag and this run.
    if (outstanding <= 0) continue;

    const recipients = await guardianUserIds([invoice.studentId]);
    if (recipients.length === 0) continue;

    const overdue = invoice.status === 'OVERDUE';
    const studentName = `${invoice.student.firstName} ${invoice.student.lastName}`.trim();
    const due = invoice.dueDate.toLocaleDateString('en-IN');

    await notify({
      tenantId: invoice.tenantId,
      userIds: recipients,
      title: overdue ? `Fee overdue for ${studentName}` : `Fee due for ${studentName}`,
      body: overdue
        ? `Invoice ${invoice.invoiceNo} of ${formatCurrency(outstanding)} has been overdue since ${due}. Please pay at the earliest.`
        : `Invoice ${invoice.invoiceNo} of ${formatCurrency(outstanding)} is due on ${due}.`,
      channels: ['IN_APP', 'PUSH'],
      priority: overdue ? 'HIGH' : 'NORMAL',
      module: 'fees',
      actionUrl: '/fees',
      templateKey: overdue ? 'fees.overdue' : 'fees.due_reminder',
      templateVars: {
        studentName,
        invoiceNo: invoice.invoiceNo,
        amount: formatCurrency(outstanding),
        dueDate: due,
      },
      data: { invoiceId: invoice.id, outstanding },
    });

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { lastReminderAt: new Date(), reminderCount: { increment: 1 } },
    });
    sent++;
  }

  return { affected: sent, summary: `${sent} fee reminders sent` };
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

/**
 * Move loans past their due date into OVERDUE and accrue the fine.
 *
 * The fine half of PRD 5.7 was previously missing — the status flipped but
 * `fineAmount` stayed at zero, so the librarian's dues report always read
 * nothing owed. The per-day rate comes from the school's settings, falling
 * back to a sane default rather than silently charging nothing.
 */
async function accrueLibraryFines(): Promise<JobResult> {
  const now = new Date();

  const loans = await prisma.bookLoan.findMany({
    where: {
      status: { in: ['ISSUED', 'OVERDUE'] },
      dueDate: { lt: now },
      returnedAt: null,
    },
    take: 500,
    select: {
      id: true,
      dueDate: true,
      fineAmount: true,
      status: true,
      student: { select: { id: true, tenantId: true, userId: true } },
      employee: { select: { tenantId: true, userId: true } },
      bookCopy: { select: { book: { select: { title: true, tenantId: true } } } },
    },
  });

  if (loans.length === 0) return { affected: 0, summary: 'No overdue loans' };

  // One settings read per school, not per loan.
  const rates = new Map<string, number>();
  const rateFor = async (tenantId: string): Promise<number> => {
    const cached = rates.get(tenantId);
    if (cached !== undefined) return cached;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const configured = (tenant?.settings as { libraryFinePerDay?: unknown } | null)?.[
      'libraryFinePerDay'
    ];
    const rate = typeof configured === 'number' && configured >= 0 ? configured : DEFAULT_FINE_PER_DAY;

    rates.set(tenantId, rate);
    return rate;
  };

  let updated = 0;

  for (const loan of loans) {
    const daysLate = Math.floor((now.getTime() - loan.dueDate.getTime()) / DAY);
    if (daysLate < 1) continue;

    const tenantId = loan.bookCopy.book.tenantId;
    const fine = Number(((await rateFor(tenantId)) * daysLate).toFixed(2));

    // This runs hourly — only write when something actually changed.
    const wasOverdue = loan.status === 'OVERDUE';
    if (wasOverdue && Number(loan.fineAmount) === fine) continue;

    await prisma.bookLoan.update({
      where: { id: loan.id },
      data: { status: 'OVERDUE', fineAmount: fine },
    });
    updated++;

    // Notify once, on the transition into overdue — not on every accrual.
    if (wasOverdue) continue;

    const borrowerUserId = loan.student?.userId ?? loan.employee?.userId ?? null;
    const guardians = loan.student ? await guardianUserIds([loan.student.id]) : [];
    const recipients = [...new Set([borrowerUserId, ...guardians].filter(Boolean))] as string[];
    if (recipients.length === 0) continue;

    await notify({
      tenantId,
      userIds: recipients,
      title: 'Library book overdue',
      body: `"${loan.bookCopy.book.title}" was due on ${loan.dueDate.toLocaleDateString('en-IN')}.${
        fine > 0 ? ` A fine of ${formatCurrency(fine)} has accrued.` : ''
      }`,
      channels: ['IN_APP', 'PUSH'],
      priority: 'NORMAL',
      module: 'library',
      actionUrl: '/library',
      templateKey: 'library.overdue',
      templateVars: {
        bookTitle: loan.bookCopy.book.title,
        dueDate: loan.dueDate.toLocaleDateString('en-IN'),
        fine: formatCurrency(fine),
      },
    });
  }

  return { affected: updated, summary: `${updated} loans updated` };
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * PRD gap "Analytics & AI-assisted insights": at-risk student prediction from
 * attendance and grade trend, plus fee-default risk.
 *
 * The scoring is deliberately transparent rather than clever. Each factor is
 * a plain threshold and every score is stored with the sentences that produced
 * it, because a teacher acting on this needs to see *why* a child is flagged.
 * An opaque score would be ignored, and rightly so.
 */
async function refreshRiskScores(): Promise<JobResult> {
  const since = new Date(Date.now() - 60 * DAY);

  const students = await prisma.student.findMany({
    where: { status: 'ACTIVE' },
    take: 5_000,
    select: {
      id: true,
      attendanceRecords: {
        where: { session: { date: { gte: since } } },
        select: { status: true },
      },
      markEntries: {
        where: { createdAt: { gte: since }, isAbsent: false },
        select: { percentage: true },
      },
      invoices: { where: { status: 'OVERDUE' }, select: { id: true } },
    },
  });

  let flagged = 0;
  let cleared = 0;

  for (const student of students) {
    /** riskType -> [score, factor sentences] */
    const risks: Array<{ type: string; score: number; factors: string[] }> = [];

    const sessions = student.attendanceRecords.length;
    if (sessions >= 10) {
      const present = student.attendanceRecords.filter(
        (r) => r.status === 'PRESENT' || r.status === 'LATE',
      ).length;
      const rate = present / sessions;
      const percent = Math.round(rate * 100);

      if (rate < 0.6) {
        risks.push({
          type: 'ATTENDANCE',
          score: 85,
          factors: [`Attendance ${percent}% over ${sessions} sessions — critically low`],
        });
      } else if (rate < 0.75) {
        risks.push({
          type: 'ATTENDANCE',
          score: 55,
          factors: [`Attendance ${percent}% over ${sessions} sessions — below the 75% threshold`],
        });
      }
    }

    const graded = student.markEntries.filter((m) => m.percentage !== null);
    if (graded.length >= 3) {
      const average =
        graded.reduce((sum, m) => sum + Number(m.percentage), 0) / graded.length;

      if (average < 35) {
        risks.push({
          type: 'ACADEMIC',
          score: 85,
          factors: [`Average ${Math.round(average)}% across ${graded.length} assessments — failing`],
        });
      } else if (average < 50) {
        risks.push({
          type: 'ACADEMIC',
          score: 50,
          factors: [`Average ${Math.round(average)}% across ${graded.length} assessments — trending low`],
        });
      }
    }

    if (student.invoices.length > 0) {
      risks.push({
        type: 'FEE_DEFAULT',
        score: Math.min(90, 40 + student.invoices.length * 15),
        factors: [`${student.invoices.length} overdue invoice(s)`],
      });
    }

    const keepTypes = new Set(risks.map((r) => r.type));

    for (const risk of risks) {
      const band = risk.score >= 70 ? 'HIGH' : risk.score >= 40 ? 'MEDIUM' : 'LOW';

      await prisma.studentRiskScore.upsert({
        where: { studentId_riskType: { studentId: student.id, riskType: risk.type } },
        create: {
          studentId: student.id,
          riskType: risk.type,
          score: risk.score,
          band,
          factors: risk.factors as never,
          computedAt: new Date(),
        },
        update: { score: risk.score, band, factors: risk.factors as never, computedAt: new Date() },
      });
      flagged++;
    }

    // A student who has recovered must stop being flagged, or the list only
    // ever grows and the teachers stop reading it.
    const stale = await prisma.studentRiskScore.deleteMany({
      where: { studentId: student.id, riskType: { notIn: [...keepTypes] } },
    });
    cleared += stale.count;
  }

  return {
    affected: flagged,
    summary: `${flagged} risk flags written, ${cleared} cleared`,
  };
}

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

/** Retry notification deliveries that failed with backoff scheduled. */
async function retryFailedNotifications(): Promise<JobResult> {
  const due = await prisma.notificationDelivery.findMany({
    where: {
      status: 'FAILED',
      nextRetryAt: { lte: new Date() },
      attemptCount: { lt: 3 },
    },
    take: 100,
    select: { id: true },
  });

  if (due.length === 0) return { affected: 0, summary: 'Nothing to retry' };

  const { dispatchDelivery } = await import('../notifications/notification.service.js');
  for (const delivery of due) {
    await dispatchDelivery(delivery.id);
  }

  return { affected: due.length, summary: `${due.length} deliveries retried` };
}

/** Drop expired and long-revoked refresh tokens. */
async function cleanupTokens(): Promise<JobResult> {
  const count = await pruneExpiredTokens();
  return { affected: count, summary: `${count} tokens pruned` };
}

/** Housekeeping for the job log itself, so it cannot grow without bound. */
async function pruneJobRuns(): Promise<JobResult> {
  const { count } = await prisma.jobRun.deleteMany({
    where: { startedAt: { lt: new Date(Date.now() - 30 * DAY) } },
  });
  return { affected: count, summary: `${count} old run records removed` };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const JOBS: JobDefinition[] = [
  {
    name: 'purge-location-history',
    label: 'Purge location history',
    relatesTo: 'PRD §6.3 — configurable location retention, per school',
    description:
      "Deletes GPS pings and geofence events older than each school's own retention window. Access logs are kept.",
    intervalMs: 6 * HOUR,
    manualRunnable: true,
    run: purgeLocationHistory,
  },
  {
    name: 'detect-offline-devices',
    label: 'Detect offline trackers',
    relatesTo: 'PRD §6.1 — live location every 10–15s',
    description: 'Raises a DEVICE_OFFLINE alert for in-progress trips that have stopped reporting.',
    intervalMs: 2 * MINUTE,
    manualRunnable: true,
    run: detectOfflineDevices,
  },
  {
    name: 'close-stale-trips',
    label: 'Close abandoned trips',
    relatesTo: 'PRD §5.8 — transport data hygiene',
    description: 'Completes trips still in progress more than 12 hours after they started.',
    intervalMs: HOUR,
    manualRunnable: true,
    run: closeStaleTrips,
  },
  {
    name: 'refresh-trip-gauge',
    label: 'Refresh trip metrics',
    relatesTo: 'PRD §8.1 — Prometheus observability',
    description: 'Keeps the active-trips gauge in step with the database.',
    intervalMs: MINUTE,
    manualRunnable: false,
    run: refreshTripGauge,
  },
  {
    name: 'mark-overdue-invoices',
    label: 'Mark overdue invoices',
    relatesTo: 'PRD §5.5 — due/overdue tracking',
    description: 'Moves issued and part-paid invoices past their due date into OVERDUE.',
    intervalMs: HOUR,
    manualRunnable: true,
    run: markOverdueInvoices,
  },
  {
    name: 'send-fee-reminders',
    label: 'Send fee reminders',
    relatesTo: 'PRD §5.5 — automated due reminders (SMS/Email/Push)',
    description:
      'Notifies guardians three days before the due date, then weekly while the invoice stays overdue.',
    intervalMs: 6 * HOUR,
    manualRunnable: true,
    run: sendFeeReminders,
  },
  {
    name: 'accrue-library-fines',
    label: 'Accrue library fines',
    relatesTo: 'PRD §5.7 — overdue tracking and fine calculation',
    description: 'Flags overdue loans and accrues the per-day fine, notifying on the transition.',
    intervalMs: HOUR,
    manualRunnable: true,
    run: accrueLibraryFines,
  },
  {
    name: 'refresh-risk-scores',
    label: 'Refresh at-risk scores',
    relatesTo: 'PRD §10 gap — at-risk student prediction, fee-default risk scoring',
    description:
      'Rescores every active student on attendance, assessment average and overdue fees, with the reasons stored.',
    intervalMs: 12 * HOUR,
    manualRunnable: true,
    run: refreshRiskScores,
  },
  {
    name: 'retry-notifications',
    label: 'Retry failed notifications',
    relatesTo: 'PRD §10 gap — delivery retries, DLR/bounce tracking',
    description: 'Re-dispatches failed deliveries whose backoff window has elapsed, up to 3 tries.',
    intervalMs: 5 * MINUTE,
    manualRunnable: true,
    run: retryFailedNotifications,
  },
  {
    name: 'cleanup-tokens',
    label: 'Prune refresh tokens',
    relatesTo: 'PRD §9.2 — refresh-token rotation hygiene',
    description: 'Drops expired tokens and those revoked more than seven days ago.',
    intervalMs: 6 * HOUR,
    manualRunnable: true,
    run: cleanupTokens,
  },
  {
    name: 'prune-job-runs',
    label: 'Prune job history',
    relatesTo: 'Operational hygiene',
    description: 'Removes scheduler run records older than 30 days.',
    intervalMs: 24 * HOUR,
    manualRunnable: true,
    run: pruneJobRuns,
  },
];

const JOB_BY_NAME = new Map(JOBS.map((j) => [j.name, j]));

export function findJob(name: string): JobDefinition | undefined {
  return JOB_BY_NAME.get(name);
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/** Jobs currently executing, so a slow tick is skipped rather than stacked. */
const inFlight = new Set<string>();

export interface RunOutcome {
  job: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  durationMs: number;
  affected: number;
  summary: string | null;
  error: string | null;
}

/**
 * Execute one job and record the outcome.
 *
 * Never throws: the caller is either a timer, which must keep ticking, or an
 * HTTP handler, which reports the failure as data rather than a 500.
 */
export async function runJob(
  definition: JobDefinition,
  options: { manual?: boolean; triggeredById?: string } = {},
): Promise<RunOutcome> {
  if (inFlight.has(definition.name)) {
    log.debug({ job: definition.name }, 'Previous run still in flight — skipping');
    return {
      job: definition.name,
      status: 'SKIPPED',
      durationMs: 0,
      affected: 0,
      summary: 'Previous run still in progress',
      error: null,
    };
  }

  inFlight.add(definition.name);
  const startedAt = Date.now();

  // Written up front so a job that hangs shows as RUNNING rather than being
  // absent — "it never started" and "it never finished" are different faults.
  const record = await prisma.jobRun
    .create({
      data: {
        job: definition.name,
        manual: options.manual ?? false,
        triggeredById: options.triggeredById ?? null,
      },
      select: { id: true },
    })
    .catch(() => null);

  try {
    const result = await definition.run();
    const durationMs = Date.now() - startedAt;

    if (record) {
      await prisma.jobRun.update({
        where: { id: record.id },
        data: {
          status: 'SUCCESS',
          finishedAt: new Date(),
          durationMs,
          affected: result.affected,
          summary: result.summary ?? null,
        },
      });
    }

    const payload = { job: definition.name, durationMs, affected: result.affected };
    if (result.affected > 0) log.info(payload, result.summary ?? 'Job completed');
    else log.debug(payload, 'Job completed');

    return {
      job: definition.name,
      status: 'SUCCESS',
      durationMs,
      affected: result.affected,
      summary: result.summary ?? null,
      error: null,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);

    if (record) {
      await prisma.jobRun
        .update({
          where: { id: record.id },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            durationMs,
            error: message.slice(0, 1000),
          },
        })
        .catch(() => undefined);
    }

    log.error({ err, job: definition.name, durationMs }, 'Job failed');

    return {
      job: definition.name,
      status: 'FAILED',
      durationMs,
      affected: 0,
      summary: null,
      error: message,
    };
  } finally {
    inFlight.delete(definition.name);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const timers: NodeJS.Timeout[] = [];

export function startScheduledJobs(): void {
  JOBS.forEach((definition, index) => {
    const tick = () => void runJob(definition);

    timers.push(setInterval(tick, definition.intervalMs));

    // Stagger the first run so boot does not fire eleven queries at once
    // against a hosted database already busy serving the login request.
    const kickoff = setTimeout(tick, 30_000 + index * 5_000);
    kickoff.unref();
    timers.push(kickoff);
  });

  log.info({ jobs: JOBS.length }, 'Scheduled jobs started');
}

export function stopScheduledJobs(): void {
  // `clearInterval` and `clearTimeout` are interchangeable in Node — both take
  // a Timeout — so one loop clears the intervals and the kickoffs alike.
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
  log.info('Scheduled jobs stopped');
}
