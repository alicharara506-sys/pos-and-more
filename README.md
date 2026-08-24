# SalesMaster Pro

A multi-tenant point-of-sale, CRM, inventory, invoicing, and reporting platform for small and
medium-sized businesses.

## What's implemented in this phase

This repository is being built against the full SalesMaster Pro specification (see
`docs/architecture.md` for the complete scope). **This phase delivers the foundation and a working
web POS core** — it does not claim to implement every capability described in the long-term spec.
Concretely, working today:

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
- Automated tests: unit tests for the billing formula, money math, and stock-status logic;
  integration tests for tenant isolation, the billing acceptance tests, auth, and sale/refund
  ledger correctness — all run against a real Postgres instance, not mocks.

**Deliberately not implemented yet** (see the relevant doc for the plan):

- The React Native mobile app is a placeholder screen only — no offline-first POS, no local
  SQLite cache, no sync engine. Design is documented in `docs/offline-sync.md` but not built.
- The e-commerce integration hub (Shopify/WooCommerce/universal connector) — see
  `docs/integrations.md` for the intended architecture.
- The AI sales assistant, QR code module, and scheduled/exported reports.
- Live third-party credentials: Google/Apple OAuth, Stripe, and email/SMS providers are wired
  against their real SDKs behind typed adapters, but this environment has no real keys — every
  adapter reports itself honestly "not configured" rather than faking success (see
  `docs/security.md` and `.env.example`).

## Architecture

pnpm workspace monorepo:

```text
apps/
  api/      NestJS REST API (OpenAPI docs at /docs)
  web/      Next.js web app (onboarding, dashboard, POS, products, customers, invoices, expenses)
  worker/   BullMQ worker draining the transactional outbox
  mobile/   Expo placeholder (not yet implemented — see docs/offline-sync.md)
packages/
  domain/       Pure business logic: billing formula, Money, permissions, stock-status
  database/     Prisma schema, migrations, seed script
  contracts/    Shared Zod schemas/DTOs used by both api and web
  config/       Validated environment loader
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

### Testing

```bash
pnpm test:unit                                     # pure-logic unit tests (all packages)
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
- `docs/offline-sync.md` — mobile offline design (not yet implemented)
- `docs/integrations.md` — commerce integration hub design (not yet implemented)
- `docs/security.md` — threat model, auth, encryption, audit policy
- `docs/billing.md` — the exact pricing/entitlement calculation
