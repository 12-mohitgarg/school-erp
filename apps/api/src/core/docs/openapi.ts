/** Interactive API reference served at `/docs`. */

import type { Application, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { env } from '../../config/env.js';
import { MODULE_LABELS, ROLE_DEFINITIONS } from '@erp/shared';

/**
 * Hand-maintained OpenAPI skeleton. Route-level detail lives with each module;
 * this document describes the cross-cutting contract — auth, the response
 * envelope, error codes and the tag set — which is what integrators need first.
 */
function buildSpec(): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: {
      title: 'EduSphere School ERP API',
      version: '1.0.0',
      description: [
        'Unified academic, administrative, financial and student-safety platform.',
        '',
        '### Authentication',
        'All endpoints except `/auth/login`, `/auth/refresh` and `/auth/forgot-password`',
        'require a bearer access token. Access tokens are short-lived; use',
        '`POST /auth/refresh` to rotate them. Refresh tokens rotate on every use and',
        'reuse of a spent token revokes the whole device session.',
        '',
        '### Authorisation',
        'Every route is guarded by a `module:action` permission and a data scope.',
        'A caller only ever sees rows inside their tenant, and inside their scope',
        '(own records, own children, assigned sections, branch, or whole tenant).',
        '',
        '### Response envelope',
        'Success: `{ "success": true, "data": ..., "meta"?: ... }`.',
        'Failure: `{ "success": false, "error": { "code", "message", "details"? } }`.',
      ].join('\n'),
      contact: { name: 'EduSphere Solutions' },
    },
    servers: [
      { url: `http://localhost:${env.PORT}${env.API_PREFIX}`, description: 'Local development' },
      { url: `https://api.example.com${env.API_PREFIX}`, description: 'Production' },
    ],
    tags: [
      { name: 'Auth', description: 'Sign-in, token rotation, sessions and consent' },
      { name: 'Dashboard', description: 'Role-aware KPI summary' },
      ...Object.entries(MODULE_LABELS).map(([key, label]) => ({
        name: label,
        description: `Endpoints under /${key}`,
      })),
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        deviceToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Device-Token',
          description: 'Used by GPS trackers posting to /tracking/location/update',
        },
      },
      schemas: {
        ApiError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'INSUFFICIENT_PERMISSIONS' },
                message: { type: 'string' },
                details: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
                requestId: { type: 'string', format: 'uuid' },
              },
            },
          },
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            limit: { type: 'integer' },
            total: { type: 'integer' },
            totalPages: { type: 'integer' },
            hasNext: { type: 'boolean' },
            hasPrev: { type: 'boolean' },
          },
        },
        LocationPing: {
          type: 'object',
          required: ['latitude', 'longitude'],
          properties: {
            latitude: { type: 'number', format: 'double', example: 28.6139 },
            longitude: { type: 'number', format: 'double', example: 77.209 },
            speed: { type: 'number', example: 32.5 },
            heading: { type: 'number', example: 187 },
            accuracy: { type: 'number', example: 8 },
            recordedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
      responses: {
        Unauthorized: { description: 'Missing or invalid access token',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
        Forbidden: { description: 'Authenticated but lacking the required permission or scope',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
        NotFound: { description: 'Resource not found, or outside the caller\'s tenant',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
        ValidationError: { description: 'Request failed schema validation',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Sign in with email or phone',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['identifier', 'password'],
                  properties: {
                    identifier: { type: 'string', example: 'admin@edusphere.local' },
                    password: { type: 'string', format: 'password' },
                    deviceId: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Signed in; returns the user, permissions and token pair' },
            401: { $ref: '#/components/responses/Unauthorized' },
            423: { description: 'Account locked after too many failed attempts' },
            429: { description: 'Rate limited' },
          },
        },
      },
      '/tracking/location/update': {
        post: {
          tags: ['Live GPS & Safety'],
          summary: 'Device or driver app reports a position',
          description: 'Authenticates with either a device token or a driver JWT.',
          security: [{ deviceToken: [] }, { bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LocationPing' } } },
          },
          responses: {
            201: { description: 'Position accepted and processed' },
            401: { $ref: '#/components/responses/Unauthorized' },
            409: { description: 'No trip in progress for this driver' },
          },
        },
      },
      '/tracking/student/{id}/live': {
        get: {
          tags: ['Live GPS & Safety'],
          summary: "A child's live location, route and stop ETAs",
          description:
            'Restricted to verified guardians with recorded consent, and to authorised administrators. Every call is written to the location access log.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Live view payload' },
            403: { $ref: '#/components/responses/Forbidden' },
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/tracking/sos': {
        post: {
          tags: ['Live GPS & Safety'],
          summary: 'Raise an emergency SOS alert',
          description:
            'Fans out to administrators and to the guardians of every student aboard, over in-app, push and SMS. EMERGENCY priority bypasses quiet hours and channel preferences.',
          responses: { 201: { description: 'Alert raised and dispatched' } },
        },
      },
    },
  };
}

export function serveOpenApi(app: Application): void {
  const spec = buildSpec();

  app.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(spec);
  });

  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: 'EduSphere School ERP — API reference',
      swaggerOptions: { persistAuthorization: true, docExpansion: 'list' },
    }),
  );

  /** Machine-readable RBAC matrix — useful for client-side gating and audits. */
  app.get('/rbac.json', (_req: Request, res: Response) => {
    res.json(
      Object.values(ROLE_DEFINITIONS).map((d) => ({
        role: d.role,
        label: d.label,
        scope: d.scope,
        homeRoute: d.homeRoute,
        permissions: d.permissions === '*' ? ['*'] : d.permissions,
      })),
    );
  });
}
