/**
 * Express application assembly.
 *
 * Middleware order is deliberate:
 *   security headers -> CORS -> body parsing -> request id -> logging
 *   -> rate limiting -> routes -> 404 -> error handler
 */

import express, { type Application, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import crypto from 'node:crypto';
import { env, isProduction } from './config/env.js';
import { logger } from './core/logger.js';
import { errorHandler, notFoundHandler } from './core/errors/errorHandler.js';
import { AppError } from './core/errors/AppError.js';
import { databaseHealthy } from './core/db/prisma.js';
import { redis, redisHealthy, usingMemoryFallback } from './core/cache/redis.js';
import { metricsHandler, metricsMiddleware } from './core/observability/metrics.js';
import { registerRoutes } from './modules/index.js';

/**
 * Is this origin a loopback address?
 *
 * Parsed with `URL` rather than matched with a regex, so a hostile origin like
 * `http://localhost.attacker.com` cannot slip through on a prefix match.
 */
function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}

export function createApp(): Application {
  const app = express();

  // Behind a load balancer, `req.ip` and rate limiting need the real client IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // -- Security ------------------------------------------------------------
  app.use(
    helmet({
      contentSecurityPolicy: isProduction ? undefined : false,
      crossOriginEmbedderPolicy: false,
      // Map tiles and avatars are served from other origins.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and native mobile clients send no Origin header.
        if (!origin || env.CORS_ORIGINS.includes(origin)) {
          return callback(null, true);
        }

        // Vite picks the next free port when its default is taken, so in
        // development any loopback origin is accepted rather than forcing the
        // allowlist to be edited every time the port shifts. Production still
        // honours CORS_ORIGINS exactly.
        if (!isProduction && isLoopbackOrigin(origin)) {
          return callback(null, true);
        }

        // A rejected origin is a deliberate 403, not a crash — throwing a bare
        // Error here would surface as a 500 with a stack trace.
        callback(AppError.forbidden(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Tenant-Id'],
      exposedHeaders: ['X-Request-Id', 'X-Total-Count'],
      maxAge: 86400,
    }),
  );

  // -- Parsing -------------------------------------------------------------
  app.use(
    express.json({
      limit: '2mb',
      // Retain the raw body so payment webhooks can verify their signature.
      verify: (req, _res, buf) => {
        if (req.url?.includes('/webhooks/')) {
          (req as Request & { rawBody?: Buffer }).rawBody = buf;
        }
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());
  app.use(compression());

  // -- Correlation id ------------------------------------------------------
  app.use((req, res, next) => {
    const incoming = req.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && incoming.length > 0 ? incoming : crypto.randomUUID();

    req.requestId = requestId;
    res.locals['requestId'] = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });

  // -- Request logging -----------------------------------------------------
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      // Health and metrics polling would otherwise dominate the log volume.
      if (req.path === '/health' || req.path === '/metrics') return;

      const payload = {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        userId: req.auth?.userId,
      };

      if (res.statusCode >= 500) logger.error(payload, 'Request failed');
      else if (res.statusCode >= 400) logger.warn(payload, 'Request rejected');
      else logger.info(payload, 'Request completed');
    });

    next();
  });

  if (env.METRICS_ENABLED) {
    app.use(metricsMiddleware);
  }

  // -- Rate limiting -------------------------------------------------------
  // Backed by Redis when available so the limit is global rather than
  // per-instance; falls back to the library's in-memory store otherwise.
  const limiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(usingMemoryFallback
      ? {}
      : {
          store: new RedisStore({
            sendCommand: (...args: string[]) =>
              redis.call(...(args as [string, ...string[]])) as never,
            prefix: `${env.REDIS_KEY_PREFIX}rl:`,
          }),
        }),
    // Authenticated callers are limited per user, anonymous ones per IP.
    keyGenerator: (req) => req.auth?.userId ?? req.ip ?? 'unknown',
    skip: (req) => req.path === '/health' || req.path === '/metrics',
    message: {
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down' },
    },
  });
  app.use(limiter);

  // -- Operational endpoints ----------------------------------------------
  app.get('/health', async (_req: Request, res: Response) => {
    const [db, cache] = await Promise.all([databaseHealthy(), redisHealthy()]);
    const healthy = db && cache;

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      version: process.env['npm_package_version'] ?? '1.0.0',
      checks: { database: db ? 'up' : 'down', redis: cache ? 'up' : 'down' },
    });
  });

  /** Kubernetes readiness probe — distinct from liveness above. */
  app.get('/ready', async (_req: Request, res: Response) => {
    const db = await databaseHealthy();
    res.status(db ? 200 : 503).json({ ready: db });
  });

  if (env.METRICS_ENABLED) {
    app.get('/metrics', metricsHandler);
  }

  // -- Application routes --------------------------------------------------
  registerRoutes(app);

  // -- Fallbacks -----------------------------------------------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
