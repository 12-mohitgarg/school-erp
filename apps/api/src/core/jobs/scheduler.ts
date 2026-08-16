/**
 * Background jobs.
 *
 * Deliberately dependency-free (plain intervals rather than a cron library):
 * the job set is small and fixed, and each task is idempotent so a missed or
 * duplicated run is harmless. In a multi-replica deployment a Redis lock keeps
 * exactly one instance running each tick.
 */

import { prisma } from '../db/prisma.js';
import { redis } from '../cache/redis.js';
import { moduleLogger } from '../logger.js';
import { env } from '../../config/env.js';
import { pruneExpiredTokens } from '../auth/tokens.js';
import { activeTripsGauge } from '../observability/metrics.js';

const log = moduleLogger('jobs');

const timers: NodeJS.Timeout[] = [];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Only one replica should run a given job tick. `SET NX PX` gives us a cheap
 * distributed lock that self-expires if the holder crashes mid-run.
 */
async function withLock(name: string, ttlMs: number, task: () => Promise<void>): Promise<void> {
  const lockKey = `job:lock:${name}`;
  const token = `${process.pid}-${Date.now()}`;

  const acquired = await redis.set(lockKey, token, 'PX', ttlMs, 'NX');
  if (!acquired) return;

  const started = Date.now();
  try {
    await task();
    log.debug({ job: name, durationMs: Date.now() - started }, 'Job completed');
  } catch (err) {
    log.error({ err, job: name }, 'Job failed');
  } finally {
    // Release only if we still hold it — otherwise we would free someone
    // else's lock after our own run overran the TTL.
    const current = await redis.get(lockKey);
    if (current === token) await redis.del(lockKey);
  }
}

/** Register a task on an interval, running it once shortly after boot. */
function every(ms: number, name: string, task: () => Promise<void>): void {
  const run = () => void withLock(name, Math.min(ms, 10 * MINUTE), task);
  timers.push(setInterval(run, ms));
  // Stagger the initial run so all jobs do not fire at once on startup.
  const kickoff = setTimeout(run, 30_000 + timers.length * 5_000);
  timers.push(kickoff);
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** PRD 6.3: purge location history past the retention window. */
async function purgeLocationHistory(): Promise<void> {
  const cutoff = new Date(Date.now() - env.LOCATION_RETENTION_DAYS * 24 * HOUR);
  const { count } = await prisma.locationPing.deleteMany({
    where: { recordedAt: { lt: cutoff } },
  });
  if (count > 0) {
    log.info({ count, retentionDays: env.LOCATION_RETENTION_DAYS }, 'Purged location history');
  }
}

/** Flag invoices whose due date has passed so dashboards and reminders agree. */
async function markOverdueInvoices(): Promise<void> {
  const { count } = await prisma.invoice.updateMany({
    where: {
      status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
      dueDate: { lt: new Date() },
    },
    data: { status: 'OVERDUE' },
  });
  if (count > 0) log.info({ count }, 'Marked invoices overdue');
}

/** Move library loans past their due date into OVERDUE and accrue fines. */
async function markOverdueLoans(): Promise<void> {
  const { count } = await prisma.bookLoan.updateMany({
    where: { status: 'ISSUED', dueDate: { lt: new Date() } },
    data: { status: 'OVERDUE' },
  });
  if (count > 0) log.info({ count }, 'Marked loans overdue');
}

/**
 * Raise a DEVICE_OFFLINE alert for vehicles on an active trip that have
 * stopped reporting — a silent tracker is a safety gap, not a non-event.
 */
async function detectOfflineDevices(): Promise<void> {
  const cutoff = new Date(Date.now() - env.DEVICE_OFFLINE_SECONDS * 1000);

  const staleTrips = await prisma.trip.findMany({
    where: {
      status: 'IN_PROGRESS',
      locationPings: { none: { recordedAt: { gte: cutoff } } },
    },
    select: { id: true, tenantId: true, vehicleId: true, driverId: true },
    take: 200,
  });

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
  }

  if (staleTrips.length > 0) {
    log.warn({ count: staleTrips.length }, 'Offline tracking devices detected');
  }
}

/** Keep the Prometheus gauge in step with reality. */
async function refreshTripGauge(): Promise<void> {
  const count = await prisma.trip.count({ where: { status: 'IN_PROGRESS' } });
  activeTripsGauge.set(count);
}

/** Retry notification deliveries that failed with backoff scheduled. */
async function retryFailedNotifications(): Promise<void> {
  const due = await prisma.notificationDelivery.findMany({
    where: {
      status: 'FAILED',
      nextRetryAt: { lte: new Date() },
      attemptCount: { lt: 3 },
    },
    take: 100,
    select: { id: true },
  });

  if (due.length === 0) return;

  const { dispatchDelivery } = await import('../notifications/notification.service.js');
  for (const delivery of due) {
    await dispatchDelivery(delivery.id);
  }
  log.info({ count: due.length }, 'Retried failed notification deliveries');
}

/** Drop expired and long-revoked refresh tokens. */
async function cleanupTokens(): Promise<void> {
  const count = await pruneExpiredTokens();
  if (count > 0) log.info({ count }, 'Pruned refresh tokens');
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function startScheduledJobs(): void {
  every(30 * MINUTE, 'purge-location-history', purgeLocationHistory);
  every(HOUR, 'mark-overdue-invoices', markOverdueInvoices);
  every(HOUR, 'mark-overdue-loans', markOverdueLoans);
  every(2 * MINUTE, 'detect-offline-devices', detectOfflineDevices);
  every(MINUTE, 'refresh-trip-gauge', refreshTripGauge);
  every(5 * MINUTE, 'retry-notifications', retryFailedNotifications);
  every(6 * HOUR, 'cleanup-tokens', cleanupTokens);

  log.info({ jobs: 7 }, 'Scheduled jobs started');
}

export function stopScheduledJobs(): void {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
  log.info('Scheduled jobs stopped');
}
