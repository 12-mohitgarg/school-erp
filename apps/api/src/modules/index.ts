/**
 * Route registry.
 *
 * Every feature module exports a default Express router and is mounted here
 * under the versioned API prefix. Keeping registration in one place makes the
 * public surface of the API auditable at a glance.
 */

import type { Application } from 'express';
import { env } from '../config/env.js';
import { authenticate } from '../core/auth/middleware.js';
import { serveOpenApi } from '../core/docs/openapi.js';

import authRoutes from './auth/auth.routes.js';
import academicRoutes from './academic/academic.routes.js';
import studentRoutes from './students/student.routes.js';
import attendanceRoutes from './attendance/attendance.routes.js';
import examinationRoutes from './examination/examination.routes.js';
import feesRoutes from './fees/fees.routes.js';
import hrRoutes from './hr/hr.routes.js';
import libraryRoutes from './library/library.routes.js';
import transportRoutes from './transport/transport.routes.js';
import trackingRoutes from './tracking/tracking.routes.js';
import inventoryRoutes from './inventory/inventory.routes.js';
import communicationRoutes from './communication/communication.routes.js';
import reportsRoutes from './reports/reports.routes.js';
import settingsRoutes from './settings/settings.routes.js';
import dashboardRoutes from './dashboard/dashboard.routes.js';

export function registerRoutes(app: Application): void {
  const prefix = env.API_PREFIX;

  // Interactive API reference.
  serveOpenApi(app);

  // Authentication is public at its edges (login, refresh, reset) and guards
  // its own authenticated routes internally.
  app.use(`${prefix}/auth`, authRoutes);

  // Everything below requires a valid access token. Mounting `authenticate`
  // here rather than inside each router means a new module cannot accidentally
  // ship unauthenticated.
  app.use(`${prefix}/dashboard`, authenticate, dashboardRoutes);
  app.use(`${prefix}/academic`, authenticate, academicRoutes);
  app.use(`${prefix}/students`, authenticate, studentRoutes);
  app.use(`${prefix}/attendance`, authenticate, attendanceRoutes);
  app.use(`${prefix}/examination`, authenticate, examinationRoutes);
  app.use(`${prefix}/fees`, authenticate, feesRoutes);
  app.use(`${prefix}/hr`, authenticate, hrRoutes);
  app.use(`${prefix}/library`, authenticate, libraryRoutes);
  app.use(`${prefix}/transport`, authenticate, transportRoutes);
  app.use(`${prefix}/inventory`, authenticate, inventoryRoutes);
  app.use(`${prefix}/communication`, authenticate, communicationRoutes);
  app.use(`${prefix}/reports`, authenticate, reportsRoutes);
  app.use(`${prefix}/settings`, authenticate, settingsRoutes);

  // Tracking mounts its own auth: the device-ingest endpoint authenticates
  // with a device token rather than a user JWT.
  app.use(`${prefix}/tracking`, trackingRoutes);
}
