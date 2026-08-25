# SalesMaster Pro

A multi-tenant point-of-sale, CRM, inventory, invoicing, and reporting platform for small and
medium-sized businesses.

## What's implemented in this phase

This repository is being built against the full SalesMaster Pro specification (see
`docs/architecture.md` for the complete scope). **This covers the foundation, the web POS core, and
the offline-first mobile POS** — it does not claim to implement every capability described in the
long-term spec. Concretely, working today:

- Multi-tenant data model with enforced tenant isolation (Postgres + Prisma).
- Email/password auth (with email verification), magic-link login, Google OAuth, Apple OAuth,
  TOTP MFA, revocable sessions, and RBAC with a granular permission catalog.
- Atomic onboarding: tenant + first branch + owner membership + trial subscription created in one
  transaction.
- The exact billing formula (`$10` base + `$5`/extra branch + `$2`/extra user), a versioned
  pricing catalog, a Stripe Billing adapter (falls back to a local-only provider when no Stripe
  keys are configured — see `docs/billing.md`), and idempotent webhook handling.
- Product catalog, ledger-based inventory (with the red/yellow/green stock-status system),
  branch transfers, customers/CRM, POS sales with decimal-safe totals and offline-sync-ready
  idempotency keys, refunds, invoices/quotes with public revocable view links, and expenses.
- A live, real-data dashboard (no hard-coded demo numbers).
- A transactional outbox + a real BullMQ worker that drains it.
- A platform-admin surface (separate auth path) for tenant search, MRR, and pricing-catalog edits.
- OpenAPI docs for the whole API (`/docs` when running).
- An offline-first React Native (Expo) POS: login, an on-device SQLite cache of the authorized
  catalog/customer/branch data, a durable client-side mutation queue, and a background sync engine
  that drains it against the real API with exponential backoff and a manual-retry "dead" state for
  exhausted/permanent failures — see `docs/offline-sync.md`. The queue/backoff/sync-decision logic
  is platform-agnostic (`packages/offline-sync`, 19 unit tests with an in-memory adapter); the app
  supplies only the SQLite storage adapter and the NetInfo/API wiring.
- Automated tests: unit tests for the billing formula, money math, stock-status logic, and the
  offline mutation queue/sync engine; integration tests for tenant isolation, the billing
  acceptance tests, auth, and sale/refund ledger correctness — all run against a real Postgres
  instance, not mocks.
- An e-commerce integration hub for WooCommerce: a provider-agnostic connector SDK
  (`packages/integrations`) with WooCommerce built on top of it, encrypted connection
  credentials, idempotent product/inventory sync, and signature-verified webhook ingestion
  (HMAC-SHA256, deduped replay-safe), plus a merchant-facing integration health dashboard in
  `apps/web` — see `docs/integrations.md` for exactly what is and isn't covered (Shopify and other
  providers, order→sale materialization, and inbound inventory sync are explicitly out of scope
  for this phase).

**Deliberately not implemented yet** (see the relevant doc for the plan):

- The AI sales assistant, QR code module, and scheduled/exported reports.
- Live third-party credentials: Google/Apple OAuth, Stripe, and email/SMS providers are wired
  against their real SDKs behind typed adapters, but this environment has no real keys — every
  adapter reports itself honestly "not configured" rather than faking success (see
  `docs/security.md` and `.env.example`).

**A note on mobile verification**: `apps/mobile`'s business logic is unit tested and its full
source successfully bundles through the real Expo/Metro toolchain (`expo export`), but this
development environment has no iOS/Android simulator or physical device, so the app has not been
visually run or interacted with on a real target — see `docs/offline-sync.md`'s closing section
for exactly what was and wasn't verified.

## Architecture

pnpm workspace monorepo:

```text
apps/
  api/      NestJS REST API (OpenAPI docs at /docs)
  web/      Next.js web app (onboarding, dashboard, POS, products, customers, invoices, expenses)
  worker/   BullMQ worker draining the transactional outbox
  mobile/   Expo/React Native offline-first POS (login, SQLite cache, mutation queue, sync engine)
packages/
  domain/         Pure business logic: billing formula, Money, permissions, stock-status
  database/       Prisma schema, migrations, seed script
  contracts/      Shared Zod schemas/DTOs used by api, web, and mobile
  config/         Validated environment loader
  offline-sync/   Platform-agnostic mutation queue + sync engine (used by apps/mobile)
docs/           architecture, data model, offline-sync, integrations, security, billing
```

See `docs/architecture.md` for the full system design and decisions.

## Local development

### Prerequisites

- Node.js 20+, pnpm 9+
- PostgreSQL 16 and Redis 7 (via `docker compose up -d`, or local installs)

### Setup

```bash
pnpm install
cp .env.example .env
# Fill in AUTH_JWT_SECRET and AUTH_ENCRYPTION_KEY with real random 32+ byte strings, e.g.:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

docker compose up -d          # Postgres + Redis
pnpm --filter @salesmaster/database generate
pnpm --filter @salesmaster/database exec prisma migrate dev --name init
pnpm --filter @salesmaster/database seed   # seeds the pricing catalog + system roles only — no demo data
```

### Run

```bash
pnpm --filter @salesmaster/api dev      # http://localhost:4000, OpenAPI at /docs
pnpm --filter @salesmaster/web dev      # http://localhost:3000
pnpm --filter @salesmaster/worker dev   # drains the outbox in the background
```

Then open http://localhost:3000, register an account, verify (the console-email adapter logs the
verification link to the API's stdout in dev), and go through the onboarding wizard.

### Mobile (offline POS)

```bash
cd apps/mobile
cp .env.example .env    # sets EXPO_PUBLIC_API_URL — see below
pnpm start               # opens Expo Dev Tools; scan the QR code with Expo Go, or press i/a for a simulator
```

`EXPO_PUBLIC_API_URL` should point at the same API instance as `apps/web`'s
`NEXT_PUBLIC_API_URL` (e.g. `http://<your-machine-lan-ip>:4000/api/v1` — not `localhost`, since a
physical device or simulator doesn't share your machine's `localhost`). Sign in with an account
that already completed onboarding via the web app (the mobile app doesn't implement onboarding
itself — see `docs/offline-sync.md`).

### Testing

```bash
pnpm test:unit                                     # pure-logic unit tests (all packages, incl. packages/offline-sync)
pnpm --filter @salesmaster/api test:integration     # API integration tests against a real Postgres
```

The integration suite needs `DATABASE_URL`/`REDIS_URL`/`AUTH_JWT_SECRET`/`AUTH_ENCRYPTION_KEY` set
(see `.env`) and a migrated database.

### Quality gates

```bash
pnpm format:check
pnpm typecheck
pnpm test:unit
pnpm --filter @salesmaster/api test:integration
pnpm --filter @salesmaster/api build
pnpm --filter @salesmaster/web build
pnpm --filter @salesmaster/worker build
```

CI (`.github/workflows/ci.yml`) runs all of the above, plus a migration-verification job against a
disposable Postgres service container.

## Documentation

- `docs/architecture.md` — system boundaries, major flows, decisions
- `docs/data-model.md` — entities, relationships, tenant-isolation strategy
- `docs/offline-sync.md` — the mobile offline-first POS: mutation queue, sync engine, conflict rules
- `docs/integrations.md` — commerce integration hub: what's implemented (WooCommerce) and what isn't
- `docs/security.md` — threat model, auth, encryption, audit policy
- `docs/billing.md` — the exact pricing/entitlement calculation
