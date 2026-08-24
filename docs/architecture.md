# Architecture

## System boundaries

```text
┌─────────────┐        ┌──────────────────────────────┐
│  apps/web   │──REST─▶│           apps/api            │──────▶ PostgreSQL (Prisma)
│  (Next.js)  │  JSON  │  NestJS, versioned /api/v1     │
└─────────────┘        │  Session cookie / bearer auth  │
                        └──────────────┬─────────────────┘
                                       │ writes OutboxEvent rows
                                       │ inside the same DB transaction
                                       ▼
                        ┌──────────────────────────────┐
                        │          apps/worker           │──────▶ Redis (BullMQ)
                        │  polls OutboxEvent, enqueues   │
                        │  jobs, is the only place that   │
                        │  would call a real notification │
                        │  provider                        │
                        └──────────────────────────────┘

apps/mobile — Expo placeholder only, not wired to the API yet (docs/offline-sync.md).
```

Every app depends on the shared `packages/*` libraries rather than duplicating logic:

- `packages/domain` — pure functions with zero I/O: the billing formula, `Money` (decimal-safe
  arithmetic), the RBAC permission catalog, and stock-status computation. Unit tested in isolation
  because nothing here touches a database or network.
- `packages/database` — the single Prisma schema and generated client, re-exported as a singleton
  so `apps/api` and `apps/worker` share one connection pool shape (each process still gets its own
  pool at runtime).
- `packages/contracts` — Zod schemas that are both the request-validation layer in `apps/api` and
  the source of truth for request/response types consumed by `apps/web`. One schema, not two
  hand-maintained copies.
- `packages/config` — a single `loadEnv()` that validates `process.env` once at process boot. Every
  optional field (unconfigured OAuth, Stripe, email/SMS provider) stays `undefined`, and the
  corresponding adapter is required to check for that and report itself as unconfigured rather
  than silently no-op or fake success.

## Request lifecycle (apps/api)

1. `RequestIdMiddleware` stamps every request/response with an `x-request-id` for log correlation.
2. `SessionAuthGuard` (global, via `APP_GUARD`) resolves the opaque session cookie/bearer token
   into a `User`, unless the route is `@Public()`.
3. `TenantGuard` (per-controller) resolves the `X-Tenant-Id` header against the authenticated
   user's `Membership` table — this is the only path by which a tenant ID becomes trusted. A
   tenant ID in a URL param or request body is never trusted on its own; every service method
   re-derives tenant scope from the guard-resolved value and filters every query by it.
4. `RbacGuard` checks the resolved membership's permission set against `@RequirePermissions(...)`.
5. The controller calls a service, which does the actual Prisma work — always with `tenantId` in
   the `where` clause, and `updateMany`/`findFirst` (never a bare `findUnique`-by-id-only) for
   anything that isn't already scoped through a foreign key chain that terminates at `tenantId`.
6. Mutations that need a side effect outside the request/response cycle write an `OutboxEvent` row
   inside the same Prisma transaction as the domain write (see below), never calling an external
   provider synchronously inside that transaction.

## Transactional outbox

Slow or retryable work (today: logging what a notification _would_ send — see
`docs/integrations.md` for why no real provider is wired up in this environment) must never block
or be lost relative to the domain write that triggered it. The pattern:

1. Inside the same `$transaction` as the domain write (e.g. creating a `Sale`), insert an
   `OutboxEvent` row (`aggregateType`, `aggregateId`, `eventType`, `payload`).
2. `apps/worker` polls `OutboxEvent` for unprocessed rows every 5s, hands each to a BullMQ queue
   using the outbox row's own id as the BullMQ `jobId` (so re-polling before the "processed" write
   commits can't double-enqueue), then marks the row processed.
3. BullMQ owns retry/backoff from there; a job that keeps failing surfaces in the queue's failed
   set for manual inspection — a real dead-letter path, not a silent drop.

This is exercised for real in `apps/worker` (see the worker's own tests-by-demonstration in
`README.md`'s manual-verification notes) — it is not a stub.

## Tenancy model

See `docs/data-model.md` for the full entity list. In short: `Tenant` is the isolation boundary;
every tenant-owned table carries a required `tenantId`; `Membership` is the only bridge between a
`User` and a `Tenant`, carrying the `Role` (and therefore permission set) and an optional
`branchScope` for managers restricted to specific branches.

## Why NestJS + Next.js + a plain REST API (not GraphQL, not tRPC)

- NestJS gives structured DI, guards, and OpenAPI generation for free, which matters once the API
  needs to be a documented, versioned, partner-facing surface (spec §13.5) — not just an internal
  implementation detail of the web app.
- Next.js App Router for the web app; screens are client components calling the same REST API a
  future mobile client will call, rather than using Next.js API routes as a hidden backend. This
  keeps exactly one server-side authority (`apps/api`) for tenant isolation and billing.

## Known simplifications in this phase (see also README's "not implemented yet")

- Report time-bucketing (`today`, `last 7 days`, etc.) uses server (UTC) time, not per-tenant
  timezone-aware bucketing yet.
- Invoice numbering uses a count-based sequence with a retry-on-conflict loop rather than a
  dedicated per-tenant counter table; correct and race-safe, but not guaranteed perfectly gapless
  under heavy concurrent invoice creation.
- Branch transfers are recorded as immediately "received" (no separate dispatch → approve → receive
  workflow yet) — the `StockTransfer` model and `DISPATCHED`/`RECEIVED` status already exist for
  that workflow to be added without a schema change.
