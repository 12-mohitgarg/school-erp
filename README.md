# EduSphere — School ERP System

Unified academic, administrative, financial and student-safety platform, built to the
supplied PRD (`School_ERP_PRD_Professional_v2_Updated.pdf`) plus the workflow, panel
responsibility and web-vs-application documents.

**Running now against a live Neon Postgres database with 322 seeded students.**

---

## Quick start

```bash
npm install
npm run build --workspace=@erp/shared   # the API and web import its compiled types

# Terminal 1 — API on :4000
npm run dev:api

# Terminal 2 — web on :5173
npm run dev:web
```

Open **http://localhost:5173**. Password for every demo account is `Password@123`:

| Panel | Email |
|---|---|
| Super Admin | `superadmin@dpsdelhi.edu.in` |
| School Admin | `principal@dpsdelhi.edu.in` |
| Administration | `admin@dpsdelhi.edu.in` |
| Teacher | `teacher.math@dpsdelhi.edu.in` |
| Accountant | `accounts@dpsdelhi.edu.in` |
| Librarian | `library@dpsdelhi.edu.in` |
| HR | `hr@dpsdelhi.edu.in` |
| Student | `student@dpsdelhi.edu.in` |
| Parent | `parent.1a@example.com` |
| Driver | `driver@dpsdelhi.edu.in` |

The sign-in screen lists these as one-click buttons in development.

| Endpoint | Purpose |
|---|---|
| http://localhost:5173 | Web app |
| http://localhost:4000/api/v1 | API root |
| http://localhost:4000/docs | Swagger reference |
| http://localhost:4000/rbac.json | Machine-readable permission matrix |
| http://localhost:4000/health | Liveness + dependency checks |
| http://localhost:4000/metrics | Prometheus metrics |

To reseed: `npm run db:seed` (destructive — drops and rebuilds the demo tenant only).

---

## Status

| Area | State |
|---|---|
| Monorepo, shared RBAC package | **Done** |
| Database schema — 90 models, 13 modules, multi-tenant | **Done** — migrated to Neon |
| PostGIS spatial layer, geofence functions, retention purge | **Done** — verified live |
| Backend core — auth, RBAC, tenancy, audit, realtime, notifications, jobs, metrics | **Done** — typechecks clean |
| Backend feature modules — all 13 + dashboard | **Done** — typechecks clean |
| Seed data | **Done** — 322 students, 3,260 attendance records, 322 invoices |
| Web design system, app shell, auth | **Done** |
| Web panels — 25 screens | **Done** — typechecks and builds clean |
| CI (GitHub Actions) | **Done** |
| Mobile apps | Descoped by the client (web only) |
| K8s manifests | Not written |
| Automated test suite | Not written |

`npm run typecheck` passes across API, web and shared with zero errors.
`npm run build` produces a clean production bundle with per-route code splitting.

---

## Architecture

```
apps/
  api/                 Node + Express + TypeScript. REST + WebSocket + MQTT.
    prisma/            Schema, PostGIS SQL, seed
    src/config/        Zod-validated environment
    src/core/          auth · rbac · tenancy · audit · realtime · notifications · jobs · metrics · docs
    src/modules/       One folder per functional module
  web/                 React + TypeScript + Redux Toolkit + Tailwind
    src/components/    Design system, app shell, charts
    src/features/      One folder per panel area
packages/
  shared/              RBAC matrix, domain enums, API contracts, geo/grading helpers
infra/
  docker/              Local stack: Postgres+PostGIS, Redis, MQTT, MinIO, MailHog
  monitoring/          Prometheus scrape config
```

### The three guarantees the backend is built around

1. **Tenant isolation.** Every query filters on `tenantId` taken from the verified JWT —
   never from the request body. `core/tenancy/scope.ts` provides the builders.
2. **Data scope.** Inside a tenant, a role sees only what its `DataScope` allows —
   `SELF`, `CHILDREN`, `ASSIGNED`, `BRANCH` or `TENANT`. Verified: a parent's student
   list returns exactly their own children, and `GET /hr/employees` returns 403.
3. **Auditability.** Every write goes to an append-only `audit_logs` row with actor,
   before/after diff, IP and request id. Every *read* of a child's location additionally
   writes to `location_access_logs`, as PRD §6.3 requires.

### Live GPS pipeline

```
Driver app (WebSocket)  ─┐
                         ├─→ ingestLocation() ─→ persist ─→ cache last position
Hardware tracker (MQTT) ─┘                        │
                                                  ├─→ geofence engine   (edge-triggered, with cooldown)
                                                  ├─→ speed / route-deviation alerts
                                                  ├─→ stop ETA recompute
                                                  └─→ fan-out to Parent view + Admin dashboard
```

Both transports converge on one service, so the safety logic exists exactly once.
Geofence evaluation is *edge-triggered* — state is held per `(vehicle, fence)` and an
event fires only on transition; otherwise a parked bus would alert every 12 seconds.

---

## Technology

The stack the PRD specifies (§8.1):

| Layer | Technology |
|---|---|
| Web | React 18, TypeScript, Redux Toolkit + RTK Query, Tailwind CSS, Vite |
| Backend | Node.js, Express, TypeScript (REST + WebSocket) |
| Database | PostgreSQL + PostGIS, via Prisma |
| Cache & live buffer | Redis (with an in-memory fallback for local dev) |
| Realtime | Socket.IO with Redis adapter; MQTT for hardware trackers |
| Auth | JWT access tokens + rotating refresh tokens, bcrypt, AES-256-GCM vault |
| Storage | S3-compatible (MinIO locally) |
| Observability | Prometheus, pino structured logs, Sentry hook |
| CI | GitHub Actions |

### Two deliberate deviations, both reversible

- **Maps.** The map uses Leaflet with OpenStreetMap tiles rather than the Google Maps
  SDK, because it needs no API key and works immediately. Routes are already stored as
  Google-encoded polylines and the backend has `GOOGLE_MAPS_API_KEY` wired, so swapping
  to the Google SDK is a front-end component change only.
- **Redis.** If Redis is unreachable the API logs a warning and falls back to an
  in-memory cache so it still boots. That is single-process only — rate limits, geofence
  state and live positions stop being shared across replicas. Production must run real
  Redis; the boot log says so.

---

## Roles

Ten roles, defined once in `packages/shared/src/rbac.ts` and enforced by the API,
consumed by the web app for navigation:

| Role | Scope |
|---|---|
| Super Admin | Tenant-wide, unrestricted |
| School Admin · Administration · Accountant · Librarian · HR | Branch |
| Teacher | Assigned sections |
| Student | Self |
| Parent / Guardian | Their children |
| Bus Driver | Assigned route |

Permissions are `module:action` strings. Effective permissions =
role defaults (or a tenant's custom role) **+** per-user grants **−** per-user denials.
Denials always win. Hiding a nav link is a usability filter, never the access control —
the API re-checks every request.

---

## PRD gap-analysis items

All sixteen items from PRD §10 are modelled and implemented in the backend:

multi-tenancy · notification framework with templates, preferences, quiet hours, DLR
tracking and retry backoff · guardian onboarding with OTP invites and custody rules ·
assignments with rubrics and late penalties · timetable clash detection and substitution
engine · inventory, assets and purchase orders · GST-compliant invoicing with
reconciliation fields · append-only audit log · offline batch ingest for the driver app ·
DPDP consent ledger · configurable location retention with a nightly purge · integrations
catalogue with an encrypted credential vault · at-risk student scoring table ·
accessibility and localisation constants · NFR instrumentation.

---

## Database

Currently pointed at a hosted Neon Postgres 18 instance (`apps/api/.env`, gitignored).
The pool is capped at 5 connections — Neon's free tier allows far fewer concurrent
connections than Prisma's default, and exceeding it surfaces confusingly as
"can't reach database server".

To run entirely locally instead:

```bash
npm run docker:up                                   # Postgres+PostGIS, Redis, MQTT, MinIO, MailHog
# point DATABASE_URL at localhost:5432, then:
npm run db:migrate
node apps/api/prisma/sql/apply.mjs                  # spatial columns, triggers, functions
npm run db:seed
```

`apply.mjs` is separate because Prisma cannot express generated geography columns.
It is idempotent — safe to re-run after every migration.

---

## Remaining work

1. Automated tests — unit, integration, and a load test for GPS ingestion at peak.
2. Kubernetes manifests (Docker Compose and CI already exist).
3. Write-path UI for a few screens that are currently read-only (student create,
   invoice generation, book issue/return forms) — the API endpoints for all of these
   exist and are exercised by the seed.
# school-erp
