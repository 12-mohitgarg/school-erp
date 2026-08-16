/** Prometheus metrics (PRD 8.1: Prometheus + Grafana). */

import type { Request, RequestHandler, Response } from 'express';
import client from 'prom-client';

export const registry = new client.Registry();

client.collectDefaultMetrics({
  register: registry,
  prefix: 'erp_',
});

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const httpRequestDuration = new client.Histogram({
  name: 'erp_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  // Buckets straddle the PRD's <2s p95 page-load target.
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

const httpRequestsTotal = new client.Counter({
  name: 'erp_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Domain metrics
// ---------------------------------------------------------------------------

export const gpsPingsReceived = new client.Counter({
  name: 'erp_gps_pings_received_total',
  help: 'Location pings ingested from tracking devices',
  labelNames: ['transport'] as const,
  registers: [registry],
});

export const gpsIngestDuration = new client.Histogram({
  name: 'erp_gps_ingest_duration_seconds',
  help: 'Time to process one location ping end to end',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [registry],
});

export const activeTripsGauge = new client.Gauge({
  name: 'erp_active_trips',
  help: 'Trips currently in progress',
  registers: [registry],
});

export const connectedSocketsGauge = new client.Gauge({
  name: 'erp_connected_sockets',
  help: 'Currently connected WebSocket clients',
  labelNames: ['role'] as const,
  registers: [registry],
});

export const sosAlertsTotal = new client.Counter({
  name: 'erp_sos_alerts_total',
  help: 'SOS alerts raised',
  labelNames: ['status'] as const,
  registers: [registry],
});

export const notificationsDispatched = new client.Counter({
  name: 'erp_notifications_dispatched_total',
  help: 'Notifications handed to a delivery channel',
  labelNames: ['channel', 'status'] as const,
  registers: [registry],
});

export const paymentsProcessed = new client.Counter({
  name: 'erp_payments_processed_total',
  help: 'Payment attempts by gateway and outcome',
  labelNames: ['gateway', 'status'] as const,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Record duration and count per request.
 *
 * `req.route?.path` is used rather than the raw URL so that `/students/:id`
 * is one label instead of one label per student id — unbounded label
 * cardinality is the classic way to melt a Prometheus server.
 */
export const metricsMiddleware: RequestHandler = (req, res, next) => {
  const end = httpRequestDuration.startTimer();

  res.on('finish', () => {
    const route = req.route?.path
      ? `${req.baseUrl}${req.route.path}`
      : req.baseUrl || 'unmatched';
    const labels = {
      method: req.method,
      route,
      status: String(res.statusCode),
    };
    end(labels);
    httpRequestsTotal.inc(labels);
  });

  next();
};

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.setHeader('Content-Type', registry.contentType);
  res.send(await registry.metrics());
}
