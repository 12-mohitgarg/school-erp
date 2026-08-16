# EduSphere — School ERP System

Unified academic, administrative, financial and student-safety platform, built to the
supplied PRD (`School_ERP_PRD_Professional_v2_Updated.pdf`) plus the workflow, panel
responsibility and web-vs-application documents.

**One platform, many schools.** A platform operator adds a school; that school gets its
own panel, its own staff, its own data — and runs every process itself.

---

## Quick start

No Docker, no Redis, no S3. You need Node 20+ and a PostgreSQL 16+ with PostGIS
(or a hosted one — the project is currently pointed at Neon).

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
| **Platform Operator** | `platform@edusphere.io` |
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
| Ryan International (2nd school) | `principal@ryanmumbai.edu.in` |
| Greenwood High (3rd school) | `principal@greenwoodhigh.edu.in` |

Sign in as **`platform@edusphere.io`** to see the multi-school control plane.

| Endpoint | Purpose |
|---|---|
| http://localhost:5173 | Web app |
| http://localhost:4000/api/v1 | API root |
| http://localhost:4000/docs | Swagger reference |
| http://localhost:4000/rbac.json | Machine-readable permission matrix |
| http://localhost:4000/health | Liveness + dependency checks |
| http://localhost:4000/metrics | Prometheus metrics |

To reseed: `npm run db:seed` (destructive — rebuilds the demo schools only).

---

## Multi-school: how it works

The client's requirement: *one admin adds many schools, each school gets its own panel,
and each school runs all of its own processes.*

This is not a separate mode bolted on the side. **A school is a tenant**, and every query
in the product was already tenant-scoped, so a new school is one more tenant row and the
entire ERP works inside it unchanged. What was added is the layer *above* the schools:

```
                    Platform Operator  (isPlatformAdmin)
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        School A          School B        School C          ← Tenant rows
     Super Admin       Super Admin      Super Admin         ← each school's own
     Teachers · Accountant · Librarian · HR · Parents · Drivers
     Own students, fees, timetable, buses, settings, audit trail
```

**Provisioning.** `POST /platform/schools` creates, in one transaction: the school, its
main campus, the current academic year, the standard Indian fee heads, leave types,
departments, a campus geofence and its first Super Admin with a one-time password. A
school that comes up empty has not really been onboarded, so it comes up usable.

**Opening a school's panel.** `POST /platform/schools/:id/open` reissues the operator's
token with `tenantId` pointing at that school. Every handler, query filter and socket
room downstream then resolves to that school with no knowledge that anything unusual
happened — which is exactly why there is no second set of rules to get wrong. The web app
drops its whole RTK cache on the switch, so the previous school's data cannot render for
even a frame under the new school's name. A banner stays visible for the whole session.

**Why a flag, not a role.** `User.isPlatformAdmin` is a boolean, not an eleventh role. A
platform operator still holds a normal role inside whichever school they are working in,
so every existing RBAC and data-scope check keeps working untouched — the flag only adds
the right to change *which* school that is. A school's own Super Admin is unrestricted
inside their school and gets `403` from every `/platform/*` route.

**Suspension** signs out every user in that school immediately and blocks login, without
deleting anything.

---

## Live GPS tracking: how it works

```
Driver app (WebSocket)  ─┐
                         ├─→ ingestLocation() ─→ persist ─→ cache last position
Hardware tracker (MQTT) ─┘                        │
                                                  ├─→ geofence engine   (edge-triggered, with cooldown)
                                                  ├─→ speed / route-deviation alerts
                                                  ├─→ stop ETA recompute
                                                  └─→ fan-out ─┬─→ fleet:{tenant}   admin safety dashboard
                                                               └─→ vehicle:{id}     the parent of a child aboard
```

1. **The bus reports.** Driver app or hardware tracker, every ~12 seconds during a trip
   (PRD §6.1 asks for 10–15s).
2. **One ingest pipeline** handles both transports, so the safety logic exists exactly
   once. Everything after "persist" is best-effort: an alerting failure can never lose
   the position itself.
3. **Rules run on every ping.** Geofence evaluation is *edge-triggered* — state is held
   per `(vehicle, fence)` and an event fires only on transition, otherwise a parked bus
   would alert every twelve seconds. Over-speed and route-deviation alerts have their own
   cooldowns.
4. **ETAs** are measured stop-to-stop along the stops still ahead, plus the halt at each
   one — not straight-line — so an estimate accounts for the route in between.
5. **Fan-out over two rooms, and this is the privacy boundary.** Staff with
   `tracking:view` and branch-or-wider scope join `fleet:{tenantId}` and see every bus.
   A guardian has `tracking:view` but `CHILDREN` scope, so they are refused the fleet
   room and may only join the one `vehicle:{id}` currently carrying their child (PRD
   §6.3). The REST snapshot still polls every 30s as a fallback if the socket drops.
6. **Every view is logged** to `location_access_logs`, and history is purged once the
   school's own retention window passes.

The Live GPS screen carries a **"How this works"** panel stating the same six steps and
the current connection state, so "is this real-time or is it broken?" is answerable from
the screen rather than from a document.

---

## Background jobs (the scheduler)

Eleven jobs, each declaring the PRD clause it satisfies. **Settings › Scheduler** shows
every one of them with its cadence, last run, duration, rows affected and any error, plus
a **Run now** button — scheduled work nobody can inspect is scheduled work nobody trusts.
Every execution writes a `job_runs` row.

| Job | Every | Relates to |
|---|---|---|
| Purge location history | 6h | PRD §6.3 — retention, **per school** |
| Detect offline trackers | 2m | PRD §6.1 — a silent tracker is a safety gap |
| Close abandoned trips | 1h | PRD §5.8 — trips left open by a closed driver app |
| Refresh trip metrics | 1m | PRD §8.1 — Prometheus |
| Mark overdue invoices | 1h | PRD §5.5 — due/overdue tracking |
| Send fee reminders | 6h | PRD §5.5 — automated due reminders |
| Accrue library fines | 1h | PRD §5.7 — overdue tracking **and fine calculation** |
| Refresh at-risk scores | 12h | PRD §10 — at-risk prediction, fee-default risk |
| Retry failed notifications | 5m | PRD §10 — delivery retries, DLR tracking |
| Prune refresh tokens | 6h | PRD §9.2 — rotation hygiene |
| Prune job history | 24h | Operational hygiene |

Three of these were doing less than they claimed and were fixed: retention was a single
global setting rather than per school; library loans flipped to OVERDUE but never accrued
a fine, so the dues report always read zero; and there were no fee reminders at all
despite §5.5 requiring them. Trip auto-close and at-risk scoring are new — the
`student_risk_scores` table existed with nothing writing to it.

Jobs never overlap themselves (a slow tick is skipped, not queued) and a throwing job is
caught and recorded rather than taking the timer down with it.

---

## File storage — Cloudinary

S3/MinIO is gone. Files go **from the browser straight to Cloudinary** with an unsigned
upload preset, so nothing binary transits the API: a 10MB scan does not occupy a Node
worker, and the browser gets real byte-level progress.

```
CLOUDINARY_CLOUD_NAME=de6uqmt1m
CLOUDINARY_UPLOAD_PRESET=hm8borsg
```

Both values are public by design. The server keeps them so it can serve them to the
browser from `GET /settings/storage` (storage can be re-pointed without a front-end
rebuild) and — the part that matters — so it can **reject any stored URL that is not from
this cloud**. A client-side upload means the browser can send us any string; without that
check the document tables become a list of attacker-chosen links rendered inside the
admin UI. Both `res.cloudinary.com.attacker.test/...` and another account's cloud are
refused.

`CLOUDINARY_API_KEY` / `API_SECRET` are optional and used only to *delete* an asset,
which is signed and server-only. Deleting a student document removes the stored file too
— an untracked pile of children's identity documents is exactly what the DPDP erasure
workflow has to be able to clear.

Wired in at: student documents (upload, verify, delete), school logo, and a reusable
`FileUpload` / `ImageUpload` pair for anywhere else.

---

## Loading states

Every waiting screen shows the *shape* of what is coming, never a spinner and never the
words "Loading…". `components/ui/Skeletons.tsx` provides `PageSkeleton`,
`DetailSkeleton`, `TableCardSkeleton`, `StatRowSkeleton`, `ListSkeleton`, `CardSkeleton`,
`ChartSkeleton`, `MapSkeleton` and `FormSkeleton` — each mirroring a real composition, so
nothing shifts when the data lands.

The lazy-route Suspense fallback is a full page skeleton rather than a spinner: on a slow
connection the chunk fetch is the longest wait in the app, and a spinner there makes the
whole product feel sluggish even when the data behind it is fast.

---

## Admissions

The funnel screen was read-only: "New enquiry" did nothing, there was no way to move an
application along, and marking one ENROLLED changed a label without creating a student —
so the funnel reported conversions that had not happened.

Now: capture an enquiry, walk it stage by stage (each row offers only its *next* valid
action, so the front office does not have to know the state machine), and convert an
approved applicant into a real student — student record, enrolment into a class and
section, and the guardian from the enquiry linked as primary contact, in one transaction.
Reject with a reason, reopen later. Funnel counts and a conversion rate sit above the
table.

Also fixed: the status PATCH looked up applications by id alone, so a token from one
school could edit another school's applications; and the application number used
`count + 1`, which collides when two enquiries are captured in the same second.

---

## Architecture

```
apps/
  api/                 Node + Express + TypeScript. REST + WebSocket + MQTT.
    prisma/            Schema, PostGIS SQL, seed
    src/config/        Zod-validated environment
    src/core/          auth · rbac · tenancy · audit · realtime · notifications
                       jobs · metrics · storage · docs
    src/modules/       One folder per functional module, plus platform/
  web/                 React + TypeScript + Redux Toolkit + Tailwind
    src/components/    Design system, app shell, charts, skeletons, uploads
    src/features/      One folder per panel area, plus platform/
packages/
  shared/              RBAC matrix, domain enums, API contracts, geo/grading helpers
infra/
  monitoring/          Prometheus scrape config
```

### The three guarantees the backend is built around

1. **Tenant isolation.** Every query filters on `tenantId` taken from the verified JWT —
   never from the request body. `core/tenancy/scope.ts` provides the builders.
2. **Data scope.** Inside a tenant, a role sees only what its `DataScope` allows —
   `SELF`, `CHILDREN`, `ASSIGNED`, `BRANCH` or `TENANT`.
3. **Auditability.** Every write goes to an append-only `audit_logs` row with actor,
   before/after diff, IP and request id. Every *read* of a child's location additionally
   writes to `location_access_logs`, as PRD §6.3 requires.

---

## Technology

| Layer | Technology |
|---|---|
| Web | React 18, TypeScript, Redux Toolkit + RTK Query, Tailwind CSS, Vite |
| Backend | Node.js, Express, TypeScript (REST + WebSocket) |
| Database | PostgreSQL + PostGIS, via Prisma |
| Cache & live buffer | In-process store (`core/cache/store.ts`) |
| Realtime | Socket.IO; MQTT for hardware trackers |
| Auth | JWT access tokens + rotating refresh tokens, bcrypt, AES-256-GCM vault |
| Storage | **Cloudinary**, uploaded direct from the browser |
| Observability | Prometheus, pino structured logs, Sentry hook |
| CI | GitHub Actions |

### Deviations from the PRD stack, and why

- **No Redis.** Removed at the client's request. The three workloads it carried — query
  caching, last-known vehicle position, and short-lived counters — now run in
  `core/cache/store.ts`, an in-process store with TTLs, bounded lists and a sweeper.
  Socket.IO uses its built-in adapter. The trade-off is explicit: state is per-process
  and does not survive a restart, so running more than one API replica would need a
  shared store again. Nothing else in the codebase assumes one.
- **No Docker.** Removed at the client's request. Run Postgres however you like, or point
  `DATABASE_URL` at a hosted one.
- **No S3.** Replaced by Cloudinary, above.
- **Maps.** Leaflet with OpenStreetMap tiles rather than the Google Maps SDK, because it
  needs no API key. Routes are already stored as Google-encoded polylines and
  `GOOGLE_MAPS_API_KEY` is wired, so swapping is a front-end component change only.

---

## Roles

Ten roles, defined once in `packages/shared/src/rbac.ts`, enforced by the API and consumed
by the web app for navigation. Above them sits the platform operator, which is a flag
rather than a role — see *Multi-school*, above.

| Role | Scope |
|---|---|
| Super Admin | Tenant-wide, unrestricted **within one school** |
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

## Database

Currently pointed at a hosted Neon Postgres 18 instance (`apps/api/.env`, gitignored).
The pool is capped at 5 connections — Neon's free tier allows far fewer concurrent
connections than Prisma's default, and exceeding it surfaces confusingly as
"can't reach database server".

```bash
npm run db:migrate          # schema
npm run db:apply-spatial    # generated geography columns, triggers, functions
npm run db:seed             # demo data
```

`db:apply-spatial` is separate because Prisma cannot express generated geography columns.
It is idempotent — safe to re-run after every migration. Because those columns exist
outside the migration history, Prisma reports them as drift; the
`20260816120000_multi_school_scheduler_cloudinary` migration is therefore hand-written
and fully idempotent, and was applied with `prisma db execute` + `migrate resolve` rather
than a reset.

---

## Verified

`npm run typecheck` and `npm run build` pass clean across API, web and shared.

Exercised against the live database:

- Platform operator signs in, lists 5 schools, opens the DPS panel, and reads its 300
  students under a token that names that school.
- Full admissions funnel: enquiry → applied → documents → verified → approved → enrolled,
  producing student `ADM/2026-27/000301` with the guardian from the enquiry attached; a
  second enrolment of the same application is refused.
- All 11 scheduled jobs ran on boot — 44 invoices marked overdue, 9 fee reminders sent,
  94 at-risk flags written.
- 11/11 security checks: a school's Super Admin gets 403 from `/platform/*`; one school's
  admin cannot PATCH another's application (404) and sees none of its rows; a parent
  cannot list staff and sees only their own child; a teacher cannot trigger a job;
  look-alike and foreign Cloudinary URLs are both rejected.

---

## Remaining work

1. Automated test suite — unit, integration, and a load test for GPS ingestion at peak.
   The checks above are manual scripts, not a committed suite.
2. Kubernetes manifests. CI exists; container images do not.
3. Mobile apps (Parent, Student, Driver) — descoped by the client, web only. The APIs and
   WebSocket contracts they need are all present.
