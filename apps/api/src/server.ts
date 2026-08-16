/**
 * Process entry point: boot dependencies, start listening, shut down cleanly.
 *
 * Startup is fail-fast — if the database is unreachable we exit rather than
 * serving a half-working API that returns 500s.
 */

import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './core/logger.js';
import { connectDatabase, disconnectDatabase } from './core/db/prisma.js';
import { disposeStore } from './core/cache/store.js';
import { closeSocketServer, initSocketServer } from './core/realtime/socket.js';
import { connectMqtt, disconnectMqtt } from './core/realtime/mqtt.js';
import { startScheduledJobs, stopScheduledJobs } from './core/jobs/scheduler.js';

async function bootstrap(): Promise<void> {
  logger.info(
    { env: env.NODE_ENV, port: env.PORT, prefix: env.API_PREFIX },
    'Starting EduSphere School ERP API',
  );

  await connectDatabase();

  const app = createApp();
  const httpServer = createServer(app);

  initSocketServer(httpServer);

  // MQTT is optional — hardware trackers use it, the driver app uses WebSocket.
  if (env.MQTT_ENABLED) {
    await connectMqtt();
  }

  startScheduledJobs();

  await new Promise<void>((resolve) => {
    httpServer.listen(env.PORT, () => resolve());
  });

  logger.info(
    `API listening on http://localhost:${env.PORT}${env.API_PREFIX} · docs at /docs`,
  );

  registerShutdownHandlers(httpServer);
}

function registerShutdownHandlers(httpServer: ReturnType<typeof createServer>): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    // A second Ctrl-C during shutdown should not re-enter this path.
    if (shuttingDown) {
      logger.warn('Force exit');
      process.exit(1);
    }
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');

    // Stop accepting work before tearing down the resources it depends on.
    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 15_000);
    forceExit.unref();

    try {
      stopScheduledJobs();
      await closeSocketServer();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await disconnectMqtt();
      disposeStore();
      await disconnectDatabase();

      clearTimeout(forceExit);
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled promise rejection');
    void shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    void shutdown('uncaughtException');
  });
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to start API');
  process.exit(1);
});
