/** Prisma client singleton with query logging and graceful shutdown. */

import { PrismaClient } from '@prisma/client';
import { env, isDevelopment, isProduction } from '../../config/env.js';
import { moduleLogger } from '../logger.js';

const log = moduleLogger('prisma');

/**
 * In development, `tsx watch` reloads modules on every save. Caching the client
 * on `globalThis` stops each reload from opening a fresh connection pool and
 * exhausting Postgres's connection limit.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    transactionOptions: {
      // Prisma's 5s default assumes a local database. Every statement inside an
      // interactive transaction is a separate round trip, so against a hosted
      // Postgres a multi-step write (admitting a student, running payroll)
      // exceeds it easily. Work inside transactions is still kept minimal —
      // this is headroom for latency, not licence to do reads in there.
      timeout: 30_000,
      maxWait: 10_000,
    },
    log: isProduction
      ? [{ emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }]
      : [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'warn' },
        ],
  });

/**
 * Slow-query threshold.
 *
 * 200ms is the right bar for a database on localhost, but a hosted one adds
 * 100-300ms of round-trip to *every* query, so that threshold turns the log
 * into noise and hides the queries that are genuinely slow. Detect a remote
 * host and raise the bar accordingly; override with SLOW_QUERY_MS.
 */
const SLOW_QUERY_MS = (() => {
  const override = Number(process.env['SLOW_QUERY_MS']);
  if (Number.isFinite(override) && override > 0) return override;

  const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(env.DATABASE_URL);
  return isLocal ? 200 : 1500;
})();

if (isDevelopment) {
  globalForPrisma.prisma = prisma;

  // Surface slow queries during development so N+1s are obvious early.
  prisma.$on('query' as never, (e: { query: string; duration: number; params: string }) => {
    if (e.duration >= SLOW_QUERY_MS) {
      log.warn({ durationMs: e.duration, thresholdMs: SLOW_QUERY_MS }, 'Slow query');
    }
  });
}

prisma.$on('error' as never, (e: { message: string }) => {
  log.error({ err: e.message }, 'Prisma error');
});

prisma.$on('warn' as never, (e: { message: string }) => {
  log.warn({ msg: e.message }, 'Prisma warning');
});

/**
 * Connect, retrying on the transient failures a serverless Postgres produces.
 *
 * Neon (and Aurora Serverless, and Supabase's free tier) suspend an idle
 * compute and take several seconds to resume, during which the first
 * connection is refused outright. Treating that as fatal means the API dies
 * every time it is started after a quiet period, which is exactly when someone
 * is trying to use it.
 */
export async function connectDatabase(attempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await prisma.$connect();
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const coldStart = /P1001|Can't reach database server|Connection terminated|timeout/i.test(message);

      if (!coldStart || attempt === attempts) throw err;

      // Linear backoff: a resuming compute is usually ready within ~10s.
      const waitMs = 2000 * attempt;
      log.warn(
        { attempt, attempts, waitMs },
        'Database unreachable — it may be resuming from idle, retrying',
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  const [row] = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version()`;
  log.info({ version: row?.version?.split(',')[0] }, 'Database connected');

  // PostGIS backs the geofence and route-deviation engines. Without it the
  // tracking module silently degrades, so warn loudly at boot.
  const ext = await prisma.$queryRaw<Array<{ extname: string }>>`
    SELECT extname FROM pg_extension WHERE extname = 'postgis'
  `;
  if (ext.length === 0) {
    log.warn(
      'PostGIS extension is not installed — run prisma/sql/01_postgis.sql before using GPS features',
    );
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  log.info('Database disconnected');
}

/** Lightweight liveness probe used by `/health`. */
export async function databaseHealthy(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
